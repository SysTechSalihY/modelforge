import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export function PromptVariableDialog({
    open,
    onOpenChange,
    variables,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    variables: string[];
    onSubmit: (values: Record<string, string>) => void;
}) {
    const { t } = useI18n();
    const [values, setValues] = useState<Record<string, string>>({});

    // Reset the form fresh every time a new set of variables is opened,
    // rather than carrying over stale values from whatever preset was
    // filled in last.
    useEffect(() => {
        // Intentional: reset the form fresh each time the dialog opens for a
        // new preset, rather than carrying over stale values.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (open) setValues({});
    }, [open, variables]);

    function handleSubmit() {
        onSubmit(values);
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.fillPromptVariables}</DialogTitle>
                    <DialogDescription>{t.fillPromptVariablesHelp}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    {variables.map((v, i) => (
                        <div key={v} className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">{v}</label>
                            <Input
                                autoFocus={i === 0}
                                value={values[v] ?? ""}
                                onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                            />
                        </div>
                    ))}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t.cancel}
                    </Button>
                    <Button onClick={handleSubmit}>{t.apply}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
