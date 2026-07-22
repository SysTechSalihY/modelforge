import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { app, dialog, shell, BrowserWindow } from "electron";
import * as sessionsStore from "./sessions-store";
import type { ChatSession } from "./sessions-store";
import type { PromptPreset } from "./settings-store";

function sanitizeFilename(name: string): string {
    return name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 80) || "chat";
}

export async function exportSession(win: BrowserWindow | null, id: string): Promise<{ success: boolean }> {
    const session = sessionsStore.getSession(id);
    if (!session) return { success: false };

    const options = {
        defaultPath: `${sanitizeFilename(session.title)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { success: false };

    fs.writeFileSync(result.filePath, JSON.stringify(session, null, 2));
    return { success: true };
}

export async function exportAllSessions(win: BrowserWindow | null): Promise<{ success: boolean }> {
    const sessions = sessionsStore.listSessions();
    const date = new Date().toISOString().slice(0, 10);

    const options = {
        defaultPath: `modelforge-export-${date}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { success: false };

    fs.writeFileSync(result.filePath, JSON.stringify(sessions, null, 2));
    return { success: true };
}

function looksLikeSession(value: unknown): value is Partial<ChatSession> {
    return !!value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages);
}

export async function importSessions(win: BrowserWindow | null): Promise<{ imported: number }> {
    const options = { properties: ["openFile" as const], filters: [{ name: "JSON", extensions: ["json"] }] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { imported: 0 };

    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(result.filePaths[0], "utf-8"));
    } catch {
        return { imported: 0 };
    }

    const candidates: unknown[] = Array.isArray(raw) ? raw : [raw];
    let imported = 0;

    for (const candidate of candidates) {
        if (!looksLikeSession(candidate)) continue;
        const now = new Date().toISOString();
        sessionsStore.addSession({
            id: randomUUID(),
            title: typeof candidate.title === "string" ? candidate.title : "Imported chat",
            model: typeof candidate.model === "string" ? candidate.model : null,
            messages: candidate.messages!,
            params: candidate.params ?? null,
            createdAt: now,
            updatedAt: now,
        });
        imported++;
    }

    return { imported };
}

// Presets are shared between machines/teammates as a plain JSON file rather
// than through any live sync — this app has no server component, so "share
// with the team" means "send them this file".
export async function exportPromptPresets(win: BrowserWindow | null, presets: PromptPreset[]): Promise<{ success: boolean }> {
    const date = new Date().toISOString().slice(0, 10);
    const options = {
        defaultPath: `modelforge-prompts-${date}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { success: false };

    fs.writeFileSync(result.filePath, JSON.stringify(presets, null, 2));
    return { success: true };
}

function looksLikePreset(value: unknown): value is Partial<PromptPreset> {
    return !!value && typeof value === "object" && typeof (value as { prompt?: unknown }).prompt === "string";
}

export async function importPromptPresets(win: BrowserWindow | null): Promise<PromptPreset[]> {
    const options = { properties: ["openFile" as const], filters: [{ name: "JSON", extensions: ["json"] }] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return [];

    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(result.filePaths[0], "utf-8"));
    } catch {
        return [];
    }

    const candidates: unknown[] = Array.isArray(raw) ? raw : [raw];
    const now = new Date().toISOString();
    const imported: PromptPreset[] = [];
    for (const candidate of candidates) {
        if (!looksLikePreset(candidate)) continue;
        imported.push({
            id: randomUUID(),
            name: typeof candidate.name === "string" && candidate.name ? candidate.name : "Imported prompt",
            prompt: candidate.prompt!,
            versions: [],
            createdAt: now,
            updatedAt: now,
        });
    }
    return imported;
}

export function getUserDataPath(): string {
    return app.getPath("userData");
}

export function openUserDataFolder(): void {
    shell.openPath(app.getPath("userData"));
}
