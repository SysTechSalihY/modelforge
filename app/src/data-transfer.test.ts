import { describe, it, expect } from "vitest";
import { sessionToMarkdown } from "./data-transfer";
import type { ChatSession } from "./sessions-store";

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
    return {
        id: "1",
        title: "Test chat",
        model: "llama3.2",
        messages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("sessionToMarkdown", () => {
    it("renders the title as a heading and each message with its speaker", () => {
        const md = sessionToMarkdown(
            makeSession({
                messages: [
                    { role: "user", content: "Hello" },
                    { role: "assistant", content: "Hi there" },
                ],
            })
        );

        expect(md).toContain("# Test chat");
        expect(md).toContain("**User:**\n\nHello");
        expect(md).toContain("**Assistant:**\n\nHi there");
    });

    it("omits tool-role messages and empty tool-call assistant messages", () => {
        const md = sessionToMarkdown(
            makeSession({
                messages: [
                    { role: "user", content: "What's 2+2?" },
                    { role: "assistant", content: "", toolCalls: [{ id: "1", name: "calc", arguments: {} }] },
                    { role: "tool", content: "4", toolCallId: "1", toolName: "calc" },
                    { role: "assistant", content: "It's 4." },
                ],
            })
        );

        expect(md).not.toContain("calc");
        expect(md).not.toContain("**Tool:**");
        expect(md).toContain("It's 4.");
    });
});
