import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { PROVIDER_LABELS } from "@/lib/providers";
import { formatCost } from "@/lib/pricing";
import { summarizeSession, aggregateBy } from "@/lib/usage";
import type { ChatSession, ProviderId } from "@/types/electron";

export default function UsageDashboard() {
    const { t } = useI18n();
    const hasApi = typeof window !== "undefined" && !!window.api;
    const [sessions, setSessions] = useState<ChatSession[]>([]);

    useEffect(() => {
        if (!hasApi) return;
        window.api.sessions.list().then(setSessions);
    }, [hasApi]);

    const usages = useMemo(
        () => sessions.map(summarizeSession).filter((u) => u.promptTokens > 0 || u.completionTokens > 0),
        [sessions]
    );

    const totalCost = usages.reduce((sum, u) => sum + (u.cost ?? 0), 0);
    const totalTokens = usages.reduce((sum, u) => sum + u.promptTokens + u.completionTokens, 0);
    const byProvider = useMemo(() => aggregateBy(usages, (u) => u.provider ?? "unknown"), [usages]);
    const byModel = useMemo(() => aggregateBy(usages, (u) => u.modelId ?? "unknown"), [usages]);

    const byDay = useMemo(() => {
        const costByDay = new Map<string, number>();
        for (const u of usages) {
            const day = u.session.createdAt.slice(0, 10);
            costByDay.set(day, (costByDay.get(day) ?? 0) + (u.cost ?? 0));
        }
        const days: { day: string; cost: number }[] = [];
        const today = new Date();
        for (let i = 13; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            days.push({ day: key, cost: costByDay.get(key) ?? 0 });
        }
        return days;
    }, [usages]);

    const maxDayCost = Math.max(...byDay.map((d) => d.cost), 0.0001);

    if (!hasApi) {
        return (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Usage dashboard is only available when running inside the Electron app.
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <BarChart3 className="size-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{t.usageDashboard}</span>
            </div>

            <ScrollArea className="flex-1">
                <div className="flex flex-col gap-6 p-4">
                    {usages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t.usageNoData}</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="rounded-lg border border-border p-4">
                                    <p className="text-xs text-muted-foreground">{t.usageTotalCost}</p>
                                    <p className="mt-1 text-2xl font-semibold">{formatCost(totalCost)}</p>
                                </div>
                                <div className="rounded-lg border border-border p-4">
                                    <p className="text-xs text-muted-foreground">{t.usageTotalTokens}</p>
                                    <p className="mt-1 text-2xl font-semibold">{totalTokens.toLocaleString()}</p>
                                </div>
                                <div className="rounded-lg border border-border p-4">
                                    <p className="text-xs text-muted-foreground">{t.usageTotalSessions}</p>
                                    <p className="mt-1 text-2xl font-semibold">{usages.length}</p>
                                </div>
                            </div>

                            <div>
                                <h3 className="mb-2 text-sm font-semibold">{t.usageByDay}</h3>
                                <div className="flex h-24 items-end gap-1 rounded-lg border border-border p-3">
                                    {byDay.map((d) => (
                                        <div
                                            key={d.day}
                                            className="flex flex-1 flex-col items-center justify-end gap-1"
                                            title={`${d.day}: ${formatCost(d.cost)}`}
                                        >
                                            <div
                                                className="w-full rounded-t bg-primary/70"
                                                style={{ height: `${Math.max(2, (d.cost / maxDayCost) * 100)}%` }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <h3 className="mb-2 text-sm font-semibold">{t.usageByProvider}</h3>
                                    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                                        {byProvider.map(([provider, stats]) => (
                                            <div key={provider} className="flex items-center justify-between gap-4 p-3 text-sm">
                                                <span>{PROVIDER_LABELS[provider as ProviderId] ?? provider}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {stats.sessions} {t.usageSessions} · {stats.tokens.toLocaleString()} tok
                                                </span>
                                                <span className="font-medium">{formatCost(stats.cost)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <h3 className="mb-2 text-sm font-semibold">{t.usageByModel}</h3>
                                    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                                        {byModel.map(([modelId, stats]) => (
                                            <div key={modelId} className="flex items-center justify-between gap-4 p-3 text-sm">
                                                <span className="truncate">{modelId}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {stats.sessions} {t.usageSessions} · {stats.tokens.toLocaleString()} tok
                                                </span>
                                                <span className="font-medium">{formatCost(stats.cost)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
