"use client";

import * as React from "react";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import { api } from "@/lib/api";

type VerificationListRow = {
    id: string;
    status: "open" | "closed" | "expired" | string;
    policy: string;
    requester_id: string | null;
    expires_at: string;
    created_at: string;

    submitted_at?: string | null;
    holder_did?: string | null;
    vp_hash?: string | null;
    result?: "accepted" | "rejected" | string | null;
    error?: string | null;
};

type VerificationDetail = {
    id: string;
    status: "open" | "closed" | "expired" | string;
    policy: string;
    requester_id: string | null;
    nonce: string;
    constraints: any;
    expires_at: string;
    created_at: string;
    submitted_at?: string | null;
    holder_did?: string | null;
    vp_hash?: string | null;
    result?: "accepted" | "rejected" | string | null;
    error?: string | null;
};

function fmt(v?: string | null) {
    if (!v) return "-";
    return String(v).slice(0, 19).replace("T", " ");
}

function short(v?: string | null, left = 12, right = 8) {
    const s = String(v || "");
    if (!s) return "-";
    if (s.length <= left + right + 3) return s;
    return `${s.slice(0, left)}...${s.slice(-right)}`;
}

function pretty(v: any) {
    try {
        return JSON.stringify(v ?? {}, null, 2);
    } catch {
        return String(v);
    }
}

function statusColor(status?: string | null) {
    if (status === "open") return "info";
    if (status === "closed") return "success";
    if (status === "expired") return "warning";
    return "default";
}

function resultColor(result?: string | null) {
    if (result === "accepted") return "success";
    if (result === "rejected") return "error";
    return "default";
}

export default function Page() {
    const [rows, setRows] = React.useState<VerificationListRow[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [hydrating, setHydrating] = React.useState(false);
    const [err, setErr] = React.useState("");

    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [selected, setSelected] = React.useState<VerificationDetail | null>(null);
    const [detailOpen, setDetailOpen] = React.useState(false);
    const [detailLoading, setDetailLoading] = React.useState(false);

    const [statusFilter, setStatusFilter] = React.useState<"all" | "open" | "closed" | "expired">("all");
    const [search, setSearch] = React.useState("");

    const loadRows = React.useCallback(async () => {
        setErr("");
        setLoading(true);

        try {
            const res = await api<{ ok: boolean; items: VerificationListRow[] }>(
                "/admin/proof-requests?status=all&limit=100",
            );

            const baseRows = res.items || [];
            setRows(baseRows);
            setLoading(false);

            if (!baseRows.length) return;

            setHydrating(true);

            const detailResults = await Promise.allSettled(
                baseRows.map((r) =>
                    api<{ ok: boolean; request: VerificationDetail }>(
                        `/admin/proof-requests/${r.id}`,
                    ),
                ),
            );

            const enriched = baseRows.map((row, idx) => {
                const it = detailResults[idx];
                if (it.status !== "fulfilled" || !it.value?.request) return row;

                const d = it.value.request;
                return {
                    ...row,
                    submitted_at: d.submitted_at ?? null,
                    holder_did: d.holder_did ?? null,
                    vp_hash: d.vp_hash ?? null,
                    result: d.result ?? null,
                    error: d.error ?? null,
                };
            });

            setRows(enriched);
        } catch (e: any) {
            setErr(e?.message || "Could not load verifications");
        } finally {
            setLoading(false);
            setHydrating(false);
        }
    }, []);

    React.useEffect(() => {
        loadRows();
    }, [loadRows]);

    const openDetail = React.useCallback(async (id: string) => {
        setSelectedId(id);
        setDetailOpen(true);
        setDetailLoading(true);
        setSelected(null);

        try {
            const res = await api<{ ok: boolean; request: VerificationDetail }>(
                `/admin/proof-requests/${id}`,
            );
            setSelected(res.request);
        } catch (e: any) {
            setErr(e?.message || "Could not load verification details");
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const copy = React.useCallback(async (value?: string | null) => {
        const v = String(value || "").trim();
        if (!v) return;
        await navigator.clipboard.writeText(v);
    }, []);

    const filteredRows = React.useMemo(() => {
        const q = search.trim().toLowerCase();

        return rows.filter((r) => {
            if (statusFilter !== "all" && r.status !== statusFilter) {
                return false;
            }

            if (!q) return true;

            const hay =
                `${r.id} ${r.policy} ${r.requester_id || ""} ${r.holder_did || ""} ${r.result || ""} ${r.error || ""}`
                    .toLowerCase();

            return hay.includes(q);
        });
    }, [rows, search, statusFilter]);

    const metrics = React.useMemo(() => {
        return {
            total: rows.length,
            open: rows.filter((x) => x.status === "open").length,
            closed: rows.filter((x) => x.status === "closed").length,
            expired: rows.filter((x) => x.status === "expired").length,
            accepted: rows.filter((x) => x.result === "accepted").length,
            rejected: rows.filter((x) => x.result === "rejected").length,
        };
    }, [rows]);

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
                        Verifications
                    </Typography>
                    <Typography color="text.secondary">
                        Proof requests, verification results and submitted presentations
                    </Typography>
                </Box>

                <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button variant="outlined" onClick={loadRows} disabled={loading || hydrating}>
                        {loading || hydrating ? "Refreshing..." : "Refresh"}
                    </Button>
                </Stack>
            </Stack>

            {err ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {err}
                </Alert>
            ) : null}

            <Stack direction={{ xs: "column", md: "row" }} spacing={2} mb={2}>
                <MetricCard label="Total requests" value={metrics.total} />
                <MetricCard label="Open" value={metrics.open} />
                <MetricCard label="Closed" value={metrics.closed} />
                <MetricCard label="Expired" value={metrics.expired} />
                <MetricCard label="Accepted" value={metrics.accepted} />
                <MetricCard label="Rejected" value={metrics.rejected} />
            </Stack>

            <Card sx={{ mb: 2 }}>
                <CardContent>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <TextField
                            label="Search"
                            placeholder="request id, policy, holder DID, result..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            fullWidth
                        />

                        <TextField
                            select
                            label="Status"
                            value={statusFilter}
                            onChange={(e) =>
                                setStatusFilter(
                                    e.target.value as "all" | "open" | "closed" | "expired",
                                )
                            }
                            sx={{ minWidth: 180 }}
                        >
                            <MenuItem value="all">All</MenuItem>
                            <MenuItem value="open">Open</MenuItem>
                            <MenuItem value="closed">Closed</MenuItem>
                            <MenuItem value="expired">Expired</MenuItem>
                        </TextField>
                    </Stack>

                    {hydrating ? (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
                            Loading extended verification details...
                        </Typography>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="h6" fontWeight={800}>
                            Verification inbox
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {filteredRows.length} items
                        </Typography>
                    </Stack>

                    <Stack spacing={1}>
                        {loading ? (
                            <Typography color="text.secondary">Loading...</Typography>
                        ) : null}

                        {!loading && filteredRows.length === 0 ? (
                            <Typography color="text.secondary">No verification requests found.</Typography>
                        ) : null}

                        {!loading &&
                            filteredRows.map((r) => (
                                <Box
                                    key={r.id}
                                    sx={{
                                        p: 1.5,
                                        border: "1px solid",
                                        borderColor: "divider",
                                        borderRadius: 2,
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 2,
                                        cursor: "pointer",
                                    }}
                                    onClick={() => openDetail(r.id)}
                                >
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                        <Stack
                                            direction="row"
                                            spacing={1}
                                            alignItems="center"
                                            flexWrap="wrap"
                                            mb={0.5}
                                        >
                                            <Typography fontWeight={800} variant="body2">
                                                #{r.id}
                                            </Typography>

                                            <Chip
                                                size="small"
                                                label={String(r.status).toUpperCase()}
                                                color={statusColor(r.status) as any}
                                                variant="outlined"
                                            />

                                            {r.result ? (
                                                <Chip
                                                    size="small"
                                                    label={String(r.result).toUpperCase()}
                                                    color={resultColor(r.result) as any}
                                                    variant="outlined"
                                                />
                                            ) : null}
                                        </Stack>

                                        <Typography variant="body2" fontWeight={700}>
                                            {r.policy}
                                        </Typography>

                                        <Typography variant="caption" color="text.secondary" display="block">
                                            Created: {fmt(r.created_at)} · Expires: {fmt(r.expires_at)}
                                        </Typography>

                                        <Typography variant="caption" color="text.secondary" display="block">
                                            Holder: {short(r.holder_did)}
                                        </Typography>

                                        {r.submitted_at ? (
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                Submitted: {fmt(r.submitted_at)}
                                            </Typography>
                                        ) : null}

                                        {r.error ? (
                                            <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                                                Error: {r.error}
                                            </Typography>
                                        ) : null}
                                    </Box>

                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openDetail(r.id);
                                        }}
                                    >
                                        Details
                                    </Button>
                                </Box>
                            ))}
                    </Stack>
                </CardContent>
            </Card>

            <Dialog
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                fullWidth
                maxWidth="md"
            >
                <DialogTitle>
                    Verification {selectedId ? `#${selectedId}` : ""}
                </DialogTitle>

                <DialogContent dividers>
                    {detailLoading ? (
                        <Typography color="text.secondary">Loading details...</Typography>
                    ) : selected ? (
                        <Stack spacing={2}>
                            <Box>
                                <Typography variant="overline" color="text.secondary">
                                    Request
                                </Typography>

                                <Stack spacing={0.5}>
                                    <Typography variant="body2">
                                        Status: <b>{selected.status}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Policy: <b>{selected.policy}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Requester: <b>{selected.requester_id || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Created: <b>{fmt(selected.created_at)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Expires: <b>{fmt(selected.expires_at)}</b>
                                    </Typography>
                                </Stack>
                            </Box>

                            <Divider />

                            <Box>
                                <Typography variant="overline" color="text.secondary">
                                    Submission
                                </Typography>

                                <Stack spacing={0.5}>
                                    <Typography variant="body2">
                                        Result: <b>{selected.result || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Holder DID: <b>{selected.holder_did || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Submitted: <b>{fmt(selected.submitted_at)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        VP hash: <b>{selected.vp_hash || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Error: <b>{selected.error || "-"}</b>
                                    </Typography>
                                </Stack>
                            </Box>

                            <Divider />

                            <TextField
                                label="Nonce"
                                value={selected.nonce || ""}
                                fullWidth
                                InputProps={{ readOnly: true }}
                            />

                            <TextField
                                label="Constraints"
                                value={pretty(selected.constraints)}
                                fullWidth
                                multiline
                                minRows={8}
                                InputProps={{ readOnly: true } as any}
                            />
                        </Stack>
                    ) : (
                        <Typography color="text.secondary">No data.</Typography>
                    )}
                </DialogContent>

                <DialogActions>
                    <Button onClick={() => copy(selected?.id)}>Copy request ID</Button>
                    <Button onClick={() => copy(selected?.holder_did)}>Copy holder DID</Button>
                    <Button onClick={() => copy(selected?.vp_hash)}>Copy VP hash</Button>
                    <Button onClick={() => setDetailOpen(false)} variant="contained">
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

function MetricCard({ label, value }: { label: string; value: number }) {
    return (
        <Card sx={{ flex: 1 }}>
            <CardContent>
                <Typography variant="overline" color="text.secondary">
                    {label}
                </Typography>
                <Typography variant="h5" fontWeight={800} mt={0.5}>
                    {value}
                </Typography>
            </CardContent>
        </Card>
    );
}