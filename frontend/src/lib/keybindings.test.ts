import { describe, it, expect } from "vitest";
import { eventToBindingString, matchesBinding, formatBindingForDisplay } from "./keybindings";

function key(overrides: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) {
    return { key: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides };
}

describe("eventToBindingString", () => {
    it("normalizes ctrl and meta to the same 'mod' token", () => {
        expect(eventToBindingString(key({ key: "k", ctrlKey: true }))).toBe("mod+k");
        expect(eventToBindingString(key({ key: "k", metaKey: true }))).toBe("mod+k");
    });

    it("includes shift and alt in a fixed order", () => {
        expect(eventToBindingString(key({ key: "p", ctrlKey: true, shiftKey: true, altKey: true }))).toBe(
            "mod+shift+alt+p"
        );
    });

    it("returns null for a bare modifier keypress", () => {
        expect(eventToBindingString(key({ key: "Control", ctrlKey: true }))).toBeNull();
    });
});

describe("matchesBinding", () => {
    it("matches a KeyboardEvent-shaped object against a normalized binding", () => {
        const e = { key: "k", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false } as KeyboardEvent;
        expect(matchesBinding(e, "mod+k")).toBe(true);
        expect(matchesBinding(e, "mod+n")).toBe(false);
    });
});

describe("formatBindingForDisplay", () => {
    it("renders a single-letter binding in uppercase", () => {
        expect(formatBindingForDisplay("mod+n")).toMatch(/N$/);
    });
});
