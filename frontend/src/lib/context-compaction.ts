import type { ChatMessage } from "@/types/electron";

// No tokenizer is wired up per-provider, so this trades precision for a
// heuristic that works everywhere without pulling in a vendor-specific
// tokenizer just to decide "is this conversation getting long".
const CHARS_PER_TOKEN = 4;

// Never folded away — keeps immediate context exact so the model doesn't
// lose track of what was just said.
export const COMPACTION_KEEP_RECENT = 12;
// Conservative across providers; well under even the smallest context
// windows in this app's model catalog once system prompts and a response
// budget are accounted for.
export const COMPACTION_BUDGET_TOKENS = 6000;

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export interface CompactionPlan {
    toFold: ChatMessage[];
    kept: ChatMessage[];
    foldEndIndex: number;
}

// Decides which messages get folded into a running summary vs. kept
// verbatim. Never re-folds anything already covered by `alreadyFoldedCount`,
// and never folds into the last `keepRecent` messages.
export function planCompaction(
    messages: ChatMessage[],
    alreadyFoldedCount: number,
    keepRecent: number
): CompactionPlan {
    const foldEndIndex = Math.max(alreadyFoldedCount, messages.length - keepRecent);
    return {
        toFold: messages.slice(alreadyFoldedCount, foldEndIndex),
        kept: messages.slice(foldEndIndex),
        foldEndIndex,
    };
}

export function shouldCompact(
    messages: ChatMessage[],
    alreadyFoldedCount: number,
    keepRecent: number,
    budgetTokens: number
): boolean {
    if (messages.length - alreadyFoldedCount <= keepRecent) return false;
    return estimateMessagesTokens(messages.slice(alreadyFoldedCount)) > budgetTokens;
}

// Tool call/result messages are dropped from the excerpt handed to the
// summarizer — they're agent-mode bookkeeping the model can act on later
// via read_notes if it mattered, not context a summary needs to preserve.
export function buildSummarizationPrompt(previousSummary: string | null, toFold: ChatMessage[]): string {
    const transcript = toFold
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
    const previous = previousSummary ? `Existing summary of earlier context:\n${previousSummary}\n\n` : "";
    return (
        `${previous}Summarize the following conversation excerpt concisely, preserving names, decisions, ` +
        `numbers, and anything a continuation of this conversation would need to know. Write it as a compact ` +
        `paragraph or short bullet list, not a transcript — this replaces the original messages in the model's ` +
        `context, so it needs to stand on its own.\n\n${transcript}`
    );
}
