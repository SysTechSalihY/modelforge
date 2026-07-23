import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_KEYBINDINGS, formatBindingForDisplay, type KeybindingAction } from "@/lib/keybindings";

function Shortcut({ label, keys }: { label: string; keys: string[] }) {
    return (
        <div className="flex items-center justify-between gap-4 py-1.5">
            <span className="text-sm text-muted-foreground">{label}</span>
            <div className="flex gap-1">
                {keys.map((k, i) => (
                    <kbd
                        key={i}
                        className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
                    >
                        {k}
                    </kbd>
                ))}
            </div>
        </div>
    );
}

export function KeyboardShortcutsDialog({
    open,
    onOpenChange,
    keybindings = DEFAULT_KEYBINDINGS,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    keybindings?: Record<KeybindingAction, string>;
}) {
    const { t } = useI18n();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.keyboardShortcuts}</DialogTitle>
                    <DialogDescription>{t.keyboardShortcutsHelp}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col divide-y divide-border">
                    <Shortcut label={t.shortcutCommandPalette} keys={[formatBindingForDisplay(keybindings.commandPalette)]} />
                    <Shortcut label={t.shortcutNewChat} keys={[formatBindingForDisplay(keybindings.newChat)]} />
                    <Shortcut label={t.shortcutSettings} keys={[formatBindingForDisplay(keybindings.openSettings)]} />
                    <Shortcut label={t.shortcutShowShortcuts} keys={[formatBindingForDisplay(keybindings.showShortcuts)]} />
                    <Shortcut label={t.shortcutSend} keys={["Enter"]} />
                    <Shortcut label={t.shortcutNewline} keys={["Shift", "Enter"]} />
                    <Shortcut label={t.shortcutStopGenerating} keys={["Esc"]} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
