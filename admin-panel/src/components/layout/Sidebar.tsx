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

const W = 260;

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
                width: W,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: {
                    width: W,
                    boxSizing: "border-box",
                    borderRightColor: "divider",
                },
            }}
        >
            <Box sx={{ p: 2 }}>
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
                            sx={{ borderRadius: 2, mb: 0.5 }}
                        >
                            <ListItemText primary={item.label} />
                        </ListItemButton>
                    );
                })}
            </List>

            <Box sx={{ flex: 1 }} />

            <Divider />
            <Box sx={{ p: 2 }}>
                <Typography variant="caption" color="text.secondary">
                    v0.1 (demo)
                </Typography>
            </Box>
        </Drawer>
    );
}
