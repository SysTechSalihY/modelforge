// Prompt Library templates can embed variables as {{name}} — this module
// finds them and fills them in. Kept intentionally simple (no conditionals,
// no loops): the goal is reusable prompts with a few blanks to fill in, not
// a templating language.
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractVariables(template: string): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const match of template.matchAll(VARIABLE_PATTERN)) {
        const name = match[1];
        if (!seen.has(name)) {
            seen.add(name);
            ordered.push(name);
        }
    }
    return ordered;
}

export function fillTemplate(template: string, values: Record<string, string>): string {
    return template.replace(VARIABLE_PATTERN, (_match, name: string) => values[name] ?? "");
}
