import { describe, it, expect } from "vitest";
import { bindingToAccelerator } from "./keybindings";

describe("bindingToAccelerator", () => {
    it("converts a simple mod+letter binding", () => {
        expect(bindingToAccelerator("mod+n")).toBe("CmdOrCtrl+N");
    });

    it("converts a binding with shift and a punctuation key", () => {
        expect(bindingToAccelerator("mod+shift+,")).toBe("CmdOrCtrl+Shift+,");
    });

    it("converts a binding with alt", () => {
        expect(bindingToAccelerator("mod+alt+p")).toBe("CmdOrCtrl+Alt+P");
    });
});
