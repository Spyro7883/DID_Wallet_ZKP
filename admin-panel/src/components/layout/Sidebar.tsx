"use client";

import {
    Drawer,
    List,
    ListItemButton,
    ListItemText,
    Divider,
    Box,
    Typography,
} from "@mui/material";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const SIDEBAR_WIDTH = 260;

const NAV = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "DIDs", href: "/dids" },
    { label: "Issue VC", href: "/issue-vc" },
    { label: "Requests", href: "/requests" },
    { label: "Verifications", href: "/verifications" },
    { label: "Audit", href: "/audit" },
];

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: SIDEBAR_WIDTH,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: {
                    width: SIDEBAR_WIDTH,
                    boxSizing: "border-box",
                    borderRight: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                },
            }}
        >
            <Box sx={{ p: 2.5 }}>
                <Typography fontWeight={800}>Admin Panel</Typography>
                <Typography variant="caption" color="text.secondary">
                    Issuer / Verifier
                </Typography>
            </Box>

            <Divider />

            <List sx={{ px: 1, py: 1 }}>
                {NAV.map((item) => {
                    const active =
                        pathname === item.href || pathname.startsWith(item.href + "/");

                    return (
                        <ListItemButton
                            key={item.href}
                            component={Link}
                            href={item.href}
                            selected={active}
                            sx={{
                                borderRadius: 2,
                                mb: 0.5,
                                "&.Mui-selected": {
                                    bgcolor: "action.selected",
                                    color: "primary.main",
                                    "& .MuiListItemText-primary": {
                                        fontWeight: 700,
                                    },
                                },
                                "&.Mui-selected:hover": {
                                    bgcolor: "action.selected",
                                },
                            }}
                        >
                            <ListItemText primary={item.label} />
                        </ListItemButton>
                    );
                })}
            </List>

            <Box sx={{ flex: 1 }} />
        </Drawer>
    );
}