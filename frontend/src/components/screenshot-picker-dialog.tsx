import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ScreenSourceInfo } from "@/types/electron";

export function ScreenshotPickerDialog({
    open,
    onOpenChange,
    onCapture,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCapture: (sourceId: string) => void;
}) {
    const { t } = useI18n();
    const [sources, setSources] = useState<ScreenSourceInfo[] | null>(null);

    useEffect(() => {
        if (!open) {
            // Intentional: clear stale thumbnails so re-opening always shows a
            // fresh loading state rather than a previous session's sources.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSources(null);
            return;
        }
        window.api.screen.listSources().then(setSources);
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t.captureScreenshot}</DialogTitle>
                    <DialogDescription>{t.captureScreenshotHelp}</DialogDescription>
                </DialogHeader>
                {sources === null ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : sources.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">{t.noScreenSources}</p>
                ) : (
                    <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                        {sources.map((source) => (
                            <button
                                key={source.id}
                                onClick={() => {
                                    onCapture(source.id);
                                    onOpenChange(false);
                                }}
                                className="flex flex-col items-center gap-1.5 rounded-lg border border-border p-2 text-left hover:border-primary hover:bg-muted"
                            >
                                <img
                                    src={source.thumbnailDataUrl}
                                    alt={source.name}
                                    className="aspect-video w-full rounded object-cover"
                                />
                                <span className="w-full truncate text-xs text-muted-foreground">{source.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
