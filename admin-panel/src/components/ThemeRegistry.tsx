"use client";

import * as React from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { getAppTheme } from "@/theme";

type AdminThemeMode = "light" | "dark";

type ThemeModeContextType = {
    mode: AdminThemeMode;
    toggleMode: () => void;
    setMode: (mode: AdminThemeMode) => void;
};

const ThemeModeContext = React.createContext<ThemeModeContextType | null>(null);
const STORAGE_KEY = "admin-panel-theme-mode";

export function useAdminThemeMode() {
    const ctx = React.useContext(ThemeModeContext);
    if (!ctx) {
        throw new Error("useAdminThemeMode must be used inside ThemeRegistry");
    }
    return ctx;
}

export default function ThemeRegistry({
    children,
}: {
    children: React.ReactNode;
}) {
    const [mode, setModeState] = React.useState<AdminThemeMode>("light");
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        const saved =
            typeof window !== "undefined"
                ? (window.localStorage.getItem(STORAGE_KEY) as AdminThemeMode | null)
                : null;

        if (saved === "light" || saved === "dark") {
            setModeState(saved);
        } else if (
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ) {
            setModeState("dark");
        }

        setMounted(true);
    }, []);

    const setMode = React.useCallback((next: AdminThemeMode) => {
        setModeState(next);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(STORAGE_KEY, next);
        }
    }, []);

    const toggleMode = React.useCallback(() => {
        setMode(mode === "dark" ? "light" : "dark");
    }, [mode, setMode]);

    const theme = React.useMemo(() => getAppTheme(mode), [mode]);

    const value = React.useMemo(
        () => ({
            mode,
            toggleMode,
            setMode,
        }),
        [mode, toggleMode, setMode]
    );

    if (!mounted) {
        return null;
    }

    return (
        <ThemeModeContext.Provider value={value}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </ThemeProvider>
        </ThemeModeContext.Provider>
    );
}