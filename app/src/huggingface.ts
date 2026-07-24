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

function parseContentRangeTotal(headerValue: string | null): number | null {
    // "bytes 12345-67890/98765" — the part after the slash is the full size.
    const match = headerValue?.match(/\/(\d+)$/);
    return match ? Number(match[1]) : null;
}

export async function downloadGgufFile(
    modelId: string,
    filename: string,
    destPath: string,
    onProgress: (progress: DownloadProgress) => void,
    token?: string | null
): Promise<void> {
    const fs = await import("node:fs");
    const url = `https://huggingface.co/${modelId}/resolve/main/${encodeURIComponent(filename)}`;
    const partPath = destPath + PARTIAL_DOWNLOAD_SUFFIX;

    // A .part file left over from a dropped connection or a force-quit is
    // real progress, not garbage — resume it with a Range request instead of
    // re-downloading from byte zero every time.
    let existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`;

    let res: Response;
    try {
        res = await fetch(url, { headers });
    } catch (err) {
        throw new Error(`Couldn't reach Hugging Face: ${(err as Error).message}`);
    }

    if (existingBytes > 0 && res.status === 416) {
        // Our partial is already >= what the server has now (stale, or the
        // remote file changed) — it can't be resumed, so start clean once.
        fs.rmSync(partPath, { force: true });
        return downloadGgufFile(modelId, filename, destPath, onProgress, token);
    }
    let resuming = existingBytes > 0 && res.status === 206;
    if (existingBytes > 0 && !resuming) {
        // Server ignored the Range request and is sending the whole file
        // from the start — appending that to the stale partial would
        // corrupt it, so discard the partial and treat this as fresh.
        existingBytes = 0;
    }

    if (!res.ok || !res.body) throw new Error(`Failed to download "${filename}" (HTTP ${res.status}).`);

    const contentLength = Number(res.headers.get("content-length")) || null;
    const totalBytes = resuming
        ? (parseContentRangeTotal(res.headers.get("content-range")) ?? (contentLength !== null ? existingBytes + contentLength : null))
        : contentLength;

    let receivedBytes = existingBytes;
    const writeStream = fs.createWriteStream(partPath, { flags: resuming ? "a" : "w" });
    const reader = res.body.getReader();
    onProgress({ receivedBytes, totalBytes });

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
        // Deliberately not deleting partPath — a dropped connection here
        // leaves real, resumable progress on disk for the next attempt.
        // Waited out rather than fire-and-forget so the partial bytes are
        // actually flushed to disk before this function returns.
        await new Promise<void>((resolve) => writeStream.end(() => resolve()));
        throw err;
    }
    await new Promise<void>((resolve, reject) => {
        writeStream.once("error", reject);
        writeStream.end(() => resolve());
    });
    if (totalBytes !== null && receivedBytes !== totalBytes) {
        throw new Error(
            `Download of "${filename}" was incomplete (got ${receivedBytes} of ${totalBytes} bytes) — try downloading it again to resume.`
        );
    }
    fs.renameSync(partPath, destPath);
}
