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

type IssuedRow = {
    id: number;
    created_at: string;
    admin_email: string | null;
    issuer_did: string;
    subject_did: string;
    vc_type: string;
    vc_hash: string;
    issuance_date: string;
    expiration_date: string | null;
};

type IssuedDetail = IssuedRow & {
    claims: any;
    vc_jwt: string | null;
};

type ProofListRow = {
    id: string;
    status: "open" | "closed" | "expired" | string;
    policy: string;
    requester_id: string | null;
    expires_at: string;
    created_at: string;
};

type ProofDetail = {
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

type AuditKind = "issuance" | "verification";

type AuditItem =
    | {
        auditKind: "issuance";
        id: string;
        sortAt: number;
        createdAt: string;
        title: string;
        subtitle: string;
        chip: string;
        chipColor: "success" | "default";
        raw: IssuedRow;
    }
    | {
        auditKind: "verification";
        id: string;
        sortAt: number;
        createdAt: string;
        title: string;
        subtitle: string;
        chip: string;
        chipColor: "success" | "error" | "warning" | "default";
        raw: ProofDetail;
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

export default function Page() {
    const [items, setItems] = React.useState<AuditItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [err, setErr] = React.useState("");

    const [kindFilter, setKindFilter] = React.useState<"all" | AuditKind>("all");
    const [resultFilter, setResultFilter] = React.useState<
        "all" | "accepted" | "rejected" | "expired"
    >("all");
    const [search, setSearch] = React.useState("");

    const [detailOpen, setDetailOpen] = React.useState(false);
    const [detailLoading, setDetailLoading] = React.useState(false);
    const [selectedKind, setSelectedKind] = React.useState<AuditKind | null>(null);
    const [issuedDetail, setIssuedDetail] = React.useState<IssuedDetail | null>(null);
    const [proofDetail, setProofDetail] = React.useState<ProofDetail | null>(null);

    const loadAudit = React.useCallback(async () => {
        setErr("");
        setLoading(true);

        try {
            const [issuedRes, proofsRes] = await Promise.all([
                api<{ ok: boolean; items: IssuedRow[] }>("/admin/vc/issued?limit=100"),
                api<{ ok: boolean; items: ProofListRow[] }>(
                    "/admin/proof-requests?status=all&limit=100",
                ),
            ]);

            const issuedItems: AuditItem[] = (issuedRes.items || []).map((r) => ({
                auditKind: "issuance",
                id: `issuance:${r.id}`,
                sortAt: Date.parse(String(r.created_at)) || 0,
                createdAt: String(r.created_at),
                title: `VC issued · ${r.vc_type}`,
                subtitle: `Subject ${short(r.subject_did)} · hash ${short(r.vc_hash, 10, 6)}`,
                chip: "ISSUED",
                chipColor: "success",
                raw: r,
            }));

            const proofBaseRows = proofsRes.items || [];

            const proofDetailsResults = await Promise.allSettled(
                proofBaseRows.map((r) =>
                    api<{ ok: boolean; request: ProofDetail }>(
                        `/admin/proof-requests/${r.id}`,
                    ),
                ),
            );

            const proofItems: AuditItem[] = proofBaseRows.map((row, idx) => {
                const detail =
                    proofDetailsResults[idx].status === "fulfilled"
                        ? proofDetailsResults[idx].value.request
                        : null;

                const result = detail?.result || null;
                const effectiveTime =
                    detail?.submitted_at || detail?.created_at || row.created_at;

                let chip = row.status.toUpperCase();
                let chipColor: "success" | "error" | "warning" | "default" =
                    "default";

                if (result === "accepted") {
                    chip = "ACCEPTED";
                    chipColor = "success";
                } else if (result === "rejected") {
                    chip = "REJECTED";
                    chipColor = "error";
                } else if (row.status === "expired") {
                    chip = "EXPIRED";
                    chipColor = "warning";
                }

                return {
                    auditKind: "verification",
                    id: `verification:${row.id}`,
                    sortAt: Date.parse(String(effectiveTime)) || 0,
                    createdAt: String(effectiveTime),
                    title: `Proof verification · ${row.policy}`,
                    subtitle: `Holder ${short(detail?.holder_did)}${detail?.vp_hash ? ` · VP ${short(detail.vp_hash, 10, 6)}` : ""}`,
                    chip,
                    chipColor,
                    raw: detail || {
                        id: row.id,
                        status: row.status,
                        policy: row.policy,
                        requester_id: row.requester_id,
                        expires_at: row.expires_at,
                        created_at: row.created_at,
                        nonce: "",
                        constraints: {},
                    },
                };
            });

            const merged = [...issuedItems, ...proofItems].sort(
                (a, b) => b.sortAt - a.sortAt,
            );

            setItems(merged);
        } catch (e: any) {
            setErr(e?.message || "Could not load audit data");
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        loadAudit();
    }, [loadAudit]);

    const openItem = React.useCallback(async (item: AuditItem) => {
        setDetailOpen(true);
        setDetailLoading(true);
        setSelectedKind(item.auditKind);
        setIssuedDetail(null);
        setProofDetail(null);

        try {
            if (item.auditKind === "issuance") {
                const id = item.raw.id;
                const res = await api<{ ok: boolean; item: IssuedDetail }>(
                    `/admin/vc/issued/${id}`,
                );
                setIssuedDetail(res.item);
            } else {
                const id = item.raw.id;
                const res = await api<{ ok: boolean; request: ProofDetail }>(
                    `/admin/proof-requests/${id}`,
                );
                setProofDetail(res.request);
            }
        } catch (e: any) {
            setErr(e?.message || "Could not load audit details");
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const copy = React.useCallback(async (value?: string | number | null) => {
        const v = String(value ?? "").trim();
        if (!v) return;
        await navigator.clipboard.writeText(v);
    }, []);

    const filteredItems = React.useMemo(() => {
        const q = search.trim().toLowerCase();

        return items.filter((item) => {
            if (kindFilter !== "all" && item.auditKind !== kindFilter) {
                return false;
            }

            if (resultFilter !== "all") {
                if (item.auditKind === "issuance") {
                    return false;
                }

                if (resultFilter === "accepted" && item.raw.result !== "accepted") {
                    return false;
                }

                if (resultFilter === "rejected" && item.raw.result !== "rejected") {
                    return false;
                }

                if (resultFilter === "expired" && item.raw.status !== "expired") {
                    return false;
                }
            }

            if (!q) return true;

            const hay =
                `${item.title} ${item.subtitle} ${item.auditKind} ${item.auditKind === "issuance"
                    ? `${item.raw.subject_did} ${item.raw.vc_type} ${item.raw.vc_hash}`
                    : `${item.raw.policy} ${item.raw.holder_did || ""} ${item.raw.vp_hash || ""} ${item.raw.result || ""} ${item.raw.error || ""}`
                    }`.toLowerCase();

            return hay.includes(q);
        });
    }, [items, kindFilter, resultFilter, search]);

    const metrics = React.useMemo(() => {
        const issuances = items.filter((x) => x.auditKind === "issuance").length;
        const verifications = items.filter((x) => x.auditKind === "verification").length;
        const accepted = items.filter(
            (x) => x.auditKind === "verification" && x.raw.result === "accepted",
        ).length;
        const rejected = items.filter(
            (x) => x.auditKind === "verification" && x.raw.result === "rejected",
        ).length;

        return {
            total: items.length,
            issuances,
            verifications,
            accepted,
            rejected,
        };
    }, [items]);

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
                        Audit
                    </Typography>
                    <Typography color="text.secondary">
                        Unified history of VC issuance and proof verification activity
                    </Typography>
                </Box>

                <Button variant="outlined" onClick={loadAudit} disabled={loading}>
                    {loading ? "Refreshing..." : "Refresh"}
                </Button>
            </Stack>

            {err ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {err}
                </Alert>
            ) : null}

            <Stack direction={{ xs: "column", md: "row" }} spacing={2} mb={2}>
                <MetricCard label="Total events" value={metrics.total} />
                <MetricCard label="VC issuances" value={metrics.issuances} />
                <MetricCard label="Verifications" value={metrics.verifications} />
                <MetricCard label="Accepted proofs" value={metrics.accepted} />
                <MetricCard label="Rejected proofs" value={metrics.rejected} />
            </Stack>

            <Card sx={{ mb: 2 }}>
                <CardContent>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <TextField
                            label="Search"
                            placeholder="policy, DID, hash, VC type..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            fullWidth
                        />

                        <TextField
                            select
                            label="Kind"
                            value={kindFilter}
                            onChange={(e) =>
                                setKindFilter(e.target.value as "all" | AuditKind)
                            }
                            sx={{ minWidth: 180 }}
                        >
                            <MenuItem value="all">All</MenuItem>
                            <MenuItem value="issuance">VC issuances</MenuItem>
                            <MenuItem value="verification">Verifications</MenuItem>
                        </TextField>

                        <TextField
                            select
                            label="Result"
                            value={resultFilter}
                            onChange={(e) =>
                                setResultFilter(
                                    e.target.value as "all" | "accepted" | "rejected" | "expired",
                                )
                            }
                            sx={{ minWidth: 180 }}
                        >
                            <MenuItem value="all">All</MenuItem>
                            <MenuItem value="accepted">Accepted</MenuItem>
                            <MenuItem value="rejected">Rejected</MenuItem>
                            <MenuItem value="expired">Expired</MenuItem>
                        </TextField>
                    </Stack>
                </CardContent>
            </Card>

            <Card>
                <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="h6" fontWeight={800}>
                            Audit timeline
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {filteredItems.length} items
                        </Typography>
                    </Stack>

                    <Stack spacing={1}>
                        {loading ? (
                            <Typography color="text.secondary">Loading...</Typography>
                        ) : null}

                        {!loading && filteredItems.length === 0 ? (
                            <Typography color="text.secondary">No audit entries found.</Typography>
                        ) : null}

                        {!loading &&
                            filteredItems.map((item) => (
                                <Box
                                    key={item.id}
                                    sx={{
                                        p: 1.5,
                                        border: "1px solid",
                                        borderColor: "divider",
                                        borderRadius: 2,
                                        bgcolor: "background.paper",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 2,
                                        cursor: "pointer",
                                    }}
                                    onClick={() => openItem(item)}
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
                                                {item.title}
                                            </Typography>

                                            <Chip
                                                size="small"
                                                label={item.chip}
                                                color={item.chipColor as any}
                                                variant="outlined"
                                            />

                                            <Chip
                                                size="small"
                                                label={item.auditKind === "issuance" ? "VC" : "PROOF"}
                                                variant="outlined"
                                            />
                                        </Stack>

                                        <Typography variant="body2" color="text.secondary">
                                            {item.subtitle}
                                        </Typography>

                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                                            {fmt(item.createdAt)}
                                        </Typography>

                                        {item.auditKind === "verification" && item.raw.error ? (
                                            <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                                                Error: {item.raw.error}
                                            </Typography>
                                        ) : null}
                                    </Box>

                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openItem(item);
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
                    {selectedKind === "issuance" ? "Issued VC details" : "Verification details"}
                </DialogTitle>

                <DialogContent dividers>
                    {detailLoading ? (
                        <Typography color="text.secondary">Loading details...</Typography>
                    ) : null}

                    {!detailLoading && selectedKind === "issuance" && issuedDetail ? (
                        <Stack spacing={2}>
                            <Box>
                                <Typography variant="overline" color="text.secondary">
                                    Issuance metadata
                                </Typography>

                                <Stack spacing={0.5}>
                                    <Typography variant="body2">
                                        VC type: <b>{issuedDetail.vc_type}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Subject DID: <b>{issuedDetail.subject_did}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Issuer DID: <b>{issuedDetail.issuer_did}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Admin email: <b>{issuedDetail.admin_email || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Created: <b>{fmt(issuedDetail.created_at)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Issuance date: <b>{fmt(issuedDetail.issuance_date)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Expiration date: <b>{fmt(issuedDetail.expiration_date)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        VC hash: <b>{issuedDetail.vc_hash}</b>
                                    </Typography>
                                </Stack>
                            </Box>

                            <Divider />

                            <TextField
                                label="Claims"
                                value={pretty(issuedDetail.claims)}
                                fullWidth
                                multiline
                                minRows={8}
                                InputProps={{ readOnly: true } as any}
                            />

                            <TextField
                                label="VC JWT"
                                value={issuedDetail.vc_jwt || ""}
                                fullWidth
                                multiline
                                minRows={6}
                                InputProps={{ readOnly: true } as any}
                            />
                        </Stack>
                    ) : null}

                    {!detailLoading && selectedKind === "verification" && proofDetail ? (
                        <Stack spacing={2}>
                            <Box>
                                <Typography variant="overline" color="text.secondary">
                                    Verification metadata
                                </Typography>

                                <Stack spacing={0.5}>
                                    <Typography variant="body2">
                                        Policy: <b>{proofDetail.policy}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Status: <b>{proofDetail.status}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Result: <b>{proofDetail.result || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Holder DID: <b>{proofDetail.holder_did || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Created: <b>{fmt(proofDetail.created_at)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Submitted: <b>{fmt(proofDetail.submitted_at)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Expires: <b>{fmt(proofDetail.expires_at)}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        VP hash: <b>{proofDetail.vp_hash || "-"}</b>
                                    </Typography>
                                    <Typography variant="body2">
                                        Error: <b>{proofDetail.error || "-"}</b>
                                    </Typography>
                                </Stack>
                            </Box>

                            <Divider />

                            <TextField
                                label="Nonce"
                                value={proofDetail.nonce || ""}
                                fullWidth
                                InputProps={{ readOnly: true }}
                            />

                            <TextField
                                label="Constraints"
                                value={pretty(proofDetail.constraints)}
                                fullWidth
                                multiline
                                minRows={8}
                                InputProps={{ readOnly: true } as any}
                            />
                        </Stack>
                    ) : null}
                </DialogContent>

                <DialogActions>
                    {selectedKind === "issuance" ? (
                        <>
                            <Button onClick={() => copy(issuedDetail?.subject_did)}>
                                Copy subject DID
                            </Button>
                            <Button onClick={() => copy(issuedDetail?.vc_hash)}>
                                Copy VC hash
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button onClick={() => copy(proofDetail?.holder_did)}>
                                Copy holder DID
                            </Button>
                            <Button onClick={() => copy(proofDetail?.vp_hash)}>
                                Copy VP hash
                            </Button>
                        </>
                    )}

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