// Cloud provider error bodies are JSON like {"error": {"message": "..."}}
// (OpenAI) or {"error": {"message": "..."}} (Anthropic too) — pull the human
// message out instead of dumping the raw response body at users.
export async function describeHttpError(res: Response, providerLabel: string): Promise<string> {
    const raw = await res.text().catch(() => "");
    try {
        const parsed = JSON.parse(raw);
        const message = parsed?.error?.message;
        if (typeof message === "string" && message) return `${providerLabel}: ${message}`;
    } catch {
        // not JSON — fall through to the raw text
    }
    return `${providerLabel} request failed (HTTP ${res.status})${raw ? `: ${raw.slice(0, 300)}` : ""}`;
}

export function describeNetworkError(providerLabel: string, err: unknown): Error {
    if (err instanceof Error && err.name === "AbortError") return err;
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Can't reach ${providerLabel} — check your internet connection. (${message})`);
}
