import * as fs from "node:fs";
import * as path from "node:path";
import { BrowserWindow } from "electron";

const SCREENSHOT_LOAD_TIMEOUT_MS = 15_000;
// Brief settle time after load for fonts/late JS/animations before the
// capture — a screenshot taken the instant `did-finish-load` fires often
// catches an unstyled flash of content.
const SETTLE_MS = 300;

function clampDimension(n: number): number {
    return Math.round(Math.max(200, Math.min(n, 3840)));
}

export interface CapturedScreenshot {
    path: string;
    width: number;
    height: number;
}

// Renders a page in a hidden, offscreen BrowserWindow and saves it as a PNG
// inside the workspace (under .agent-screenshots/) rather than returning raw
// image bytes as the tool result — a base64 PNG in the tool-result text
// would bloat every subsequent request in the conversation with the same
// image data. The user (or the agent via read_file on a vision-capable
// model) can open the saved file directly.
export async function capturePageScreenshot(
    workspaceRoot: string,
    url: string,
    width = 1280,
    height = 800
): Promise<CapturedScreenshot> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`"${url}" is not a valid URL.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http:// and https:// URLs can be captured.");
    }

    const clampedWidth = clampDimension(width);
    const clampedHeight = clampDimension(height);
    const win = new BrowserWindow({
        width: clampedWidth,
        height: clampedHeight,
        show: false,
        webPreferences: { offscreen: true },
    });

    try {
        await Promise.race([
            win.loadURL(url),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timed out loading ${url}`)), SCREENSHOT_LOAD_TIMEOUT_MS)
            ),
        ]);
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        const image = await win.webContents.capturePage();

        const dir = path.join(workspaceRoot, ".agent-screenshots");
        fs.mkdirSync(dir, { recursive: true });
        const fileName = `screenshot-${Date.now()}.png`;
        fs.writeFileSync(path.join(dir, fileName), image.toPNG());

        return { path: `.agent-screenshots/${fileName}`, width: clampedWidth, height: clampedHeight };
    } finally {
        win.destroy();
    }
}
