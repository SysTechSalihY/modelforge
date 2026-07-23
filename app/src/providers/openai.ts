import { describeHttpError, describeNetworkError } from "./errors";
import { createOpenAiCompatibleChat } from "./openai-compatible";

// Speech-to-text for voice input. Whisper's API is a separate REST endpoint
// from chat completions (multipart file upload, not JSON), so it doesn't fit
// the streaming ChatFn shape above.
export async function transcribeAudio(apiKey: string, audioBuffer: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);
    form.append("model", "whisper-1");

    let res: Response;
    try {
        res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
        });
    } catch (err) {
        throw describeNetworkError("OpenAI", err);
    }

    if (!res.ok) {
        throw new Error(await describeHttpError(res, "OpenAI"));
    }

    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
}

export const chat = createOpenAiCompatibleChat("https://api.openai.com/v1", "OpenAI");
