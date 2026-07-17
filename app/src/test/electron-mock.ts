// A minimal stand-in for the parts of the `electron` module this codebase's
// unit-testable logic touches (store modules need `app.getPath`; secrets-store
// needs `safeStorage`). Real Electron can't run inside a plain Node test
// process, so vitest.config.ts aliases all `electron` imports to this file.
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelforge-test-"));

export const app = {
    getPath: (name: string) => {
        if (name === "userData") return tmpUserDataDir;
        return os.tmpdir();
    },
    getVersion: () => "0.0.0-test",
};

// Plain passthrough (base64) "encryption" — good enough to test that
// secrets-store round-trips values through whatever safeStorage provides,
// without needing a real OS credential store in the test environment.
export const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf-8"),
    decryptString: (buf: Buffer) => buf.toString("utf-8"),
};
