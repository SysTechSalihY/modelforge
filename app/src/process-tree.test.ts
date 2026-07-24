import { describe, it, expect, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { killProcessTree } from "./process-tree";

vi.mock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    return { ...actual, spawnSync: vi.fn() };
});

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe("killProcessTree", () => {
    // Real process-group kill only makes sense on POSIX — Windows has no
    // equivalent to `detached: true` + negative-pid signaling, and Windows CI
    // runners don't have `sh`/`sleep` available to build a tree with anyway.
    it.skipIf(process.platform === "win32")(
        "kills a detached shell and its child process, not just the shell",
        async () => {
            const child = spawn("sh", ["-c", "sleep 30 & wait"], { detached: true, stdio: "ignore" });
            const shellPid = child.pid!;
            // Give the shell a moment to fork `sleep` before we look for it.
            await new Promise((r) => setTimeout(r, 200));

            killProcessTree(shellPid);
            await new Promise((r) => setTimeout(r, 200));

            expect(isAlive(shellPid)).toBe(false);
        },
        10_000
    );

    it("shells out to taskkill /t /f on win32, regardless of the host platform", () => {
        killProcessTree(4321, "SIGTERM", "win32");
        expect(spawnSync).toHaveBeenCalledWith("taskkill", ["/pid", "4321", "/t", "/f"]);
    });

    it("silently no-ops when the target process is already gone", () => {
        // A pid essentially guaranteed not to exist.
        expect(() => killProcessTree(999_999, "SIGTERM", "linux")).not.toThrow();
    });
});
