import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

const MAX_LOG_BYTES = 2 * 1024 * 1024; // rotate at 2MB
const MAX_TAIL_CHARS = 20_000; // how much to include in a diagnostics snapshot

function logDir(): string {
    return path.join(app.getPath("userData"), "logs");
}

function logPath(): string {
    return path.join(logDir(), "app.log");
}

function rotateIfNeeded(): void {
    try {
        const stat = fs.statSync(logPath());
        if (stat.size > MAX_LOG_BYTES) {
            fs.renameSync(logPath(), `${logPath()}.1`);
        }
    } catch {
        // no existing log file yet — nothing to rotate
    }
}

function write(level: "info" | "warn" | "error", message: string): void {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`;

    // Always mirror to the console too (visible when running from a terminal
    // or in DevTools via the main-process output).
    if (level === "error") console.error(message);
    else if (level === "warn") console.warn(message);
    else console.log(message);

    try {
        fs.mkdirSync(logDir(), { recursive: true });
        rotateIfNeeded();
        fs.appendFileSync(logPath(), line);
    } catch {
        // If logging itself fails (e.g. disk full), there's nowhere safe left
        // to report it — console output above is the fallback.
    }
}

export const logger = {
    info: (message: string) => write("info", message),
    warn: (message: string) => write("warn", message),
    error: (message: string) => write("error", message),
};

export function getLogPath(): string {
    return logPath();
}

export function getLogTail(maxChars = MAX_TAIL_CHARS): string {
    try {
        const content = fs.readFileSync(logPath(), "utf-8");
        return content.length > maxChars ? content.slice(-maxChars) : content;
    } catch {
        return "";
    }
}
