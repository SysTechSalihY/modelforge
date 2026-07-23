import { describeHttpError, describeNetworkError } from "./errors";
import { streamSSE } from "./sse";
import type { ChatFn, ChatMessage } from "./types";

interface GeminiPart {
    text?: string;
    inlineData?: { mimeType: string; data: string };
}

interface GeminiContent {
    role: "user" | "model";
    parts: GeminiPart[];
}

// Gemini's request shape is meaningfully different from the OpenAI-style APIs
// (system prompt is a separate top-level field, "assistant" is called
// "model", and there's no "tool" role) — a real implementation, not a thin
// wrapper over openai-compatible.ts.
function toGeminiContents(messages: ChatMessage[]): { system?: string; contents: GeminiContent[] } {
    let system: string | undefined;
    const contents: GeminiContent[] = [];
    for (const m of messages) {
        if (m.role === "system") {
            system = system ? `${system}\n\n${m.content}` : m.content;
            continue;
        }
        if (m.role === "tool") continue; // not supported yet — see chat() below
        const parts: GeminiPart[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.images) {
            for (const img of m.images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
    }
    return { system, contents };
}

export const chat: ChatFn = async (apiKey, model, messages, options, onToken, signal, tools) => {
    if (tools && tools.length > 0) {
        throw new Error(
            "Agent mode isn't supported yet for Gemini — switch to OpenAI, Claude, or a local model for tool-calling, or turn Agent mode off."
        );
    }

    const { system, contents } = toGeminiContents(messages);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents,
                ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
                generationConfig: {
                    temperature: options?.temperature ?? 0.7,
                    topP: options?.topP,
                    topK: options?.topK,
                    maxOutputTokens: options?.maxTokens,
                    stopSequences: options?.stop && options.stop.length > 0 ? options.stop : undefined,
                },
            }),
            signal,
        });
    } catch (err) {
        throw describeNetworkError("Gemini", err);
    }

    if (!res.ok || !res.body) {
        throw new Error(await describeHttpError(res, "Gemini"));
    }

    await streamSSE(res, (payload) => {
        try {
            const parsed = JSON.parse(payload);
            const text = parsed.candidates?.[0]?.content?.parts
                ?.map((p: GeminiPart) => p.text ?? "")
                .join("");
            if (text) onToken({ message: { role: "assistant", content: text }, done: false });

            if (parsed.usageMetadata) {
                onToken({
                    done: false,
                    usage: {
                        promptTokens: parsed.usageMetadata.promptTokenCount,
                        completionTokens: parsed.usageMetadata.candidatesTokenCount,
                    },
                });
            }
        } catch {
            // ignore malformed payload
        }
    });
    onToken({ done: true });
};
