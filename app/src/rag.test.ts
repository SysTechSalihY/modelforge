import { describe, it, expect } from "vitest";
import { chunkText, cosineSimilarity } from "./rag";

describe("chunkText", () => {
    it("returns the whole text as one chunk when it's under the chunk size", () => {
        expect(chunkText("short text")).toEqual(["short text"]);
    });

    it("splits long text into overlapping chunks", () => {
        const text = "a".repeat(2500);
        const chunks = chunkText(text);

        expect(chunks.length).toBeGreaterThan(1);
        // every chunk is at most CHUNK_SIZE (1000) characters
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(1000);
        }
    });

    it("covers the entire input with no gaps between chunks", () => {
        const text = Array.from({ length: 2500 }, (_, i) => String(i % 10)).join("");
        const chunks = chunkText(text);
        // reconstruct coverage by checking every character position appears
        // in at least one chunk at the expected offset (accounting for overlap)
        const reconstructed = chunks[0] + chunks.slice(1).map((c) => c.slice(150)).join("");
        expect(reconstructed).toBe(text);
    });
});

describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
        expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    });

    it("returns 0 for orthogonal vectors", () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it("returns -1 for opposite vectors", () => {
        expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
    });

    it("returns 0 for a zero vector instead of NaN", () => {
        expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    });
});
