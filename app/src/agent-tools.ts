import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "./providers/types";
import { getAccountToken } from "./accounts";

const execAsync = promisify(exec);

export const AGENT_TOOLS: ToolDefinition[] = [
    {
        name: "read_file",
        description: "Read the contents of a text file within the workspace.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path, relative to the workspace root." },
                start_line: { type: "number", description: "Optional 1-based first line to read." },
                end_line: { type: "number", description: "Optional 1-based last line to read (inclusive)." },
            },
            required: ["path"],
        },
    },
    {
        name: "write_file",
        description: "Create a file or overwrite it with the given content. Creates parent directories as needed.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path, relative to the workspace root." },
                content: { type: "string", description: "The full content to write to the file." },
            },
            required: ["path", "content"],
        },
    },
    {
        name: "replace_in_file",
        description: "Replace one exact block of text in a file. Safer and more token-efficient than rewriting the whole file; fails if the text is missing or ambiguous.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path, relative to the workspace root." },
                old_text: { type: "string", description: "Exact text currently in the file." },
                new_text: { type: "string", description: "Replacement text." },
                replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring exactly one." },
            },
            required: ["path", "old_text", "new_text"],
        },
    },
    {
        name: "find_files",
        description: "Find files by a glob-style pattern such as **/*.ts or src/*.tsx. Skips generated and dependency directories.",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Glob-style path pattern relative to the search directory." },
                path: { type: "string", description: 'Search directory relative to the workspace root. Defaults to ".".' },
            },
            required: ["pattern"],
        },
    },
    {
        name: "file_info",
        description: "Get a file or directory's type, size, and modification time.",
        parameters: {
            type: "object",
            properties: { path: { type: "string", description: "Path relative to the workspace root." } },
            required: ["path"],
        },
    },
    {
        name: "make_directory",
        description: "Create a directory and any missing parent directories within the workspace.",
        parameters: {
            type: "object",
            properties: { path: { type: "string", description: "Directory path relative to the workspace root." } },
            required: ["path"],
        },
    },
    {
        name: "move_path",
        description: "Move or rename a file or directory within the workspace. Refuses to overwrite an existing destination.",
        parameters: {
            type: "object",
            properties: {
                source: { type: "string", description: "Existing source path relative to the workspace root." },
                destination: { type: "string", description: "New destination path relative to the workspace root." },
            },
            required: ["source", "destination"],
        },
    },
    {
        name: "delete_path",
        description: "Delete a file or an empty directory within the workspace. Set recursive=true only when explicitly asked to delete a non-empty directory.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Path relative to the workspace root." },
                recursive: { type: "boolean", description: "Allow deleting a non-empty directory tree." },
            },
            required: ["path"],
        },
    },
    {
        name: "list_dir",
        description: "List files and subdirectories at a path within the workspace.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: 'Directory path, relative to the workspace root. Use "." for the root.' },
            },
            required: [],
        },
    },
    {
        name: "search_files",
        description: "Search for a text string across files in the workspace and return matching lines.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The text to search for (plain substring match, case-sensitive)." },
                path: { type: "string", description: 'Subdirectory to scope the search to, relative to the workspace root. Defaults to "."' },
            },
            required: ["query"],
        },
    },
    {
        name: "run_command",
        description:
            "Execute a shell command in the workspace (or a subdirectory of it) and return its stdout/stderr/exit code. Use for builds, tests, git, npm, etc. Commands that could affect the system outside the workspace (deleting elsewhere, shutting down the machine, privilege escalation, etc.) are rejected.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "The shell command to run." },
                cwd: { type: "string", description: 'Working directory for the command, relative to the workspace root. Defaults to "."' },
            },
            required: ["command"],
        },
    },
    {
        name: "run_code",
        description:
            "Run a Python or JavaScript code snippet in the workspace and return its stdout/stderr/exit code. A convenience over run_command for multi-line code (no shell-quoting to worry about) — it is not a sandbox: the code runs with the same permissions as run_command and is subject to the same safety checks.",
        parameters: {
            type: "object",
            properties: {
                language: { type: "string", enum: ["python", "javascript"], description: "Which interpreter to run the code with." },
                code: { type: "string", description: "The full source code to execute." },
                cwd: { type: "string", description: 'Working directory, relative to the workspace root. Defaults to "."' },
            },
            required: ["language", "code"],
        },
    },
    {
        name: "git_status",
        description: "Show the working tree status (git status) for the workspace.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "git_diff",
        description: "Show unstaged (or, if staged=true, staged) changes in the workspace as a unified diff.",
        parameters: {
            type: "object",
            properties: {
                staged: { type: "boolean", description: "Show staged changes (git diff --staged) instead of unstaged." },
                path: { type: "string", description: "Limit the diff to this file or directory, relative to the workspace root." },
            },
            required: [],
        },
    },
    {
        name: "git_log",
        description: "Show recent commit history for the workspace.",
        parameters: {
            type: "object",
            properties: {
                count: { type: "number", description: "How many commits to show. Defaults to 10." },
            },
            required: [],
        },
    },
    {
        name: "git_commit",
        description: "Stage all changes and create a commit in the workspace. Requires explicit approval, like write_file.",
        parameters: {
            type: "object",
            properties: {
                message: { type: "string", description: "The commit message." },
            },
            required: ["message"],
        },
    },
    {
        name: "web_search",
        description: "Search the web for a query and return the top results (title, URL, snippet). Use this to find information not available locally.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The search query." },
            },
            required: ["query"],
        },
    },
    {
        name: "github_list_repositories",
        description: "List repositories accessible to the linked GitHub account. Use this to choose a repository for analysis.",
        parameters: {
            type: "object",
            properties: {
                visibility: { type: "string", enum: ["all", "public", "private"], description: "Repository visibility filter. Defaults to all." },
                limit: { type: "number", description: "Maximum repositories to return, from 1 to 100. Defaults to 30." },
            },
            required: [],
        },
    },
    {
        name: "github_repository_tree",
        description: "List the complete file tree of a GitHub repository so its structure can be analyzed before reading selected files.",
        parameters: {
            type: "object",
            properties: {
                repository: { type: "string", description: "Repository in owner/name form." },
                ref: { type: "string", description: "Branch, tag, or commit. Defaults to the repository's default branch." },
            },
            required: ["repository"],
        },
    },
    {
        name: "github_read_file",
        description: "Read a UTF-8 text file from a repository accessible to the linked GitHub account.",
        parameters: {
            type: "object",
            properties: {
                repository: { type: "string", description: "Repository in owner/name form." },
                path: { type: "string", description: "File path inside the repository." },
                ref: { type: "string", description: "Branch, tag, or commit. Defaults to the default branch." },
            },
            required: ["repository", "path"],
        },
    },
    {
        name: "fetch_url",
        description: "Fetch a web page by URL and return its readable text content (HTML tags stripped). Use after web_search to read a specific result, or for any URL the user provides.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The full URL to fetch, including https://." },
            },
            required: ["url"],
        },
    },
    {
        name: "read_notes",
        description: "Read the agent's persistent notes for this workspace — a scratchpad for tracking long-running context, decisions, or progress across turns and sessions. Empty if nothing has been written yet.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "write_notes",
        description: "Overwrite the agent's persistent notes for this workspace with the given content. Use this to record progress, decisions, or context worth remembering later in a long task — write the full notes each time, not just an addition.",
        parameters: {
            type: "object",
            properties: {
                content: { type: "string", description: "The full notes content to save, replacing whatever was there before." },
            },
            required: ["content"],
        },
    },
    {
        name: "set_plan",
        description:
            "Declare or update a step-by-step plan for the current task, shown to the user as a checklist. Call this once at the start of any multi-step task, then call it again (with the full updated list) whenever a step is completed or the plan changes. Always pass the complete list, not just changes.",
        parameters: {
            type: "object",
            properties: {
                steps: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            text: { type: "string", description: "Short description of this step." },
                            done: { type: "boolean", description: "Whether this step is already complete." },
                        },
                        required: ["text", "done"],
                    },
                    description: "The full, ordered list of steps.",
                },
            },
            required: ["steps"],
        },
    },
    {
        name: "request_checkpoint",
        description:
            "Pause and ask the user to confirm before continuing — use this after finishing a meaningful chunk of work or before starting something risky/irreversible, so the user can review progress rather than only finding out at the very end.",
        parameters: {
            type: "object",
            properties: {
                summary: { type: "string", description: "What's been done so far, in a sentence or two." },
                question: { type: "string", description: "What you'd like to confirm before continuing (optional)." },
            },
            required: ["summary"],
        },
    },
];

const MAX_READ_CHARS = 100_000;
const MAX_SEARCH_RESULTS = 50;
const MAX_LIST_ENTRIES = 500;
const MAX_COMMAND_OUTPUT_CHARS = 50_000;
const COMMAND_TIMEOUT_MS = 60_000;
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "release", "__pycache__"]);

// Every tool call is confined to the chosen workspace directory — this
// resolves the (possibly relative, possibly attacker-crafted via a prompt
// injection in file content the model read) path and throws if it would
// escape that directory via ../ or an absolute path elsewhere on disk.
function resolveSafePath(workspaceRoot: string, relativePath: string): string {
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

export function readFile(workspaceRoot: string, relativePath: string, startLine?: number, endLine?: number): string {
    const target = resolveSafePath(workspaceRoot, relativePath);
    const stat = fs.statSync(target);
    if (stat.isDirectory()) throw new Error(`"${relativePath}" is a directory, not a file.`);
    const content = fs.readFileSync(target, "utf-8");
    if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(1, Math.floor(startLine ?? 1));
        const end = Math.max(start, Math.floor(endLine ?? start + 499));
        if (end - start > 2_000) throw new Error("A ranged read is limited to 2,001 lines at a time.");
        const lines = content.split(/\r?\n/);
        if (start > lines.length) throw new Error(`start_line ${start} is beyond the file's ${lines.length} lines.`);
        return lines.slice(start - 1, Math.min(end, lines.length)).join("\n");
    }
    return content.length > MAX_READ_CHARS
        ? `${content.slice(0, MAX_READ_CHARS)}\n\n[truncated — file is ${content.length} characters]`
        : content;
}

interface WriteBackup {
    relativePath: string;
    // null means the file didn't exist before this write — rollback deletes it.
    previousContent: string | null;
}

// Undo history is kept in memory only, per workspace, capped so a long agent
// session doesn't grow this unboundedly. It's intentionally session-scoped
// (not written to disk) — Rollback is a quick "oops" safety net for the
// current run, not a durable version history.
const MAX_BACKUPS_PER_WORKSPACE = 20;
const writeBackups = new Map<string, WriteBackup[]>();

function normalizeWorkspaceKey(workspaceRoot: string): string {
    return path.resolve(workspaceRoot);
}

function recordBackup(workspaceRoot: string, relativePath: string, previousContent: string | null): void {
    const key = normalizeWorkspaceKey(workspaceRoot);
    const stack = writeBackups.get(key) ?? [];
    stack.push({ relativePath, previousContent });
    while (stack.length > MAX_BACKUPS_PER_WORKSPACE) stack.shift();
    writeBackups.set(key, stack);
}

export function writeFile(workspaceRoot: string, relativePath: string, content: string): { bytesWritten: number } {
    const target = resolveSafePath(workspaceRoot, relativePath);
    let previousContent: string | null = null;
    try {
        previousContent = fs.readFileSync(target, "utf-8");
    } catch {
        previousContent = null; // file doesn't exist yet — this write creates it
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    recordBackup(workspaceRoot, relativePath, previousContent);
    return { bytesWritten: Buffer.byteLength(content) };
}

export function replaceInFile(
    workspaceRoot: string,
    relativePath: string,
    oldText: string,
    newText: string,
    replaceAll = false
): { replacements: number; bytesWritten: number } {
    if (!oldText) throw new Error("old_text must not be empty.");
    const target = resolveSafePath(workspaceRoot, relativePath);
    const content = fs.readFileSync(target, "utf-8");
    const occurrences = content.split(oldText).length - 1;
    if (occurrences === 0) throw new Error("old_text was not found in the file.");
    if (!replaceAll && occurrences !== 1) {
        throw new Error(`old_text matched ${occurrences} times; provide a unique block or set replace_all=true.`);
    }
    const updated = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText);
    recordBackup(workspaceRoot, relativePath, content);
    fs.writeFileSync(target, updated);
    return { replacements: replaceAll ? occurrences : 1, bytesWritten: Buffer.byteLength(updated) };
}

export interface RollbackResult {
    path: string;
    restoredContent: boolean; // true = previous content restored, false = newly-created file was deleted
}

export function rollbackLastWrite(workspaceRoot: string): RollbackResult | null {
    const key = normalizeWorkspaceKey(workspaceRoot);
    const stack = writeBackups.get(key);
    const backup = stack?.pop();
    if (!backup) return null;
    const target = resolveSafePath(workspaceRoot, backup.relativePath);
    if (backup.previousContent === null) {
        fs.rmSync(target, { force: true });
        return { path: backup.relativePath, restoredContent: false };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, backup.previousContent);
    return { path: backup.relativePath, restoredContent: true };
}

export function listDir(workspaceRoot: string, relativePath: string): string[] {
    const target = resolveSafePath(workspaceRoot, relativePath || ".");
    const entries = fs.readdirSync(target, { withFileTypes: true });
    return entries.slice(0, MAX_LIST_ENTRIES).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
}

function globToRegExp(pattern: string): RegExp {
    const normalized = pattern.replace(/\\/g, "/");
    let source = "^";
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        if (char === "*" && normalized[i + 1] === "*") {
            i++;
            if (normalized[i + 1] === "/") {
                i++;
                source += "(?:.*/)?";
            } else {
                source += ".*";
            }
        } else if (char === "*") source += "[^/]*";
        else if (char === "?") source += "[^/]";
        else source += char.replace(/[\\^$.[\]|()+{}]/g, "\\$&");
    }
    return new RegExp(`${source}$`, "i");
}

export function findFiles(workspaceRoot: string, pattern: string, relativePath = "."): string[] {
    if (!pattern.trim()) throw new Error("pattern must not be empty.");
    const startDir = resolveSafePath(workspaceRoot, relativePath);
    const matcher = globToRegExp(pattern);
    const results: string[] = [];
    function walk(dir: string): void {
        if (results.length >= MAX_LIST_ENTRIES) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                const relative = path.relative(startDir, full).split(path.sep).join("/");
                if (matcher.test(relative)) results.push(path.relative(workspaceRoot, full).split(path.sep).join("/"));
            }
        }
    }
    walk(startDir);
    return results.sort();
}

export function fileInfo(workspaceRoot: string, relativePath: string): {
    path: string; type: "file" | "directory" | "other"; sizeBytes: number; modifiedAt: string;
} {
    const target = resolveSafePath(workspaceRoot, relativePath);
    const stat = fs.statSync(target);
    return {
        path: relativePath,
        type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
    };
}

export function makeDirectory(workspaceRoot: string, relativePath: string): { created: boolean } {
    const target = resolveSafePath(workspaceRoot, relativePath);
    const existed = fs.existsSync(target);
    fs.mkdirSync(target, { recursive: true });
    return { created: !existed };
}

export function movePath(workspaceRoot: string, sourcePath: string, destinationPath: string): { moved: boolean } {
    const root = path.resolve(workspaceRoot);
    const source = resolveSafePath(workspaceRoot, sourcePath);
    const destination = resolveSafePath(workspaceRoot, destinationPath);
    if (source === root || destination === root) throw new Error("The workspace root cannot be moved or replaced.");
    if (!fs.existsSync(source)) throw new Error(`Source path "${sourcePath}" does not exist.`);
    if (fs.existsSync(destination)) throw new Error(`Destination path "${destinationPath}" already exists.`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
    return { moved: true };
}

export function deletePath(workspaceRoot: string, relativePath: string, recursive = false): { deleted: boolean } {
    const root = path.resolve(workspaceRoot);
    const target = resolveSafePath(workspaceRoot, relativePath);
    if (target === root) throw new Error("The workspace root cannot be deleted.");
    if (!fs.existsSync(target)) return { deleted: false };
    const stat = fs.statSync(target);
    if (stat.isDirectory()) fs.rmSync(target, { recursive, force: false });
    else fs.unlinkSync(target);
    return { deleted: true };
}

export interface SearchMatch {
    file: string;
    line: number;
    text: string;
}

export function searchFiles(workspaceRoot: string, query: string, relativePath = "."): SearchMatch[] {
    const startDir = resolveSafePath(workspaceRoot, relativePath);
    const results: SearchMatch[] = [];

    function walk(dir: string): void {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (results.length >= MAX_SEARCH_RESULTS) return;
            if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!entry.isFile()) continue;
            let text: string;
            try {
                text = fs.readFileSync(full, "utf-8");
            } catch {
                continue; // binary or unreadable — skip
            }
            const lines = text.split("\n");
            for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
                if (lines[i].includes(query)) {
                    results.push({
                        file: path.relative(workspaceRoot, full).split(path.sep).join("/"),
                        line: i + 1,
                        text: lines[i].trim().slice(0, 200),
                    });
                }
            }
        }
    }

    walk(startDir);
    return results;
}

// Defense in depth for `run_command`: the workspace-root sandboxing above
// only constrains our own read_file/write_file/list_dir/search_files
// implementations, which build and validate paths themselves. A shell
// command is opaque text — it can reference any path on disk (`rm -rf ~`,
// `del C:\Windows`) regardless of the `cwd` we launch it in, so `cwd`
// alone is not a real sandbox against a destructive command. This can't
// catch everything a shell is capable of, but it blocks the common,
// catastrophic patterns outright — even if the user already clicked
// "Allow" without noticing what the command actually does.
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
    /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+(\/|~|\*|\$HOME|\.\.)/i, // rm -rf /, ~, *, ..
    /\bdel\s+\/[sf]\s.*[a-z]:\\/i, // del /s /q C:\...
    /\brd\s+\/s\s+\/q\s+[a-z]:\\/i, // rd /s /q C:\...
    /\bformat\s+[a-z]:/i,
    /\bdiskpart\b/i,
    /\bmkfs(\.\w+)?\b/i,
    /\bdd\s+if=.*\bof=\/dev\//i,
    /\b(shutdown|reboot)\b/i,
    /\bRestart-Computer\b/i,
    /\bStop-Computer\b/i,
    /:\(\)\s*\{\s*:\|\s*:&\s*\}\s*;\s*:/, // classic fork bomb
    /\breg(\.exe)?\s+delete\b/i,
    /\bregedit\b/i,
    /\bsudo\b/i,
    /\brunas\b/i,
    /\bchmod\s+-R\s+777\s+\//i,
    /\bcurl\b[^|]*\|\s*(sh|bash|zsh)\b/i, // curl ... | sh
    /\b(iwr|Invoke-WebRequest)\b[^|]*\|\s*(iex|Invoke-Expression)\b/i,
];

export function findDangerousCommandReason(command: string): string | null {
    const match = DANGEROUS_COMMAND_PATTERNS.find((pattern) => pattern.test(command));
    return match
        ? "This command was blocked because it matches a pattern that could affect your whole system rather than just the workspace folder (e.g. deleting outside it, a system shutdown, or a privilege-escalation attempt)."
        : null;
}

function truncateOutput(text: string): string {
    return text.length > MAX_COMMAND_OUTPUT_CHARS
        ? `${text.slice(0, MAX_COMMAND_OUTPUT_CHARS)}\n[truncated]`
        : text;
}

function formatCommandResult(stdout: string, stderr: string, exitCode: number | null): string {
    const parts = [`Exit code: ${exitCode}`];
    if (stdout) parts.push(`--- stdout ---\n${truncateOutput(stdout)}`);
    if (stderr) parts.push(`--- stderr ---\n${truncateOutput(stderr)}`);
    return parts.join("\n\n");
}

export async function runCommand(workspaceRoot: string, command: string, relativeCwd = "."): Promise<string> {
    const dangerReason = findDangerousCommandReason(command);
    if (dangerReason) throw new Error(dangerReason);

    const cwd = resolveSafePath(workspaceRoot, relativeCwd);
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
        });
        return formatCommandResult(stdout, stderr, 0);
    } catch (err) {
        const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message: string };
        if (e.killed) {
            return `Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s.\n\n${formatCommandResult(e.stdout ?? "", e.stderr ?? "", e.code ?? null)}`;
        }
        return formatCommandResult(e.stdout ?? "", e.stderr ?? e.message, e.code ?? null);
    }
}

// run_code is a thin convenience wrapper over run_command for multi-line
// snippets (avoids shell-quoting hell for real code) — it carries the exact
// same risk and is checked against the exact same blocklist as run_command,
// applied to the source text too since dangerous *content* (not just the
// invocation) could otherwise slip past a check that only looks at the
// command line.
export async function runCode(
    workspaceRoot: string,
    language: "python" | "javascript",
    code: string,
    relativeCwd = "."
): Promise<string> {
    const dangerReason = findDangerousCommandReason(code);
    if (dangerReason) throw new Error(dangerReason);

    const ext = language === "python" ? "py" : "js";
    const tmpFile = path.join(os.tmpdir(), `modelforge-code-${randomUUID()}.${ext}`);
    fs.writeFileSync(tmpFile, code);
    try {
        const interpreter = language === "python" ? "python3" : "node";
        return await runCommand(workspaceRoot, `${interpreter} "${tmpFile}"`, relativeCwd);
    } finally {
        fs.rmSync(tmpFile, { force: true });
    }
}

function gitCommand(workspaceRoot: string, args: string): Promise<string> {
    return runCommand(workspaceRoot, `git ${args}`, ".");
}

export function gitStatus(workspaceRoot: string): Promise<string> {
    return gitCommand(workspaceRoot, "status");
}

export function gitDiff(workspaceRoot: string, staged = false, relativePath?: string): Promise<string> {
    const target = relativePath ? ` -- "${relativePath}"` : "";
    return gitCommand(workspaceRoot, `diff${staged ? " --staged" : ""}${target}`);
}

export function gitLog(workspaceRoot: string, count = 10): Promise<string> {
    return gitCommand(workspaceRoot, `log -n ${Math.max(1, Math.min(count, 100))} --oneline`);
}

export async function gitCommit(workspaceRoot: string, message: string): Promise<string> {
    await gitCommand(workspaceRoot, "add -A");
    return gitCommand(workspaceRoot, `commit -m ${JSON.stringify(message)}`);
}

const WEB_FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_CHARS = 30_000;
const MAX_SEARCH_RESULTS_WEB = 5;

// Crude HTML-to-text: drop non-content tags outright, then strip remaining
// markup and collapse whitespace. Not a real HTML parser — good enough for
// giving a model readable page text without pulling in a DOM library in the
// main process.
function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n")
        .trim();
}

export async function fetchUrl(url: string): Promise<string> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`"${url}" is not a valid URL.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http:// and https:// URLs can be fetched.");
    }

    const res = await fetch(parsed, {
        signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Modelforge/1.0)" },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = contentType.includes("html") ? htmlToText(raw) : raw;
    return text.length > MAX_FETCH_CHARS
        ? `${text.slice(0, MAX_FETCH_CHARS)}\n\n[truncated — page is ${text.length} characters]`
        : text;
}

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}

// Uses DuckDuckGo's keyless HTML endpoint (no API key/signup needed, unlike
// most search APIs) and regex-scrapes the result markup — brittle if DDG
// changes its HTML, but keeps this tool usable out of the box with zero
// configuration, consistent with the rest of Agent mode's tools.
export async function webSearch(query: string): Promise<WebSearchResult[]> {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Modelforge/1.0)" },
    });
    if (!res.ok) throw new Error(`Web search failed: HTTP ${res.status}`);
    const html = await res.text();

    const results: WebSearchResult[] = [];
    const linkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const links = [...html.matchAll(linkPattern)];
    const snippets = [...html.matchAll(snippetPattern)];

    for (let i = 0; i < links.length && results.length < MAX_SEARCH_RESULTS_WEB; i++) {
        const href = links[i][1];
        // DuckDuckGo's HTML endpoint wraps result URLs in a redirect
        // (/l/?uddg=<encoded target>) rather than linking straight to them.
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
        const url = uddgMatch ? decodeURIComponent(uddgMatch[1]) : href;
        results.push({
            title: htmlToText(links[i][2]),
            url,
            snippet: htmlToText(snippets[i]?.[1] ?? ""),
        });
    }
    return results;
}

function notesPath(): string {
    return ".agent-notes.md";
}

export function readNotes(workspaceRoot: string): string {
    try {
        return readFile(workspaceRoot, notesPath());
    } catch {
        return "";
    }
}

export function writeNotes(workspaceRoot: string, content: string): { bytesWritten: number } {
    return writeFile(workspaceRoot, notesPath(), content);
}

export interface ProjectScripts {
    test?: string;
    lint?: string;
    format?: string;
}

// Backs the Test/Lint/Format quick-action buttons — only npm-style
// package.json scripts are recognized, which covers the JS/TS projects this
// app's Agent mode is primarily used against.
export function detectProjectScripts(workspaceRoot: string): ProjectScripts {
    const pkgPath = resolveSafePath(workspaceRoot, "package.json");
    let scripts: Record<string, string> = {};
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
        scripts = pkg.scripts ?? {};
    } catch {
        return {};
    }
    return {
        test: scripts.test ? "npm test" : undefined,
        lint: scripts.lint ? "npm run lint" : undefined,
        format: scripts.format ? "npm run format" : undefined,
    };
}

function requireGitHubToken(): string {
    const token = getAccountToken("github");
    if (!token) throw new Error("Link a GitHub account in Settings → Integrations before using GitHub repository tools.");
    return token;
}

function normalizeGitHubRepository(repository: string): string {
    const value = repository.trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
        throw new Error('repository must use the "owner/name" format.');
    }
    return value;
}

async function githubApi<T>(endpoint: string): Promise<T> {
    const response = await fetch(`https://api.github.com${endpoint}`, {
        headers: {
            Authorization: `Bearer ${requireGitHubToken()}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "Modelforge",
        },
    });
    if (response.status === 401) throw new Error("The linked GitHub token is invalid or expired. Reconnect it in Settings.");
    if (response.status === 404) throw new Error("The repository, ref, or file was not found, or the linked account cannot access it.");
    if (!response.ok) throw new Error(`GitHub API error (HTTP ${response.status}).`);
    return await response.json() as T;
}

export async function githubListRepositories(visibility = "all", limit = 30): Promise<unknown[]> {
    const safeVisibility = ["all", "public", "private"].includes(visibility) ? visibility : "all";
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    const repos = await githubApi<Array<Record<string, unknown>>>(
        `/user/repos?visibility=${safeVisibility}&affiliation=owner,collaborator,organization_member&sort=updated&per_page=${safeLimit}`
    );
    return repos.map((repo) => ({
        fullName: repo.full_name,
        private: repo.private,
        description: repo.description,
        defaultBranch: repo.default_branch,
        language: repo.language,
        updatedAt: repo.updated_at,
        url: repo.html_url,
    }));
}

export async function githubRepositoryTree(repository: string, ref?: string): Promise<{ ref: string; truncated: boolean; files: unknown[] }> {
    const repo = normalizeGitHubRepository(repository);
    let resolvedRef = ref?.trim();
    if (!resolvedRef) {
        const metadata = await githubApi<{ default_branch: string }>(`/repos/${repo}`);
        resolvedRef = metadata.default_branch;
    }
    const tree = await githubApi<{ truncated: boolean; tree: Array<{ path: string; type: string; size?: number; sha: string }> }>(
        `/repos/${repo}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`
    );
    return {
        ref: resolvedRef,
        truncated: tree.truncated,
        files: tree.tree.filter((item) => item.type === "blob").slice(0, 2_000).map((item) => ({ path: item.path, sizeBytes: item.size ?? null, sha: item.sha })),
    };
}

export async function githubReadFile(repository: string, filePath: string, ref?: string): Promise<string> {
    const repo = normalizeGitHubRepository(repository);
    const cleanPath = filePath.replace(/^\/+/, "");
    if (!cleanPath || cleanPath.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
        throw new Error("Invalid repository file path.");
    }
    const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
    const query = ref?.trim() ? `?ref=${encodeURIComponent(ref.trim())}` : "";
    const file = await githubApi<{ type: string; size: number; encoding?: string; content?: string }>(`/repos/${repo}/contents/${encodedPath}${query}`);
    if (file.type !== "file" || file.encoding !== "base64" || !file.content) throw new Error("The requested GitHub path is not a readable file.");
    if (file.size > MAX_READ_CHARS * 4) throw new Error(`The GitHub file is too large to analyze directly (${file.size} bytes).`);
    const content = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf-8");
    return content.length > MAX_READ_CHARS ? `${content.slice(0, MAX_READ_CHARS)}\n\n[truncated]` : content;
}

export async function executeTool(workspaceRoot: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case "read_file":
            return readFile(
                workspaceRoot,
                String(args.path ?? ""),
                typeof args.start_line === "number" ? args.start_line : undefined,
                typeof args.end_line === "number" ? args.end_line : undefined
            );
        case "write_file":
            return writeFile(workspaceRoot, String(args.path ?? ""), String(args.content ?? ""));
        case "replace_in_file":
            return replaceInFile(
                workspaceRoot,
                String(args.path ?? ""),
                String(args.old_text ?? ""),
                String(args.new_text ?? ""),
                args.replace_all === true
            );
        case "find_files":
            return findFiles(workspaceRoot, String(args.pattern ?? ""), args.path ? String(args.path) : ".");
        case "file_info":
            return fileInfo(workspaceRoot, String(args.path ?? ""));
        case "make_directory":
            return makeDirectory(workspaceRoot, String(args.path ?? ""));
        case "move_path":
            return movePath(workspaceRoot, String(args.source ?? ""), String(args.destination ?? ""));
        case "delete_path":
            return deletePath(workspaceRoot, String(args.path ?? ""), args.recursive === true);
        case "list_dir":
            return listDir(workspaceRoot, String(args.path ?? "."));
        case "search_files":
            return searchFiles(workspaceRoot, String(args.query ?? ""), args.path ? String(args.path) : ".");
        case "run_command":
            return runCommand(workspaceRoot, String(args.command ?? ""), args.cwd ? String(args.cwd) : ".");
        case "run_code": {
            const language = args.language === "python" ? "python" : "javascript";
            return runCode(workspaceRoot, language, String(args.code ?? ""), args.cwd ? String(args.cwd) : ".");
        }
        case "git_status":
            return gitStatus(workspaceRoot);
        case "git_diff":
            return gitDiff(workspaceRoot, args.staged === true, args.path ? String(args.path) : undefined);
        case "git_log":
            return gitLog(workspaceRoot, typeof args.count === "number" ? args.count : 10);
        case "git_commit":
            return gitCommit(workspaceRoot, String(args.message ?? ""));
        case "web_search":
            return webSearch(String(args.query ?? ""));
        case "github_list_repositories":
            return githubListRepositories(String(args.visibility ?? "all"), typeof args.limit === "number" ? args.limit : 30);
        case "github_repository_tree":
            return githubRepositoryTree(String(args.repository ?? ""), args.ref ? String(args.ref) : undefined);
        case "github_read_file":
            return githubReadFile(String(args.repository ?? ""), String(args.path ?? ""), args.ref ? String(args.ref) : undefined);
        case "fetch_url":
            return fetchUrl(String(args.url ?? ""));
        case "read_notes":
            return readNotes(workspaceRoot);
        case "write_notes":
            return writeNotes(workspaceRoot, String(args.content ?? ""));
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
