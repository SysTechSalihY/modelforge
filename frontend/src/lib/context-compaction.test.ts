import { describe, it, expect } from "vitest";
import {
    estimateTokens,
    estimateMessagesTokens,
    planCompaction,
    shouldCompact,
    buildSummarizationPrompt,
} from "./context-compaction";
import type { ChatMessage } from "@/types/electron";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
    return { role, content };
}

describe("estimateTokens", () => {
    it("scales roughly with character count", () => {
        expect(estimateTokens("")).toBe(0);
        expect(estimateTokens("a".repeat(400))).toBe(100);
    });
});

describe("estimateMessagesTokens", () => {
    it("sums estimated tokens across messages", () => {
        const messages = [msg("user", "a".repeat(40)), msg("assistant", "b".repeat(80))];
        expect(estimateMessagesTokens(messages)).toBe(10 + 20);
    });
});

describe("planCompaction", () => {
    it("keeps everything when there aren't more messages than keepRecent", () => {
        const messages = Array.from({ length: 5 }, (_, i) => msg("user", `msg ${i}`));
        const plan = planCompaction(messages, 0, 12);
        expect(plan.toFold).toEqual([]);
        expect(plan.kept).toEqual(messages);
    });

    it("folds everything except the most recent keepRecent messages", () => {
        const messages = Array.from({ length: 20 }, (_, i) => msg("user", `msg ${i}`));
        const plan = planCompaction(messages, 0, 12);
        expect(plan.toFold).toHaveLength(8);
        expect(plan.kept).toHaveLength(12);
        expect(plan.kept[0].content).toBe("msg 8");
        expect(plan.foldEndIndex).toBe(8);
    });

    it("never re-folds messages already covered by a previous compaction", () => {
        const messages = Array.from({ length: 20 }, (_, i) => msg("user", `msg ${i}`));
        const plan = planCompaction(messages, 8, 12);
        expect(plan.toFold).toEqual([]);
        expect(plan.kept).toHaveLength(12);
    });

    it("folds only the newly-eligible slice on a second compaction pass", () => {
        const messages = Array.from({ length: 30 }, (_, i) => msg("user", `msg ${i}`));
        const plan = planCompaction(messages, 8, 12);
        expect(plan.toFold).toHaveLength(10);
        expect(plan.toFold[0].content).toBe("msg 8");
        expect(plan.kept).toHaveLength(12);
    });
});

describe("shouldCompact", () => {
    const keepRecent = 12;
    const budget = 100;

    it("returns false when there's nothing beyond the recent window", () => {
        const messages = Array.from({ length: 12 }, () => msg("user", "x".repeat(1000)));
        expect(shouldCompact(messages, 0, keepRecent, budget)).toBe(false);
    });

    it("returns false when the unfolded portion is under budget", () => {
        const messages = Array.from({ length: 20 }, () => msg("user", "hi"));
        expect(shouldCompact(messages, 0, keepRecent, budget)).toBe(false);
    });

    it("returns true when the unfolded portion exceeds the token budget", () => {
        const messages = Array.from({ length: 20 }, () => msg("user", "x".repeat(1000)));
        expect(shouldCompact(messages, 0, keepRecent, budget)).toBe(true);
    });

    it("re-evaluates against only what's beyond the already-folded count", () => {
        const messages = Array.from({ length: 20 }, () => msg("user", "x".repeat(1000)));
        // Everything but the recent window is already folded, so nothing new to weigh.
        expect(shouldCompact(messages, 8, keepRecent, budget)).toBe(false);
    });
});

describe("buildSummarizationPrompt", () => {
    it("includes the transcript with speaker labels", () => {
        const prompt = buildSummarizationPrompt(null, [msg("user", "hello"), msg("assistant", "hi there")]);
        expect(prompt).toContain("User: hello");
        expect(prompt).toContain("Assistant: hi there");
    });

    it("carries forward an existing summary for incremental compaction", () => {
        const prompt = buildSummarizationPrompt("earlier context here", [msg("user", "more")]);
        expect(prompt).toContain("Existing summary of earlier context:\nearlier context here");
    });

    it("omits tool-role messages from the excerpt", () => {
        const prompt = buildSummarizationPrompt(null, [
            msg("user", "run the tests"),
            { role: "tool", content: "42 passed", toolName: "run_command" },
            msg("assistant", "all green"),
        ]);
        expect(prompt).not.toContain("42 passed");
        expect(prompt).toContain("run the tests");
        expect(prompt).toContain("all green");
    });
});
