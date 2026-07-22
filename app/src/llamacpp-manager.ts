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
let activeBackend: GpuBackend = "auto";
// Loaded model weights are the expensive, slow-to-load part (can be several
// GB) — kept warm across chat turns. The lightweight per-turn context/session
// below is deliberately NOT cached across turns; see chat() for why.
const modelCache = new Map<string, LlamaModel>();

export function setGpuBackend(backend: GpuBackend): void {
    if (backend === activeBackend) return;
    activeBackend = backend;
    // A running Llama instance is bound to whichever backend it was created
    // with — switching backends means starting over, and previously loaded
    // model weights are tied to the old instance too.
    llamaInstance = null;
    modelCache.clear();
}

async function getLlamaInstance(): Promise<Llama> {
    if (!llamaInstance) {
        const { getLlama } = await loadNodeLlamaCpp();
        llamaInstance = await getLlama({ gpu: activeBackend === "cpu" ? false : activeBackend });
    }
    return llamaInstance;
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
    const cached = modelCache.get(modelPath);
    if (cached) return cached;
    const llama = await getLlamaInstance();
    const model = await llama.loadModel({ modelPath, gpuLayers: gpuLayers ?? "auto" });
    modelCache.set(modelPath, model);
    return model;
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

export function deleteModel(modelsDir: string, name: string): void {
    const root = path.resolve(modelsDir);
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("Invalid model file name.");
    }
    fs.rmSync(target, { force: true });
    modelCache.delete(target);
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

    const model = await loadModel(modelPath, options?.gpuLayers);
    // A fresh context per call re-evaluates the whole conversation history
    // every turn instead of reusing a warm KV cache across turns — simpler
    // and always correct, at the cost of redoing prompt-processing work on
    // every message. Session-affinity caching (keeping a session alive
    // across turns of the same conversation) would fix that but needs a
    // stable conversation identity to key off of, which isn't threaded
    // through this call today.
    const { LlamaChatSession } = await loadNodeLlamaCpp();
    const context = await model.createContext({ contextSize: options?.contextLength });
    try {
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
        await context.dispose();
    }
}
