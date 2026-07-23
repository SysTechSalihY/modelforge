// Compact relative timestamps for the chat sidebar ("5m", "2h", "3d") —
// falls back to an absolute short date once a conversation is old enough
// that "Nw" stops being a useful at-a-glance signal.
export function formatRelativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffSec = Math.round(diffMs / 1000);
    if (diffSec < 60) return "now";
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h`;
    const diffDay = Math.round(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d`;
    const diffWeek = Math.round(diffDay / 7);
    if (diffWeek < 5) return `${diffWeek}w`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
