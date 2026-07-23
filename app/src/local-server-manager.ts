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
export type LocalBackendId = "mlx" | "rocm";

export interface LocalBackendConfig {
    // Path to the ROCm llama-server binary. No sensible default beyond PATH
    // lookup — the user downloads a HIP build themselves.
    rocmServerPath?: string;
    // Python interpreter used to launch mlx_lm.server (needs `pip install mlx-lm`).
    mlxPythonPath?: string;
}

interface RunningServer {
    process: ChildProcess;
    model: string;
    baseUrl: string;
    exited: boolean;
}

// Fixed per-backend ports so a restarted app reconnects rather than leaking
// orphan servers across random ports.
const PORTS: Record<LocalBackendId, number> = { mlx: 8790, rocm: 8791 };
// First startup can include downloading/loading a multi-GB model.
const STARTUP_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 750;

const servers = new Map<LocalBackendId, RunningServer>();

export function buildServerCommand(
    backend: LocalBackendId,
    model: string,
    config: LocalBackendConfig
): { command: string; args: string[] } {
    const port = PORTS[backend];
    if (backend === "mlx") {
        return {
            command: config.mlxPythonPath?.trim() || "python3",
            args: ["-m", "mlx_lm.server", "--model", model, "--port", String(port), "--host", "127.0.0.1"],
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
    return backend === "mlx"
        ? "Couldn't launch the MLX server — it needs Python with the mlx-lm package (pip install mlx-lm), available on Apple Silicon Macs."
        : "Couldn't launch llama-server — set the path to a ROCm (HIP) build of llama.cpp's llama-server binary in Settings.";
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

export async function ensureServer(
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

    const entry: RunningServer = { process: child, model, baseUrl, exited: false };
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
                    ? "The MLX server exited during startup — check that mlx-lm is installed and the model id is valid."
                    : "llama-server exited during startup — check that the binary is a working ROCm build and the model file is a valid GGUF."
            );
        }
        if (await isReachable(baseUrl)) return baseUrl;
        await sleep(HEALTH_POLL_MS);
    }
    child.kill();
    servers.delete(backend);
    throw new Error(`The ${backend} server didn't become reachable within ${STARTUP_TIMEOUT_MS / 1000}s.`);
}

export function stopServer(backend: LocalBackendId): void {
    const entry = servers.get(backend);
    if (entry) {
        entry.process.kill();
        servers.delete(backend);
    }
}

export function stopAll(): void {
    for (const backend of [...servers.keys()]) stopServer(backend);
}

export function getRunningBackends(): { backend: LocalBackendId; model: string }[] {
    return [...servers.entries()]
        .filter(([, s]) => !s.exited)
        .map(([backend, s]) => ({ backend, model: s.model }));
}
