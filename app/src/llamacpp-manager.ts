import * as fs from "node:fs";
import * as path from "node:path";
// node-llama-cpp is ESM with top-level await — this app compiles to
// CommonJS, and `require()`-ing an ESM module with top-level await throws
// (ERR_REQUIRE_ASYNC_MODULE) instead of loading. A plain dynamic `import()`
// doesn't dodge this: TypeScript's CommonJS output rewrites `import(x)` into
// `Promise.resolve().then(() => require(x))`, which just wraps the same
// broken require() in a promise. The only way to get Node's *real* dynamic
// import from CJS output is to hide the `import()` call from TypeScript's
// transform entirely — building it via `new Function` does that, since tsc
// can't statically see (or rewrite) an import expression inside a string.
// Type-only imports are erased at compile time and don't hit this problem,
// so those stay static.
import type { ChatHistoryItem, Llama, LlamaModel } from "node-llama-cpp";
import type { ChatMessage, ChatChunk, ChatOptions, ToolDefinition } from "./providers/types";

export type GpuBackend = "auto" | "vulkan" | "cuda" | "metal" | "cpu";

type NodeLlamaCppModule = typeof import("node-llama-cpp");
const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
) => Promise<NodeLlamaCppModule>;
let modulePromise: Promise<NodeLlamaCppModule> | null = null;

function loadNodeLlamaCpp(): Promise<NodeLlamaCppModule> {
    if (!modulePromise) modulePromise = dynamicImport("node-llama-cpp");
    return modulePromise;
}

let llamaInstance: Llama | null = null;
let llamaInstancePromise: Promise<Llama> | null = null;
let activeBackend: GpuBackend = "auto";
let backendRevision = 0;
// Loaded model weights are the expensive, slow-to-load part (can be several
// GB) — kept warm across chat turns. The lightweight per-turn context/session
// below is deliberately NOT cached across turns; see chat() for why.
const modelCache = new Map<string, LlamaModel>();
const modelLoads = new Map<string, Promise<LlamaModel>>();
const modelLastUsed = new Map<string, number>();
const activeModelUsers = new Map<string, number>();
let maxCachedModels = 2;
// Keep warm weights for fast follow-up prompts, then release their RAM/VRAM
// after inactivity. Headless deployments can override the default without a
// new UI setting; 0 disables time-based eviction.
const configuredIdleMinutes = Number(process.env.OLLAMA_CUSTOM_UI_LLAMA_IDLE_MINUTES ?? 15);
const modelIdleTimeoutMs = Number.isFinite(configuredIdleMinutes)
    ? Math.max(0, configuredIdleMinutes) * 60_000
    : 15 * 60_000;
let idleEvictionTimer: NodeJS.Timeout | null = null;

function clearIdleEvictionTimer(): void {
    if (!idleEvictionTimer) return;
    clearTimeout(idleEvictionTimer);
    idleEvictionTimer = null;
}

function scheduleIdleEviction(): void {
    clearIdleEvictionTimer();
    if (modelIdleTimeoutMs === 0 || modelCache.size === 0) return;

    const now = Date.now();
    const nextExpiry = [...modelCache.keys()]
        .filter((key) => (activeModelUsers.get(key) ?? 0) === 0)
        .map((key) => (modelLastUsed.get(key) ?? now) + modelIdleTimeoutMs)
        .sort((a, b) => a - b)[0];
    if (nextExpiry === undefined) return;

    idleEvictionTimer = setTimeout(() => {
        idleEvictionTimer = null;
        void evictExpiredModels();
    }, Math.max(1_000, nextExpiry - now));
    idleEvictionTimer.unref();
}

async function evictExpiredModels(): Promise<void> {
    const cutoff = Date.now() - modelIdleTimeoutMs;
    const expiredModels: LlamaModel[] = [];
    for (const [key, model] of modelCache) {
        if ((activeModelUsers.get(key) ?? 0) > 0) continue;
        if ((modelLastUsed.get(key) ?? 0) > cutoff) continue;
        modelCache.delete(key);
        modelLastUsed.delete(key);
        expiredModels.push(model);
    }
    await Promise.allSettled(expiredModels.map((model) => model.dispose()));
    scheduleIdleEviction();
}

export function setModelCacheLimit(limit: number): void {
    if (!Number.isFinite(limit)) return;
    maxCachedModels = Math.max(1, Math.min(Math.floor(limit), 8));
    void evictIdleModels();
}

function modelCacheKey(modelPath: string, gpuLayers?: number): string {
    return `${modelPath}\0${gpuLayers ?? "auto"}`;
}

export async function setGpuBackend(backend: GpuBackend): Promise<void> {
    if (!["auto", "vulkan", "cuda", "metal", "cpu"].includes(backend)) {
        throw new Error(`Unsupported llama.cpp GPU backend: ${String(backend)}`);
    }
    if (backend === activeBackend) return;
    if ([...activeModelUsers.values()].some((users) => users > 0)) {
        throw new Error("The GPU backend cannot be changed while a llama.cpp response is being generated.");
    }
    const oldModels = [...modelCache.values()];
    const oldLlama = llamaInstance;
    activeBackend = backend;
    backendRevision++;
    // A running Llama instance is bound to whichever backend it was created
    // with — switching backends means starting over, and previously loaded
    // model weights are tied to the old instance too.
    llamaInstance = null;
    llamaInstancePromise = null;
    modelCache.clear();
    modelLoads.clear();
    modelLastUsed.clear();
    activeModelUsers.clear();
    clearIdleEvictionTimer();

    // Native model buffers can outlive their JS references. Explicitly
    // dispose them so a backend switch returns VRAM before reallocating it.
    await Promise.allSettled(oldModels.map((model) => model.dispose()));
    if (oldLlama) await oldLlama.dispose();
}

async function getLlamaInstance(): Promise<Llama> {
    if (llamaInstance) return llamaInstance;
    if (llamaInstancePromise) return llamaInstancePromise;

    const revision = backendRevision;
    const backend = activeBackend;
    const creation = (async () => {
        const { getLlama } = await loadNodeLlamaCpp();
        const instance = await getLlama({ gpu: backend === "cpu" ? false : backend });
        // A backend change may happen while native initialization is still
        // running. Never publish an instance created for the stale backend.
        if (revision !== backendRevision) {
            await instance.dispose();
            return getLlamaInstance();
        }
        llamaInstance = instance;
        return instance;
    })();
    llamaInstancePromise = creation;
    try {
        return await creation;
    } finally {
        if (llamaInstancePromise === creation) llamaInstancePromise = null;
    }
}

export async function getAvailableGpuBackends(): Promise<string[]> {
    try {
        const { getLlamaGpuTypes } = await loadNodeLlamaCpp();
        const types = await getLlamaGpuTypes("supported");
        return types.filter((t): t is Exclude<typeof t, false> => t !== false);
    } catch {
        return [];
    }
}

async function loadModel(modelPath: string, gpuLayers?: number): Promise<LlamaModel> {
    const key = modelCacheKey(modelPath, gpuLayers);
    const cached = modelCache.get(key);
    if (cached) {
        modelLastUsed.set(key, Date.now());
        scheduleIdleEviction();
        return cached;
    }
    const pending = modelLoads.get(key);
    if (pending) return pending;

    // Coalesce simultaneous first requests. Loading the same weights twice
    // can briefly double RAM/VRAM use and OOM an otherwise suitable GPU.
    const revision = backendRevision;
    const load = (async () => {
        const llama = await getLlamaInstance();
        const model = await llama.loadModel({ modelPath, gpuLayers: gpuLayers ?? "auto" });
        if (revision !== backendRevision) {
            await model.dispose();
            throw new Error("The GPU backend changed while the model was loading. Please retry the request.");
        }
        modelCache.set(key, model);
        modelLastUsed.set(key, Date.now());
        await evictIdleModels(key);
        scheduleIdleEviction();
        return model;
    })();
    modelLoads.set(key, load);
    try {
        return await load;
    } finally {
        if (modelLoads.get(key) === load) modelLoads.delete(key);
    }
}

async function evictIdleModels(protectedKey?: string): Promise<void> {
    while (modelCache.size > maxCachedModels) {
        const candidate = [...modelCache.keys()]
            .filter((key) => key !== protectedKey && (activeModelUsers.get(key) ?? 0) === 0)
            .sort((a, b) => (modelLastUsed.get(a) ?? 0) - (modelLastUsed.get(b) ?? 0))[0];
        if (!candidate) return;
        const model = modelCache.get(candidate);
        modelCache.delete(candidate);
        modelLastUsed.delete(candidate);
        if (model) await model.dispose();
    }
    scheduleIdleEviction();
}

export async function dispose(): Promise<void> {
    backendRevision++;
    clearIdleEvictionTimer();
    const models = [...modelCache.values()];
    const llama = llamaInstance;
    modelCache.clear();
    modelLoads.clear();
    modelLastUsed.clear();
    activeModelUsers.clear();
    llamaInstance = null;
    llamaInstancePromise = null;
    await Promise.allSettled(models.map((model) => model.dispose()));
    if (llama) await llama.dispose();
}

export interface LocalGgufModel {
    name: string;
    path: string;
    sizeBytes: number;
}

export function listModels(modelsDir: string): LocalGgufModel[] {
    if (!fs.existsSync(modelsDir)) return [];
    return fs
        .readdirSync(modelsDir)
        .filter((f) => f.toLowerCase().endsWith(".gguf"))
        .map((f) => {
            const full = path.join(modelsDir, f);
            return { name: f, path: full, sizeBytes: fs.statSync(full).size };
        });
}

// Model paths currently kept warm in modelCache — used for the
// activity/resource usage view. Doesn't report VRAM/RAM footprint since
// node-llama-cpp doesn't expose per-model memory usage.
export function listLoadedModels(): string[] {
    return [...new Set([...modelCache.keys()].map((key) => key.split("\0", 1)[0]))];
}

export async function deleteModel(modelsDir: string, name: string): Promise<void> {
    const root = path.resolve(modelsDir);
    const target = path.resolve(root, name);
    if (path.basename(name) !== name || !name.toLowerCase().endsWith(".gguf")) {
        throw new Error("Invalid model file name.");
    }
    if (target === root || !target.startsWith(root + path.sep)) {
        throw new Error("Invalid model file name.");
    }
    const matchingKeys = [...modelCache.keys()].filter((key) => key.startsWith(`${target}\0`));
    if (matchingKeys.some((key) => (activeModelUsers.get(key) ?? 0) > 0)) {
        throw new Error("This model cannot be deleted while it is generating a response.");
    }
    if ([...modelLoads.keys()].some((key) => key.startsWith(`${target}\0`))) {
        throw new Error("This model cannot be deleted while it is still loading.");
    }

    const modelsToDispose: LlamaModel[] = [];
    for (const [key, model] of modelCache) {
        if (key.startsWith(`${target}\0`)) {
            modelCache.delete(key);
            modelLastUsed.delete(key);
            modelsToDispose.push(model);
        }
    }
    await Promise.allSettled(modelsToDispose.map((model) => model.dispose()));
    fs.rmSync(target, { force: true });
    scheduleIdleEviction();
}

// Maps this app's provider-agnostic ChatMessage[] (system/user/assistant,
// full history resent on every call — same shape every provider gets) onto
// node-llama-cpp's ChatHistoryItem[] shape. Tool/function-calling isn't
// wired up for this backend yet, so "tool" role messages and any tool calls
// on assistant messages are dropped rather than mistranslated.
function toHistory(messages: ChatMessage[]): ChatHistoryItem[] {
    const history: ChatHistoryItem[] = [];
    for (const m of messages) {
        if (m.role === "system") history.push({ type: "system", text: m.content });
        else if (m.role === "user") history.push({ type: "user", text: m.content });
        else if (m.role === "assistant") history.push({ type: "model", response: [m.content] });
        // "tool" messages are skipped — see note above.
    }
    return history;
}

export async function chat(
    modelPath: string,
    messages: ChatMessage[],
    options: ChatOptions | undefined,
    onToken: (chunk: ChatChunk) => void,
    signal?: AbortSignal,
    tools?: ToolDefinition[]
): Promise<void> {
    if (tools && tools.length > 0) {
        throw new Error(
            "Agent mode isn't supported yet for the llama.cpp backend — switch to Ollama, OpenAI, or Claude for tool-calling, or turn Agent mode off."
        );
    }

    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
            lastUserIndex = i;
            break;
        }
    }
    if (lastUserIndex === -1) throw new Error("No user message to respond to.");

    const cacheKey = modelCacheKey(modelPath, options?.gpuLayers);
    const model = await loadModel(modelPath, options?.gpuLayers);
    activeModelUsers.set(cacheKey, (activeModelUsers.get(cacheKey) ?? 0) + 1);
    modelLastUsed.set(cacheKey, Date.now());
    // A fresh context per call re-evaluates the whole conversation history
    // every turn instead of reusing a warm KV cache across turns — simpler
    // and always correct, at the cost of redoing prompt-processing work on
    // every message. Session-affinity caching (keeping a session alive
    // across turns of the same conversation) would fix that but needs a
    // stable conversation identity to key off of, which isn't threaded
    // through this call today.
    let context: Awaited<ReturnType<LlamaModel["createContext"]>> | null = null;
    try {
        const { LlamaChatSession } = await loadNodeLlamaCpp();
        context = await model.createContext({ contextSize: options?.contextLength });
        const sequence = context.getSequence();
        const priorMessages = messages.slice(0, lastUserIndex);
        const session = new LlamaChatSession({ contextSequence: sequence });
        if (priorMessages.length > 0) session.setChatHistory(toHistory(priorMessages));

        await session.prompt(messages[lastUserIndex].content, {
            signal,
            temperature: options?.temperature,
            topP: options?.topP,
            topK: options?.topK,
            maxTokens: options?.maxTokens,
            seed: options?.seed,
            customStopTriggers: options?.stop,
            onTextChunk: (text) => onToken({ message: { role: "assistant", content: text }, done: false }),
        });
        onToken({ done: true });
    } finally {
        if (context) await context.dispose();
        const users = Math.max(0, (activeModelUsers.get(cacheKey) ?? 1) - 1);
        if (users === 0) activeModelUsers.delete(cacheKey);
        else activeModelUsers.set(cacheKey, users);
        modelLastUsed.set(cacheKey, Date.now());
        await evictIdleModels();
        scheduleIdleEviction();
    }
}
