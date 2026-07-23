import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeTime } from "./format-time";

describe("formatRelativeTime", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");

    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns 'now' for a timestamp seconds ago", () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        expect(formatRelativeTime(new Date(now.getTime() - 30_000).toISOString())).toBe("now");
    });

    it("returns minutes for a timestamp under an hour ago", () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000).toISOString())).toBe("5m");
    });

    it("returns hours for a timestamp under a day ago", () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        expect(formatRelativeTime(new Date(now.getTime() - 3 * 3_600_000).toISOString())).toBe("3h");
    });

    it("returns days for a timestamp under a week ago", () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        expect(formatRelativeTime(new Date(now.getTime() - 2 * 86_400_000).toISOString())).toBe("2d");
    });

    it("falls back to a short date for anything a month or older", () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const monthAgo = new Date(now.getTime() - 40 * 86_400_000).toISOString();
        expect(formatRelativeTime(monthAgo)).not.toMatch(/^\d+[mhdw]$/);
    });
});
