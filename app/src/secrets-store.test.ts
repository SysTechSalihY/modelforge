import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as secretsStore from "./secrets-store";
import { app } from "electron";

describe("secrets-store", () => {
    it("reports a key as absent before it's set", () => {
        expect(secretsStore.hasSecret("does_not_exist")).toBe(false);
        expect(secretsStore.getSecret("does_not_exist")).toBeNull();
    });

    it("round-trips a secret through set/get", () => {
        secretsStore.setSecret("openai_api_key", "sk-test-123");
        expect(secretsStore.hasSecret("openai_api_key")).toBe(true);
        expect(secretsStore.getSecret("openai_api_key")).toBe("sk-test-123");
    });

    it("deletes a secret when set to an empty value", () => {
        secretsStore.setSecret("anthropic_api_key", "sk-ant-test");
        secretsStore.setSecret("anthropic_api_key", "");
        expect(secretsStore.hasSecret("anthropic_api_key")).toBe(false);
    });

    it("never stores the raw value in plaintext on disk", () => {
        const plaintext = "sk-should-be-encrypted";
        secretsStore.setSecret("openai_api_key", plaintext);

        const onDisk = fs.readFileSync(path.join(app.getPath("userData"), "secrets.json"), "utf-8");
        expect(onDisk).not.toContain(plaintext);
        expect(secretsStore.getSecret("openai_api_key")).toBe(plaintext);
    });
});
