import { describe, it, expect } from "vitest";
import { parseFigmaUrl } from "./figma";

describe("parseFigmaUrl", () => {
    it("parses a classic /file/ link with a node-id", () => {
        expect(parseFigmaUrl("https://www.figma.com/file/abc123/My-Design?node-id=1-2")).toEqual({
            fileKey: "abc123",
            nodeId: "1:2",
        });
    });

    it("parses a /design/ link with a node-id", () => {
        expect(parseFigmaUrl("https://www.figma.com/design/xyz789/My-Design?node-id=45-67&t=abc")).toEqual({
            fileKey: "xyz789",
            nodeId: "45:67",
        });
    });

    it("decodes a URL-encoded node-id", () => {
        expect(parseFigmaUrl("https://www.figma.com/file/abc123/x?node-id=1%3A2")).toEqual({
            fileKey: "abc123",
            nodeId: "1:2",
        });
    });

    it("returns null for a file link with no node-id (no specific frame selected)", () => {
        expect(parseFigmaUrl("https://www.figma.com/file/abc123/My-Design")).toBeNull();
    });

    it("returns null for a non-Figma URL", () => {
        expect(parseFigmaUrl("https://example.com/not-figma")).toBeNull();
    });
});
