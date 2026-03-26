"use client";

import {
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Tooltip,
    Box,
} from "@mui/material";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { SIDEBAR_WIDTH } from "@/components/layout/Sidebar";
import { useAdminThemeMode } from "@/components/ThemeRegistry";

export default function Topbar() {
    const { mode, toggleMode } = useAdminThemeMode();

    const isDark = mode === "dark";

    return (
        <AppBar
            position="fixed"
            color="transparent"
            elevation={0}
            sx={{
                width: `calc(100% - ${SIDEBAR_WIDTH}px)`,
                ml: `${SIDEBAR_WIDTH}px`,
                bgcolor: "background.default",
                borderBottom: "1px solid",
                borderColor: "divider",
                backdropFilter: "blur(8px)",
                backgroundImage: "none",
            }}
        >
            <Toolbar sx={{ justifyContent: "space-between", minHeight: 64 }}>
                <Box>
                    <Typography fontWeight={800} fontSize={18}>
                        Admin Panel
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Institution issuer / verifier
                    </Typography>
                </Box>

                <Tooltip
                    title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                >
                    <IconButton
                        onClick={toggleMode}
                        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                        sx={{
                            width: 42,
                            height: 42,
                            border: "1px solid",
                            borderColor: "divider",
                            bgcolor: "background.paper",
                            color: "text.primary",
                            "&:hover": {
                                bgcolor: "action.hover",
                            },
                        }}
                    >
                        {isDark ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
                    </IconButton>
                </Tooltip>
            </Toolbar>
        </AppBar>
    );
}