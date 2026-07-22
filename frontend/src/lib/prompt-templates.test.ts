import { describe, it, expect } from "vitest";
import { extractVariables, fillTemplate } from "./prompt-templates";

describe("extractVariables", () => {
    it("returns an empty array for a template with no variables", () => {
        expect(extractVariables("You are a helpful assistant.")).toEqual([]);
    });

    it("finds a single variable", () => {
        expect(extractVariables("Write about {{topic}}.")).toEqual(["topic"]);
    });

    it("finds multiple distinct variables in order of first appearance", () => {
        expect(extractVariables("{{tone}} summary of {{topic}} for {{audience}}.")).toEqual([
            "tone",
            "topic",
            "audience",
        ]);
    });

    it("deduplicates repeated variables, keeping first-seen order", () => {
        expect(extractVariables("{{topic}} ... more about {{topic}} and {{audience}}")).toEqual([
            "topic",
            "audience",
        ]);
    });

    it("tolerates extra whitespace inside the braces", () => {
        expect(extractVariables("{{  topic  }}")).toEqual(["topic"]);
    });
});

describe("fillTemplate", () => {
    it("substitutes a single variable", () => {
        expect(fillTemplate("Write about {{topic}}.", { topic: "cats" })).toBe("Write about cats.");
    });

    it("substitutes multiple occurrences of the same variable", () => {
        expect(fillTemplate("{{name}} says hi, {{name}}!", { name: "Ada" })).toBe("Ada says hi, Ada!");
    });

    it("replaces a missing value with an empty string rather than leaving the placeholder", () => {
        expect(fillTemplate("Hello {{name}}.", {})).toBe("Hello .");
    });

    it("leaves plain text with no variables unchanged", () => {
        expect(fillTemplate("You are a helpful assistant.", { unused: "x" })).toBe("You are a helpful assistant.");
    });
});
