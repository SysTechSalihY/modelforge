import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { downloadGgufFile } from "./huggingface";

function fakeResponse(opts: { status: number; headers?: Record<string, string>; chunks?: string[] }) {
    const chunks = (opts.chunks ?? []).map((c) => new TextEncoder().encode(c));
    let i = 0;
    return {
        ok: opts.status >= 200 && opts.status < 300,
        status: opts.status,
        headers: { get: (name: string) => opts.headers?.[name.toLowerCase()] ?? null },
        body: {
            getReader: () => ({
                read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
            }),
        },
    } as unknown as Response;
}

describe("downloadGgufFile", () => {
    let dir: string;
    let destPath: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-download-test-"));
        destPath = path.join(dir, "model.gguf");
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("downloads fresh, reports progress, and renames the .part file to the final name on success", async () => {
        const progress: { receivedBytes: number; totalBytes: number | null }[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => fakeResponse({ status: 200, headers: { "content-length": "10" }, chunks: ["hello", "world"] }))
        );

        await downloadGgufFile("org/model", "model.gguf", destPath, (p) => progress.push(p));

        expect(fs.existsSync(destPath)).toBe(true);
        expect(fs.existsSync(destPath + ".part")).toBe(false);
        expect(fs.readFileSync(destPath, "utf8")).toBe("helloworld");
        expect(progress.at(-1)).toEqual({ receivedBytes: 10, totalBytes: 10 });
    });

    it("resumes from an existing .part file using a Range request instead of starting over", async () => {
        fs.writeFileSync(destPath + ".part", "hello");
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            expect((init?.headers as Record<string, string>).Range).toBe("bytes=5-");
            return fakeResponse({ status: 206, headers: { "content-range": "bytes 5-9/10" }, chunks: ["world"] });
        });
        vi.stubGlobal("fetch", fetchMock);

        await downloadGgufFile("org/model", "model.gguf", destPath, () => {});

        expect(fs.readFileSync(destPath, "utf8")).toBe("helloworld");
    });

    it("discards a stale partial and starts over when the server ignores the Range request", async () => {
        fs.writeFileSync(destPath + ".part", "OLD-STALE-DATA");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => fakeResponse({ status: 200, headers: { "content-length": "5" }, chunks: ["fresh"] }))
        );

        await downloadGgufFile("org/model", "model.gguf", destPath, () => {});

        expect(fs.readFileSync(destPath, "utf8")).toBe("fresh");
    });

    it("keeps the .part file (doesn't delete it) when the connection drops mid-stream, so a retry can resume", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            headers: { get: () => "20" },
            body: {
                getReader: () => ({
                    read: async () => {
                        throw new Error("connection reset");
                    },
                }),
            },
        } as unknown as Response)));

        await expect(downloadGgufFile("org/model", "model.gguf", destPath, () => {})).rejects.toThrow("connection reset");
        expect(fs.existsSync(destPath + ".part")).toBe(true);
        expect(fs.existsSync(destPath)).toBe(false);
    });

    it("keeps the .part file and throws when the stream ends short of the expected size", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => fakeResponse({ status: 200, headers: { "content-length": "100" }, chunks: ["short"] }))
        );

        await expect(downloadGgufFile("org/model", "model.gguf", destPath, () => {})).rejects.toThrow(/incomplete/);
        expect(fs.existsSync(destPath + ".part")).toBe(true);
    });

    it("discards a partial and retries once when the server responds 416 (range no longer satisfiable)", async () => {
        fs.writeFileSync(destPath + ".part", "stale");
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(fakeResponse({ status: 416 }))
            .mockResolvedValueOnce(fakeResponse({ status: 200, headers: { "content-length": "5" }, chunks: ["fresh"] }));
        vi.stubGlobal("fetch", fetchMock);

        await downloadGgufFile("org/model", "model.gguf", destPath, () => {});

        expect(fs.readFileSync(destPath, "utf8")).toBe("fresh");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
