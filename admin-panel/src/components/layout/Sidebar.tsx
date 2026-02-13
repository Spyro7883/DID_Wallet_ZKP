"use client";

import { Drawer, List, ListItemButton, ListItemText } from "@mui/material";
import Link from "next/link";

const W = 260;

export default function Sidebar() {
    return (
        <Drawer
            variant="permanent"
            sx={{
                width: W,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: { width: W, boxSizing: "border-box" },
            }}
        >
            <List>
                <ListItemButton component={Link} href="/dashboard">
                    <ListItemText primary="Dashboard" />
                </ListItemButton>
            </List>
        </Drawer>
    );
}
