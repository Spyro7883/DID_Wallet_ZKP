"use client";

import { Box, Toolbar } from "@mui/material";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
            <Sidebar />
            <Box sx={{ flex: 1 }}>
                <Topbar />
                <Toolbar />
                <Box sx={{ p: 3 }}>{children}</Box>
            </Box>
        </Box>
    );
}
