import * as fs from "node:fs";
import * as path from "node:path";

// Every tool call (and, since phase 2, every terminal) is confined to the
// chosen workspace directory — this resolves the (possibly relative,
// possibly attacker-crafted via a prompt injection in file content the
// model read) path and throws if it would escape that directory via ../ or
// an absolute path elsewhere on disk. Lives in its own module (rather than
// inside agent-tools.ts, where it originated) so terminal-manager.ts can
// import it without creating a circular dependency between the two.
export function resolveSafePath(workspaceRoot: string, relativePath: string): string {
    const root = path.resolve(workspaceRoot);
    const resolved = path.resolve(root, relativePath || ".");
    const isWithin = (parent: string, child: string): boolean => {
        const relative = path.relative(parent, child);
        return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    };
    if (!isWithin(root, resolved)) {
        throw new Error(`Path "${relativePath}" is outside the workspace directory.`);
    }

    // Lexical checks alone are bypassable through a symlink inside the
    // workspace that points elsewhere. Resolve the target, or its nearest
    // existing parent for new files, and verify the real path too.
    const realRoot = fs.realpathSync(root);
    let existing = resolved;
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) break;
        existing = parent;
    }
    const realExisting = fs.realpathSync(existing);
    if (!isWithin(realRoot, realExisting)) {
        throw new Error(`Path "${relativePath}" resolves outside the workspace directory through a symbolic link.`);
    }
    return resolved;
}
