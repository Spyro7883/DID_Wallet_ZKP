"use client";

import { AppBar, Toolbar, Typography } from "@mui/material";

export default function Topbar() {
    return (
        <AppBar position="fixed" elevation={0} color="transparent">
            <Toolbar>
                <Typography fontWeight={700}>Admin Panel</Typography>
            </Toolbar>
        </AppBar>
    );
}
