// Only actions the native Electron menu owns an accelerator for live here —
// "New chat" and "Settings" are dispatched by the OS-level menu accelerator,
// so rebinding them means rebuilding the menu (see menu.ts). Renderer-only
// shortcuts (command palette, shortcuts dialog) are matched in JS instead;
// see frontend/src/lib/keybindings.ts for those.
export type KeybindingAction = "newChat" | "openSettings";

export const DEFAULT_MENU_KEYBINDINGS: Record<KeybindingAction, string> = {
    newChat: "mod+n",
    openSettings: "mod+,",
};

// Converts this app's normalized binding string ("mod+shift+n") into an
// Electron accelerator ("CmdOrCtrl+Shift+N").
export function bindingToAccelerator(binding: string): string {
    return binding
        .split("+")
        .map((part) => {
            if (part === "mod") return "CmdOrCtrl";
            if (part === "shift") return "Shift";
            if (part === "alt") return "Alt";
            if (part === "escape") return "Esc";
            return /^[a-z]$/.test(part) ? part.toUpperCase() : part;
        })
        .join("+");
}
