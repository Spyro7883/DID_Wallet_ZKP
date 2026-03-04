"use client";

import * as React from "react";
import {
    Box,
    Card,
    CardContent,
    Typography,
    Stack,
    Button,
    TextField,
    Divider,
    Alert,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    MenuItem,
} from "@mui/material";
import { api } from "@/lib/api";

type ProofReqRow = {
    id: string;
    status: string;
    policy: string;
    requester_id: string | null;
    expires_at: string;
    created_at: string;
};

type ProofReqDetail = {
    id: string;
    status: string;
    policy: string;
    requesterId: string | null;
    nonce: string;
    constraints: any;
    expiresAt: string;
    createdAt: string;
};

function pretty(v: any) {
    try {
        return JSON.stringify(v ?? {}, null, 2);
    } catch {
        return String(v);
    }
}

function statusChip(st: string) {
    const s = String(st || "").toLowerCase();
    if (s === "open") return <Chip size="small" label="open" color="success" variant="outlined" />;
    if (s === "closed") return <Chip size="small" label="closed" color="warning" variant="outlined" />;
    if (s === "expired") return <Chip size="small" label="expired" color="error" variant="outlined" />;
    return <Chip size="small" label={s || "unknown"} variant="outlined" />;
}

export default function RequestsClient() {
    const API_BASE =
        process.env.NEXT_PUBLIC_API_BASE_URL ??
        (typeof window !== "undefined"
            ? window.location.origin.replace(":3000", ":5501")
            : "http://localhost:5501");

    const [err, setErr] = React.useState("");

    const [status, setStatus] = React.useState<"open" | "closed" | "expired" | "all">("all");
    const [q, setQ] = React.useState("");

    const [items, setItems] = React.useState<ProofReqRow[]>([]);
    const [loadingList, setLoadingList] = React.useState(true);

    const [open, setOpen] = React.useState(false);
    const [selectedId, setSelectedId] = React.useState<string>("");
    const [detail, setDetail] = React.useState<ProofReqDetail | null>(null);
    const [loadingDetail, setLoadingDetail] = React.useState(false);

    const copy = (v: string) => navigator.clipboard.writeText(v);

    async function loadList() {
        setLoadingList(true);
        setErr("");
        try {
            const res = await api<{ ok: boolean; items: ProofReqRow[] }>(
                `/admin/proof-requests?status=${encodeURIComponent(status)}&limit=50`,
            );
            setItems(res.items || []);
        } catch (e: any) {
            setErr(e?.message || "Failed to load proof requests");
            setItems([]);
        } finally {
            setLoadingList(false);
        }
    }

    React.useEffect(() => {
        loadList();
    }, [status]);

    const filtered = React.useMemo(() => {
        const qq = String(q || "").trim().toLowerCase();
        if (!qq) return items;
        return (items || []).filter((r) =>
            `${r.id} ${r.status} ${r.policy} ${r.requester_id ?? ""} ${r.expires_at ?? ""} ${r.created_at ?? ""}`
                .toLowerCase()
                .includes(qq),
        );
    }, [items, q]);

    async function openDetails(id: string) {
        setOpen(true);
        setSelectedId(id);
        setDetail(null);
        setLoadingDetail(true);
        setErr("");

        try {
            const res = await api<{ ok: boolean; request: ProofReqDetail }>(
                `/proof-requests/${encodeURIComponent(id)}`,
            );
            setDetail(res.request);
        } catch (e: any) {
            setErr(e?.message || "Failed to load request details");
            setDetail(null);
        } finally {
            setLoadingDetail(false);
        }
    }

    const publicLinkFor = (id: string) =>
        `${String(API_BASE).replace(/\/$/, "")}/proof-requests/${encodeURIComponent(id)}`;

    return (
        <Box>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                mb={2}
                gap={2}
                flexWrap="wrap"
            >
                <Box>
                    <Typography variant="h4" fontWeight={800}>
                        Proof Requests
                    </Typography>
                    <Typography color="text.secondary">
                        Monitor presentation requests (created automatically by users/services)
                    </Typography>
                </Box>

                <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button variant="outlined" onClick={loadList} disabled={loadingList}>
                        {loadingList ? "Refreshing..." : "Refresh"}
                    </Button>
                </Stack>
            </Stack>

            {err ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {err}
                </Alert>
            ) : null}

            <Card sx={{ mb: 2 }}>
                <CardContent>
                    <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
                        <TextField
                            select
                            label="Status"
                            value={status}
                            onChange={(e) => setStatus(e.target.value as any)}
                            sx={{ minWidth: 180 }}
                        >
                            <MenuItem value="all">all</MenuItem>
                            <MenuItem value="open">open</MenuItem>
                            <MenuItem value="closed">closed</MenuItem>
                            <MenuItem value="expired">expired</MenuItem>
                        </TextField>

                        <TextField
                            label="Search"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="id / policy / requester"
                            sx={{ minWidth: 320, flex: 1 }}
                        />

                        <Chip
                            label={`${filtered.length} shown / ${items.length} total`}
                            size="small"
                            variant="outlined"
                        />
                    </Stack>
                </CardContent>
            </Card>

            <Card>
                <CardContent>
                    <Typography variant="h6" fontWeight={800} mb={1}>
                        Requests
                    </Typography>

                    <Stack spacing={1}>
                        {filtered.map((r) => (
                            <Box
                                key={r.id}
                                sx={{
                                    p: 1.25,
                                    border: "1px solid",
                                    borderColor: "divider",
                                    borderRadius: 2,
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 2,
                                    alignItems: "center",
                                }}
                            >
                                <Box sx={{ minWidth: 0 }}>
                                    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                                        <Typography fontWeight={800} variant="body2">
                                            {r.policy}
                                        </Typography>
                                        {statusChip(r.status)}
                                    </Stack>

                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ wordBreak: "break-all" }}
                                    >
                                        {r.id} · exp {String(r.expires_at).slice(0, 19)} ·{" "}
                                        {r.requester_id || "-"}
                                    </Typography>
                                </Box>

                                <Stack direction="row" spacing={1} flexShrink={0}>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => copy(publicLinkFor(r.id))}
                                    >
                                        Copy link
                                    </Button>
                                    <Button size="small" variant="contained" onClick={() => openDetails(r.id)}>
                                        Details
                                    </Button>
                                </Stack>
                            </Box>
                        ))}

                        {!loadingList && filtered.length === 0 ? (
                            <Typography color="text.secondary">No requests.</Typography>
                        ) : null}
                    </Stack>
                </CardContent>
            </Card>

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Request details</DialogTitle>
                <DialogContent sx={{ pt: 2 }}>
                    {loadingDetail ? (
                        <Typography color="text.secondary">Loading...</Typography>
                    ) : detail ? (
                        <Stack spacing={1.25}>
                            <Stack direction="row" justifyContent="space-between" gap={2} flexWrap="wrap">
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="overline" color="text.secondary">
                                        Request ID
                                    </Typography>
                                    <Typography fontWeight={800} sx={{ wordBreak: "break-all" }}>
                                        {detail.id}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1 }}>
                                    {statusChip(detail.status)}
                                </Box>
                            </Stack>

                            <Divider />

                            <Stack direction="row" gap={2} flexWrap="wrap">
                                <Chip label={`policy: ${detail.policy}`} size="small" variant="outlined" />
                                <Chip
                                    label={`requester: ${detail.requesterId ?? "-"}`}
                                    size="small"
                                    variant="outlined"
                                />
                                <Chip
                                    label={`expires: ${String(detail.expiresAt).slice(0, 19)}`}
                                    size="small"
                                    variant="outlined"
                                />
                            </Stack>

                            <TextField
                                label="Public link"
                                value={publicLinkFor(detail.id)}
                                fullWidth
                                InputProps={{ readOnly: true } as any}
                            />

                            <TextField
                                label="Nonce"
                                value={detail.nonce}
                                fullWidth
                                InputProps={{ readOnly: true } as any}
                            />

                            <TextField
                                label="Constraints"
                                value={pretty(detail.constraints)}
                                fullWidth
                                multiline
                                minRows={8}
                                InputProps={{ readOnly: true } as any}
                            />

                            <Typography variant="caption" color="text.secondary">
                                createdAt: {String(detail.createdAt)} · expiresAt: {String(detail.expiresAt)}
                            </Typography>
                        </Stack>
                    ) : (
                        <Typography color="text.secondary">No data.</Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Close</Button>
                    <Button
                        variant="outlined"
                        onClick={() => copy(publicLinkFor(selectedId))}
                        disabled={!selectedId}
                    >
                        Copy link
                    </Button>
                    <Button
                        variant="outlined"
                        onClick={() => copy(String(selectedId))}
                        disabled={!selectedId}
                    >
                        Copy id
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}