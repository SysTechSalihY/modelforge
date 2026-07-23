import { spawn, ChildProcess } from "node:child_process";
import { logger } from "./logger";

// Inference backends node-llama-cpp can't serve (it only ships CUDA/Vulkan/
// Metal prebuilds) are run as external server processes that expose the
// OpenAI-compatible chat-completions API, and chat traffic goes through the
// same openai-compatible client the cloud providers use:
//
// - "mlx": Apple-Silicon inference via Python's mlx_lm package
//   (`python3 -m mlx_lm.server`). Models are Hugging Face repo ids or local
//   paths; the server downloads/loads them itself.
// - "rocm": AMD-GPU inference via a ROCm/HIP build of llama.cpp's
//   `llama-server` binary (the official llama.cpp releases ship one), run
//   against the same GGUF files the built-in llama.cpp backend uses.
export type LocalBackendId = "mlx" | "rocm" | "vllm";

export interface LocalBackendConfig {
    // Path to the ROCm llama-server binary. No sensible default beyond PATH
    // lookup — the user downloads a HIP build themselves.
    rocmServerPath?: string;
    // Python interpreter used to launch mlx_lm.server (needs `pip install mlx-lm`).
    mlxPythonPath?: string;
    // Optional override; managed vLLM uses the `vllm` command from PATH.
    vllmCommand?: string;
}

export interface LocalRuntimeStatus {
    backend: LocalBackendId;
    compatible: boolean;
    installed: boolean;
    running: boolean;
    model?: string;
    detail: string;
}

export interface RuntimeProbe {
    compatible: boolean;
    command: string;
    args: string[];
    detail: string;
}

interface RunningServer {
    process: ChildProcess;
    model: string;
    baseUrl: string;
    exited: boolean;
    activeRequests: number;
    idleTimer: NodeJS.Timeout | null;
}

// Fixed per-backend ports so a restarted app reconnects rather than leaking
// orphan servers across random ports.
const PORTS: Record<LocalBackendId, number> = { mlx: 8790, rocm: 8791, vllm: 8792 };
// First startup can include downloading/loading a multi-GB model.
const STARTUP_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 750;
const configuredIdleMinutes = Number(process.env.OLLAMA_CUSTOM_UI_LOCAL_BACKEND_IDLE_MINUTES ?? 10);
const IDLE_TIMEOUT_MS = Number.isFinite(configuredIdleMinutes)
    ? Math.max(0, configuredIdleMinutes) * 60_000
    : 10 * 60_000;

const servers = new Map<LocalBackendId, RunningServer>();
const serverStarts = new Map<LocalBackendId, { model: string; promise: Promise<string> }>();

export function buildRuntimeProbe(
    backend: LocalBackendId,
    config: LocalBackendConfig,
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch
): RuntimeProbe {
    if (backend === "mlx") {
        const compatible = platform === "darwin" && arch === "arm64";
        return {
            compatible,
            command: config.mlxPythonPath?.trim() || "python3",
            args: ["-c", "import mlx_lm"],
            detail: compatible ? "Apple Silicon accelerated runtime" : "Requires an Apple Silicon Mac",
        };
    }
    if (backend === "vllm") {
        const compatible = platform === "linux" || platform === "win32";
        if (!config.vllmCommand?.trim() && platform === "win32") {
            return {
                compatible,
                command: "wsl.exe",
                args: ["--", "vllm", "--version"],
                detail: "CUDA or ROCm runtime through WSL",
            };
        }
        return {
            compatible,
            command: config.vllmCommand?.trim() || "vllm",
            args: ["--version"],
            detail: compatible ? "High-throughput CUDA or ROCm runtime" : "Requires Linux or Windows with WSL",
        };
    }
    const compatible = platform === "linux" || !!config.rocmServerPath?.trim();
    return {
        compatible,
        command: config.rocmServerPath?.trim() || "llama-server",
        args: ["--version"],
        detail: compatible ? "AMD GPU runtime for local GGUF models" : "Requires Linux and a ROCm-capable AMD GPU",
    };
}

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        let timer: NodeJS.Timeout;
        const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        let child: ChildProcess;
        try {
            child = spawn(command, args, { stdio: "ignore" });
        } catch {
            resolve(false);
            return;
        }
        timer = setTimeout(() => {
            child.kill();
            finish(false);
        }, 5_000);
        timer.unref();
        child.once("error", () => finish(false));
        child.once("exit", (code) => finish(code === 0));
    });
}

export async function getRuntimeStatuses(config: LocalBackendConfig): Promise<LocalRuntimeStatus[]> {
    return Promise.all(
        (["rocm", "mlx", "vllm"] as const).map(async (backend) => {
            const probe = buildRuntimeProbe(backend, config);
            const running = servers.get(backend);
            const installed = probe.compatible && (running ? !running.exited : await commandSucceeds(probe.command, probe.args));
            return {
                backend,
                compatible: probe.compatible,
                installed,
                running: !!running && !running.exited,
                model: running && !running.exited ? running.model : undefined,
                detail: probe.detail,
            };
        })
    );
}

function clearIdleTimer(server: RunningServer): void {
    if (!server.idleTimer) return;
    clearTimeout(server.idleTimer);
    server.idleTimer = null;
}

function scheduleIdleStop(backend: LocalBackendId, server: RunningServer): void {
    clearIdleTimer(server);
    if (IDLE_TIMEOUT_MS === 0 || server.activeRequests > 0 || server.exited) return;
    server.idleTimer = setTimeout(() => {
        server.idleTimer = null;
        if (servers.get(backend) === server && server.activeRequests === 0) {
            logger.info(`Stopping idle ${backend} runtime to release GPU memory`);
            stopServer(backend);
        }
    }, IDLE_TIMEOUT_MS);
    server.idleTimer.unref();
}

export function buildServerCommand(
    backend: LocalBackendId,
    model: string,
    config: LocalBackendConfig,
    platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } {
    const port = PORTS[backend];
    if (backend === "mlx") {
        return {
            command: config.mlxPythonPath?.trim() || "python3",
            args: ["-m", "mlx_lm.server", "--model", model, "--port", String(port), "--host", "127.0.0.1"],
        };
    }
    if (backend === "vllm") {
        const args = ["serve", model, "--port", String(port), "--host", "127.0.0.1"];
        if (!config.vllmCommand?.trim() && platform === "win32") {
            return { command: "wsl.exe", args: ["--", "vllm", ...args] };
        }
        return {
            command: config.vllmCommand?.trim() || "vllm",
            args,
        };
    }
    return {
        command: config.rocmServerPath?.trim() || "llama-server",
        args: [
            "-m", model,
            "--port", String(port),
            "--host", "127.0.0.1",
            // Offload everything; llama-server clamps to what actually fits.
            "--n-gpu-layers", "999",
        ],
    };
}

export function describeSpawnFailure(backend: LocalBackendId): string {
    if (backend === "mlx") {
        return "Couldn't launch the managed MLX runtime — install mlx-lm (pip install mlx-lm) on an Apple Silicon Mac.";
    }
    if (backend === "vllm") {
        return "Couldn't launch the managed vLLM runtime — install vLLM so the vllm command is available (pip install vllm).";
    }
    return "Couldn't launch the managed ROCm runtime — install a ROCm/HIP llama-server build and make llama-server available on PATH.";
}

// Any HTTP response means the server socket is up (a 404 from a route probe
// is still proof of life); only a network-level failure counts as down.
async function isReachable(baseUrl: string): Promise<boolean> {
    try {
        await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startOrReuseServer(
    backend: LocalBackendId,
    model: string,
    config: LocalBackendConfig
): Promise<string> {
    const existing = servers.get(backend);
    if (existing && !existing.exited && existing.model === model) {
        if (await isReachable(existing.baseUrl)) return existing.baseUrl;
        // Process alive but unresponsive — restart it below.
    }
    if (existing) {
        if (existing.activeRequests > 0) {
            throw new Error(`The ${backend} runtime is busy. Wait for the active response before changing models.`);
        }
        clearIdleTimer(existing);
        existing.process.kill();
        servers.delete(backend);
    }

    const baseUrl = `http://127.0.0.1:${PORTS[backend]}`;
    const { command, args } = buildServerCommand(backend, model, config);
    logger.info(`Starting ${backend} server: ${command} ${args.join(" ")}`);

    let child: ChildProcess;
    try {
        child = spawn(command, args, { stdio: "ignore" });
    } catch {
        throw new Error(describeSpawnFailure(backend));
    }

    const entry: RunningServer = {
        process: child,
        model,
        baseUrl,
        exited: false,
        activeRequests: 0,
        idleTimer: null,
    };
    servers.set(backend, entry);

    let spawnError: string | null = null;
    child.on("error", (err) => {
        spawnError = (err as NodeJS.ErrnoException).code === "ENOENT" ? describeSpawnFailure(backend) : err.message;
        entry.exited = true;
    });
    child.on("exit", (code) => {
        entry.exited = true;
        if (code !== 0 && code !== null) logger.warn(`${backend} server exited with code ${code}`);
    });

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (spawnError) throw new Error(spawnError);
        if (entry.exited) {
            servers.delete(backend);
            throw new Error(
                backend === "mlx"
                    ? "The MLX runtime exited during startup — check that mlx-lm is installed and the model id is valid."
                    : backend === "vllm"
                      ? "The vLLM runtime exited during startup — check that vLLM supports this model and that enough GPU memory is available."
                      : "The ROCm runtime exited during startup — check that llama-server is a working HIP build and the model is a valid GGUF."
            );
        }
        if (await isReachable(baseUrl)) return baseUrl;
        await sleep(HEALTH_POLL_MS);
    }
    child.kill();
    servers.delete(backend);
    throw new Error(`The ${backend} server didn't become reachable within ${STARTUP_TIMEOUT_MS / 1000}s.`);
}

export async function ensureServer(
    backend: LocalBackendId,
    model: string,
    config: LocalBackendConfig
): Promise<string> {
    const pending = serverStarts.get(backend);
    if (pending) {
        if (pending.model === model) return pending.promise;
        await pending.promise.catch(() => undefined);
        return ensureServer(backend, model, config);
    }

    const promise = startOrReuseServer(backend, model, config);
    serverStarts.set(backend, { model, promise });
    try {
        return await promise;
    } finally {
        if (serverStarts.get(backend)?.promise === promise) serverStarts.delete(backend);
    }
}

export async function acquireServer(
    backend: LocalBackendId,
    model: string,
    config: LocalBackendConfig
): Promise<{ baseUrl: string; release(): void }> {
    const current = servers.get(backend);
    if (current) clearIdleTimer(current);
    const baseUrl = await ensureServer(backend, model, config);
    const server = servers.get(backend);
    if (!server || server.exited || server.model !== model) {
        throw new Error(`The ${backend} runtime stopped before the request could start.`);
    }
    server.activeRequests++;
    let released = false;
    return {
        baseUrl,
        release(): void {
            if (released) return;
            released = true;
            if (servers.get(backend) !== server) return;
            server.activeRequests = Math.max(0, server.activeRequests - 1);
            scheduleIdleStop(backend, server);
        },
    };
}

export function stopServer(backend: LocalBackendId): void {
    const entry = servers.get(backend);
    if (entry) {
        clearIdleTimer(entry);
        entry.process.kill();
        servers.delete(backend);
    }
}

export function stopAll(): void {
    serverStarts.clear();
    for (const backend of [...servers.keys()]) stopServer(backend);
}

export function getRunningBackends(): { backend: LocalBackendId; model: string }[] {
    return [...servers.entries()]
        .filter(([, s]) => !s.exited)
        .map(([backend, s]) => ({ backend, model: s.model }));
}
