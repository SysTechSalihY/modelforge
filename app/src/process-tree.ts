import { spawnSync } from "node:child_process";

// `spawn(command, {shell: true})` means the tracked pid is the *shell's*
// pid — calling .kill() on it leaves any grandchildren (e.g. `npm run dev`
// spawning a real `node` process) running behind. On POSIX this kills the
// whole process group instead, which requires the child to have been spawned
// with `detached: true` so it becomes its own group leader (see
// startBackgroundCommand in agent-tools.ts). On Windows, `taskkill`'s `/t`
// flag walks the process tree itself, so no special spawn option is needed
// there.
export function killProcessTree(
    pid: number,
    signal: NodeJS.Signals = "SIGTERM",
    platform: NodeJS.Platform = process.platform
): void {
    if (platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"]);
        return;
    }
    try {
        process.kill(-pid, signal);
    } catch {
        // Not a group leader (wasn't spawned detached) or already gone —
        // fall back to killing just the tracked pid.
        try {
            process.kill(pid, signal);
        } catch {
            // Already dead.
        }
    }
}
