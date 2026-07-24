const HF_API = "https://huggingface.co/api";

export interface HfModelSummary {
    id: string;
    downloads: number;
    likes: number;
    tags: string[];
}

export interface HfGgufFile {
    path: string;
    sizeBytes: number | null;
}

async function hfFetchJson<T>(url: string, token?: string | null): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    } catch (err) {
        throw new Error(`Couldn't reach the Hugging Face API: ${(err as Error).message}`);
    }
    if (!res.ok) throw new Error(`Hugging Face API error (HTTP ${res.status}).`);
    return (await res.json()) as T;
}

// Hugging Face's search endpoint already supports filtering by library/tag —
// "gguf" narrows results to repos that have at least one GGUF file, which is
// what matters for both the Ollama and llama.cpp backends this app supports.
export async function searchGgufModels(query: string, limit = 20, token?: string | null): Promise<HfModelSummary[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const url = `${HF_API}/models?search=${encodeURIComponent(trimmed)}&filter=gguf&sort=downloads&direction=-1&limit=${limit}`;
    const data = await hfFetchJson<{ id: string; downloads?: number; likes?: number; tags?: string[] }[]>(url, token);
    return data.map((m) => ({ id: m.id, downloads: m.downloads ?? 0, likes: m.likes ?? 0, tags: m.tags ?? [] }));
}

export async function listGgufFiles(modelId: string, token?: string | null): Promise<HfGgufFile[]> {
    const url = `${HF_API}/models/${modelId}/tree/main`;
    const data = await hfFetchJson<{ path: string; type: string; size?: number }[]>(url, token);
    return data
        .filter((entry) => entry.type === "file" && entry.path.toLowerCase().endsWith(".gguf"))
        .map((entry) => ({ path: entry.path, sizeBytes: entry.size ?? null }));
}

export interface DownloadProgress {
    receivedBytes: number;
    totalBytes: number | null;
}

// Suffix for in-progress downloads. Writing directly to the final .gguf name
// would let a truncated file — from a network drop, a crash, or the app
// being force-quit mid-download, none of which run our error-path cleanup —
// sit there indistinguishable from a real model, so listModels() would offer
// it and loading it would fail with a confusing "corrupt GGUF" error instead
// of the app just not knowing about it.
export const PARTIAL_DOWNLOAD_SUFFIX = ".part";

export async function downloadGgufFile(
    modelId: string,
    filename: string,
    destPath: string,
    onProgress: (progress: DownloadProgress) => void,
    token?: string | null
): Promise<void> {
    const fs = await import("node:fs");
    const url = `https://huggingface.co/${modelId}/resolve/main/${encodeURIComponent(filename)}`;
    let res: Response;
    try {
        res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    } catch (err) {
        throw new Error(`Couldn't reach Hugging Face: ${(err as Error).message}`);
    }
    if (!res.ok || !res.body) throw new Error(`Failed to download "${filename}" (HTTP ${res.status}).`);

    const totalBytes = Number(res.headers.get("content-length")) || null;
    let receivedBytes = 0;
    const partPath = destPath + PARTIAL_DOWNLOAD_SUFFIX;
    const writeStream = fs.createWriteStream(partPath);
    const reader = res.body.getReader();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes += value.byteLength;
            onProgress({ receivedBytes, totalBytes });
            await new Promise<void>((resolve, reject) => {
                writeStream.write(value, (err) => (err ? reject(err) : resolve()));
            });
        }
    } catch (err) {
        writeStream.end();
        fs.rmSync(partPath, { force: true });
        throw err;
    }
    await new Promise<void>((resolve, reject) => {
        writeStream.once("error", reject);
        writeStream.end(() => resolve());
    });
    if (totalBytes !== null && receivedBytes !== totalBytes) {
        fs.rmSync(partPath, { force: true });
        throw new Error(`Download of "${filename}" was incomplete (got ${receivedBytes} of ${totalBytes} bytes).`);
    }
    fs.renameSync(partPath, destPath);
}

// Leftover *.gguf.part files can only come from a download that never
// finished (crash, force-quit, killed process) — there's no resume support,
// so they're permanently unusable. Called once at startup rather than left
// for the user to notice a phantom download stuck at some old percentage.
export async function cleanupIncompleteDownloads(modelsDir: string): Promise<void> {
    const fs = await import("node:fs");
    const path = await import("node:path");
    if (!fs.existsSync(modelsDir)) return;
    for (const f of fs.readdirSync(modelsDir)) {
        if (f.toLowerCase().endsWith(PARTIAL_DOWNLOAD_SUFFIX)) {
            fs.rmSync(path.join(modelsDir, f), { force: true });
        }
    }
}
