// src/components/ui/DemoPage.tsx
"use client";

import * as React from "react";
import {
    Alert,
    Box,
    Breadcrumbs,
    Card,
    CardContent,
    Chip,
    Divider,
    Stack,
    Typography,
    Button,
    TextField,
} from "@mui/material";
import Link from "next/link";

type DemoPageProps = {
    title: string;
    subtitle?: string;
    breadcrumbs?: Array<{ label: string; href?: string }>;
};

export default function DemoPage({ title, subtitle, breadcrumbs }: DemoPageProps) {
    const [value, setValue] = React.useState("");

    return (
        <Box>
            <Stack spacing={2} mb={2}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
                    <Box>
                        <Typography variant="h4" fontWeight={800} lineHeight={1.15}>
                            {title}
                        </Typography>
                        {subtitle ? (
                            <Typography color="text.secondary" mt={0.5}>
                                {subtitle}
                            </Typography>
                        ) : null}
                    </Box>

                    <Stack direction="row" spacing={1}>
                        <Button variant="outlined">Secondary</Button>
                        <Button variant="contained">Primary</Button>
                    </Stack>
                </Stack>

                <Breadcrumbs aria-label="breadcrumb">
                    {(breadcrumbs?.length ? breadcrumbs : [{ label: "Dashboard", href: "/dashboard" }, { label: title }]).map(
                        (b, i) =>
                            b.href ? (
                                <Link key={i} href={b.href} style={{ textDecoration: "none" }}>
                                    <Typography color="primary" variant="body2">
                                        {b.label}
                                    </Typography>
                                </Link>
                            ) : (
                                <Typography key={i} variant="body2" color="text.secondary">
                                    {b.label}
                                </Typography>
                            )
                    )}
                </Breadcrumbs>

                <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip label="Demo" size="small" />
                    <Chip label="MUI" size="small" />
                    <Chip label="Admin Panel" size="small" />
                </Stack>
            </Stack>

            <Stack spacing={2}>
                <Alert severity="info">
                    This is a placeholder page. Replace cards below with real API data when ready.
                </Alert>

                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                    <Card sx={{ flex: 1 }}>
                        <CardContent>
                            <Typography variant="overline" color="text.secondary">
                                Quick action
                            </Typography>
                            <Typography variant="h6" fontWeight={700} mt={0.5} mb={1}>
                                Test input
                            </Typography>

                            <Stack direction="row" spacing={1} alignItems="center">
                                <TextField
                                    size="small"
                                    label="Value"
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                />
                                <Button variant="contained" onClick={() => alert(`Value: ${value || "(empty)"}`)}>
                                    Run
                                </Button>
                            </Stack>

                            <Divider sx={{ my: 2 }} />

                            <Typography variant="body2" color="text.secondary">
                                Use this area for forms (issue VC, create request, filters).
                            </Typography>
                        </CardContent>
                    </Card>

                    <Card sx={{ flex: 1 }}>
                        <CardContent>
                            <Typography variant="overline" color="text.secondary">
                                Recent activity
                            </Typography>
                            <Typography variant="h6" fontWeight={700} mt={0.5} mb={1}>
                                Example log items
                            </Typography>

                            <Stack spacing={1}>
                                {[
                                    { label: "VP verified", detail: "policy: office_entry", ok: true },
                                    { label: "VC issued", detail: "type: EmploymentCredential", ok: true },
                                    { label: "VP failed", detail: "reason: invalid signature", ok: false },
                                ].map((x, idx) => (
                                    <Box
                                        key={idx}
                                        sx={{
                                            p: 1.25,
                                            borderRadius: 2,
                                            border: "1px solid",
                                            borderColor: "divider",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 1,
                                        }}
                                    >
                                        <Box>
                                            <Typography fontWeight={700} variant="body2">
                                                {x.label}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {x.detail}
                                            </Typography>
                                        </Box>
                                        <Chip
                                            size="small"
                                            color={x.ok ? "success" : "error"}
                                            label={x.ok ? "OK" : "FAIL"}
                                            variant="outlined"
                                        />
                                    </Box>
                                ))}
                            </Stack>
                        </CardContent>
                    </Card>
                </Stack>

                <Card>
                    <CardContent>
                        <Typography variant="overline" color="text.secondary">
                            Notes
                        </Typography>
                        <Typography variant="h6" fontWeight={700} mt={0.5} mb={1}>
                            Replace with real content
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Put your DataGrid here later (DIDs, issued VCs, requests, verifications, audit logs).
                        </Typography>
                    </CardContent>
                </Card>
            </Stack>
        </Box>
    );
}
