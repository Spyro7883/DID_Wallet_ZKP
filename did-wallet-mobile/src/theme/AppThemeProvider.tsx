import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DARK_COLORS, LIGHT_COLORS, type AppColors } from "./colors";

export type ThemeMode = "light" | "dark" | "system";

type ThemeContextValue = {
    mode: ThemeMode;
    resolvedMode: "light" | "dark";
    colors: AppColors;
    hydrated: boolean;
    setMode: (mode: ThemeMode) => Promise<void>;
    toggleMode: () => Promise<void>;
};

const STORAGE_KEY = "app_theme_mode";

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
    const systemScheme = useColorScheme();

    const [mode, setModeState] = useState<ThemeMode>("system");
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                const saved = await AsyncStorage.getItem(STORAGE_KEY);
                if (!alive) return;

                if (saved === "light" || saved === "dark" || saved === "system") {
                    setModeState(saved);
                }
            } finally {
                if (alive) setHydrated(true);
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    const resolvedMode: "light" | "dark" =
        mode === "system"
            ? systemScheme === "dark"
                ? "dark"
                : "light"
            : mode;

    const colors = resolvedMode === "dark" ? DARK_COLORS : LIGHT_COLORS;

    const setMode = useCallback(async (next: ThemeMode) => {
        setModeState(next);
        await AsyncStorage.setItem(STORAGE_KEY, next);
    }, []);

    const toggleMode = useCallback(async () => {
        const next: ThemeMode = resolvedMode === "dark" ? "light" : "dark";
        setModeState(next);
        await AsyncStorage.setItem(STORAGE_KEY, next);
    }, [resolvedMode]);

    const value = useMemo(
        () => ({
            mode,
            resolvedMode,
            colors,
            hydrated,
            setMode,
            toggleMode,
        }),
        [mode, resolvedMode, colors, hydrated, setMode, toggleMode],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error("useAppTheme must be used inside AppThemeProvider");
    }
    return ctx;
}