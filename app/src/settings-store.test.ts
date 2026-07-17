import { describe, it, expect } from "vitest";
import { getSettings, saveSettings } from "./settings-store";

describe("settings-store", () => {
    it("returns sensible defaults before anything has been saved", () => {
        const settings = getSettings();
        expect(settings.ollamaHost).toBe("http://127.0.0.1:11434");
        expect(settings.theme).toBe("system");
        expect(settings.language).toBe("en");
    });

    it("merges a partial save on top of the existing settings", () => {
        saveSettings({ temperature: 0.3 });
        saveSettings({ theme: "dark" });

        const settings = getSettings();
        expect(settings.temperature).toBe(0.3);
        expect(settings.theme).toBe("dark");
        // untouched fields keep their previous/default values
        expect(settings.ollamaHost).toBe("http://127.0.0.1:11434");
    });
});
