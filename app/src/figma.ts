export interface FigmaFrameImage {
    dataBase64: string;
    mimeType: string;
    name: string;
}

// Figma frame/layer links look like:
//   https://www.figma.com/file/<fileKey>/<name>?node-id=<nodeId>
//   https://www.figma.com/design/<fileKey>/<name>?node-id=<nodeId>
// "Copy link to selection" in Figma includes node-id; a plain file link
// (no selection) doesn't, and there's no single "whole file" export that
// makes sense as one image, so that case is reported as a clear error
// rather than guessed at.
export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } | null {
    const fileMatch = url.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)\//);
    const nodeMatch = url.match(/node-id=([^&]+)/);
    if (!fileMatch || !nodeMatch) return null;
    return { fileKey: fileMatch[1], nodeId: decodeURIComponent(nodeMatch[1]).replace(/-/g, ":") };
}

export async function fetchFigmaFrameImage(token: string, url: string): Promise<FigmaFrameImage> {
    const parsed = parseFigmaUrl(url);
    if (!parsed) {
        throw new Error(
            "Couldn't find a specific frame/layer in that link. In Figma, select the frame you want, right-click it, choose \"Copy link to selection\", and paste that URL here."
        );
    }
    const { fileKey, nodeId } = parsed;

    let res: Response;
    try {
        res = await fetch(`https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`, {
            headers: { "X-Figma-Token": token },
        });
    } catch (err) {
        throw new Error(`Couldn't reach the Figma API: ${(err as Error).message}`);
    }
    if (!res.ok) {
        throw new Error(
            res.status === 403 || res.status === 401
                ? "Figma rejected the request — check your personal access token in Settings."
                : `Figma API error (HTTP ${res.status}).`
        );
    }
    const data = (await res.json()) as { images?: Record<string, string | null>; err?: string };
    if (data.err) throw new Error(`Figma API error: ${data.err}`);
    const imageUrl = data.images?.[nodeId];
    if (!imageUrl) {
        throw new Error("Figma didn't return an image for that frame — it may have been deleted, or you may not have access to it.");
    }

    let imgRes: Response;
    try {
        imgRes = await fetch(imageUrl);
    } catch (err) {
        throw new Error(`Failed to download the exported image from Figma: ${(err as Error).message}`);
    }
    if (!imgRes.ok) throw new Error("Failed to download the exported image from Figma.");
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return { dataBase64: buffer.toString("base64"), mimeType: "image/png", name: `figma-${nodeId.replace(":", "-")}.png` };
}
