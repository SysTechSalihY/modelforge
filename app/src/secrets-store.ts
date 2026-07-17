import * as path from "node:path";
import { app, safeStorage } from "electron";
import { readJson, writeJson } from "./json-store";

function filePath(): string {
    return path.join(app.getPath("userData"), "secrets.json");
}

function readAll(): Record<string, string> {
    return readJson<Record<string, string>>(filePath(), {});
}

function writeAll(data: Record<string, string>): void {
    writeJson(filePath(), data);
}

export function setSecret(key: string, value: string): void {
    const all = readAll();
    if (!value) {
        delete all[key];
    } else if (safeStorage.isEncryptionAvailable()) {
        all[key] = safeStorage.encryptString(value).toString("base64");
    } else {
        // Fallback for environments without an OS credential store (e.g. some
        // Linux setups with no keyring). Better to work than to silently drop the key.
        all[key] = value;
    }
    writeAll(all);
}

export function getSecret(key: string): string | null {
    const stored = readAll()[key];
    if (!stored) return null;
    if (safeStorage.isEncryptionAvailable()) {
        try {
            return safeStorage.decryptString(Buffer.from(stored, "base64"));
        } catch {
            // Might be a plaintext fallback value written when encryption was unavailable.
            return stored;
        }
    }
    return stored;
}

export function hasSecret(key: string): boolean {
    return !!readAll()[key];
}
