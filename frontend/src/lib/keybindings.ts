export type KeybindingAction = "commandPalette" | "newChat" | "openSettings" | "showShortcuts";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string> = {
    commandPalette: "mod+k",
    newChat: "mod+n",
    openSettings: "mod+,",
    showShortcuts: "mod+/",
};

export const KEYBINDING_ACTIONS: KeybindingAction[] = ["commandPalette", "newChat", "openSettings", "showShortcuts"];

// Canonical form: modifier tokens (mod, shift, alt) in that fixed order,
// lowercased, joined by "+", followed by the key itself. Two independently
// captured keydowns for "the same" shortcut always normalize to the same
// string, which is what makes them comparable/storable at all.
export function eventToBindingString(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string | null {
    if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return null;
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("mod");
    if (e.shiftKey) parts.push("shift");
    if (e.altKey) parts.push("alt");
    parts.push(e.key.toLowerCase());
    return parts.join("+");
}

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
    return eventToBindingString(e) === binding;
}

export function formatBindingForDisplay(binding: string): string {
    return binding
        .split("+")
        .map((part) => {
            if (part === "mod") return isMac ? "⌘" : "Ctrl";
            if (part === "shift") return "Shift";
            if (part === "alt") return isMac ? "⌥" : "Alt";
            if (part === "escape") return "Esc";
            return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(isMac ? "" : "+");
}

type Listener = (bindings: Record<KeybindingAction, string>) => void;
const listeners = new Set<Listener>();

// Settings.tsx saves keybindings while Layout's keydown handler (which
// actually matches them) lives outside that component tree and doesn't
// remount on navigation — a plain in-memory pub-sub is the simplest way to
// push a change across without standing up a whole settings context just
// for this one field.
export function notifyKeybindingsChanged(bindings: Record<KeybindingAction, string>): void {
    listeners.forEach((l) => l(bindings));
}

export function subscribeKeybindings(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
