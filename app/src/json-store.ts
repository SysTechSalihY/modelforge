import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "./logger";

// Shared persistence helpers for the small JSON "database" files this app
// keeps in userData (sessions/projects/settings/secrets).
//
// Two failure modes matter here:
//  - A crash or power loss mid-write leaving a half-written file. writeJson
//    guards against this by writing to a temp file and renaming over the
//    real one — a rename is atomic on both Windows and POSIX filesystems,
//    so readers never see a partial write.
//  - A file that's already corrupted (e.g. from before this fix, or from
//    a bug, or from manual editing). readJson used to just swallow the
//    parse error and silently return the fallback — which means the very
//    next write would overwrite the corrupted file with a blank slate,
//    permanently destroying whatever data was still recoverable. Instead
//    we back the bad file up next to itself so the user (or support) can
//    recover it, and log what happened.

export function readJson<T>(filePath: string, fallback: T): T {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code !== "ENOENT") {
            logger.error(`Failed to read ${filePath}: ${nodeErr.message}`);
        }
        return fallback;
    }

    try {
        return JSON.parse(raw) as T;
    } catch (err) {
        logger.error(`Corrupted JSON in ${filePath}, backing up and resetting: ${(err as Error).message}`);
        try {
            fs.copyFileSync(filePath, `${filePath}.corrupted-${Date.now()}`);
        } catch (backupErr) {
            logger.error(`Failed to back up corrupted file ${filePath}: ${(backupErr as Error).message}`);
        }
        return fallback;
    }
}

export function writeJson(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
}
