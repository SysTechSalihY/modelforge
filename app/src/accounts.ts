import * as secretsStore from "./secrets-store";

export type AccountProvider = "github" | "huggingface";

export interface LinkedAccount {
    provider: AccountProvider;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    profileUrl: string;
}

const TOKEN_KEYS: Record<AccountProvider, string> = {
    github: "github_token",
    huggingface: "huggingface_token",
};

function assertProvider(provider: AccountProvider): void {
    if (provider !== "github" && provider !== "huggingface") throw new Error("Unsupported account provider.");
}

async function requestProfile(provider: AccountProvider, token: string): Promise<LinkedAccount> {
    const url = provider === "github" ? "https://api.github.com/user" : "https://huggingface.co/api/whoami-v2";
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (provider === "github") {
        headers["X-GitHub-Api-Version"] = "2026-03-10";
        headers["User-Agent"] = "Modelforge";
    }
    let response: Response;
    try {
        response = await fetch(url, { headers });
    } catch (error) {
        throw new Error(`Couldn't reach ${provider === "github" ? "GitHub" : "Hugging Face"}: ${(error as Error).message}`);
    }
    if (response.status === 401) throw new Error("The token is invalid or has expired.");
    if (!response.ok) throw new Error(`Account verification failed (HTTP ${response.status}).`);
    const data = await response.json() as Record<string, unknown>;
    const username = String(provider === "github" ? data.login ?? "" : data.name ?? data.username ?? "");
    if (!username) throw new Error("The account provider returned an incomplete profile.");
    return {
        provider,
        username,
        displayName: typeof data.fullname === "string" ? data.fullname : typeof data.name === "string" && provider === "github" ? data.name : null,
        avatarUrl: typeof data.avatar_url === "string" ? data.avatar_url : typeof data.avatarUrl === "string" ? data.avatarUrl : null,
        profileUrl: provider === "github" ? `https://github.com/${username}` : `https://huggingface.co/${username}`,
    };
}

export async function connectAccount(provider: AccountProvider, token: string): Promise<LinkedAccount> {
    assertProvider(provider);
    const trimmed = token.trim();
    if (!trimmed) throw new Error("Enter an access token.");
    const profile = await requestProfile(provider, trimmed);
    secretsStore.setSecret(TOKEN_KEYS[provider], trimmed);
    secretsStore.setSecret(`${TOKEN_KEYS[provider]}_profile`, JSON.stringify(profile));
    return profile;
}

export function getLinkedAccount(provider: AccountProvider): LinkedAccount | null {
    assertProvider(provider);
    if (!secretsStore.hasSecret(TOKEN_KEYS[provider])) return null;
    const stored = secretsStore.getSecret(`${TOKEN_KEYS[provider]}_profile`);
    if (!stored) return null;
    try { return JSON.parse(stored) as LinkedAccount; } catch { return null; }
}

export function disconnectAccount(provider: AccountProvider): void {
    assertProvider(provider);
    secretsStore.setSecret(TOKEN_KEYS[provider], "");
    secretsStore.setSecret(`${TOKEN_KEYS[provider]}_profile`, "");
}

export function getAccountToken(provider: AccountProvider): string | null {
    assertProvider(provider);
    return secretsStore.getSecret(TOKEN_KEYS[provider]);
}
