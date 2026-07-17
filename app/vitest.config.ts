import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            electron: path.resolve(__dirname, "src/test/electron-mock.ts"),
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
