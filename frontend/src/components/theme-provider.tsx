import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";
export type AccentColor = "default" | "blue" | "green" | "purple" | "orange" | "rose";

// eslint-disable-next-line react-refresh/only-export-components -- constant shared with the accent-color picker in Settings
export const ACCENT_COLORS: AccentColor[] = ["default", "blue", "green", "purple", "orange", "rose"];

type ThemeProviderProps = {
    children: React.ReactNode;
    defaultTheme?: Theme;
    storageKey?: string;
};

type ThemeProviderState = {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    accent: AccentColor;
    setAccent: (accent: AccentColor) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);
const ACCENT_STORAGE_KEY = "vite-ui-accent";

export function ThemeProvider({
    children,
    defaultTheme = "system",
    storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>(
        () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
    );
    const [accent, setAccentState] = useState<AccentColor>(
        () => (localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor) || "default"
    );

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove("light", "dark");

        if (theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light";
            root.classList.add(systemTheme);
            return;
        }

        root.classList.add(theme);
    }, [theme]);

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove(...ACCENT_COLORS.map((c) => `theme-${c}`));
        if (accent !== "default") root.classList.add(`theme-${accent}`);
    }, [accent]);

    const setTheme = (theme: Theme) => {
        localStorage.setItem(storageKey, theme);
        setThemeState(theme);
    };

    const setAccent = (accent: AccentColor) => {
        localStorage.setItem(ACCENT_STORAGE_KEY, accent);
        setAccentState(accent);
    };

    return (
        <ThemeProviderContext.Provider value={{ theme, setTheme, accent, setAccent }}>
            {children}
        </ThemeProviderContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
    const context = useContext(ThemeProviderContext);
    if (context === undefined)
        throw new Error("useTheme must be used within a ThemeProvider");
    return context;
};