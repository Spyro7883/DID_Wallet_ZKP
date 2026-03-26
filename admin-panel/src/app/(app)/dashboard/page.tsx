"use client";

import * as React from "react";
import Link from "next/link";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Divider,
    Stack,
    Typography,
} from "@mui/material";
import { api } from "@/lib/api";

type IssuerActive = {
    did: string;
    alias: string | null;
    provider: string;
    createdAt: string | null;
    keys: Array<{
        kid: string;
        type: string;
        publicKeyHex: string | null;
    }>;
};

type IssuerResponse = {
    ok: boolean;
    activeDid: string;
    active: IssuerActive | null;
    all: IssuerActive[];
};

type PendingVcRequestRow = {
    id: number;
    status: "pending" | "approved" | "rejected";
    holder_did: string;
    subject_did: string;
    vc_type: string;
    created_at: string;
    decided_at?: string | null;
    decided_by?: string | null;
    issued_vc_hash?: string | null;
};

type IssuedVcRow = {
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

type ProofRequestRow = {
    id: string;
    status: "open" | "closed" | "expired" | string;
    policy: string;
    requester_id: string | null;
    expires_at: string;
    created_at: string;
};

type HealthResponse = {
    status: string;
    timestamp: string;
    activeTokens?: number;
};

type MeResponse = {
    ok: boolean;
    admin: {
        sub: string;
        email: string;
        role: string;
        iat?: number;
        exp?: number;
    };
};

type ActivityItem = {
    id: string;
    kind: "vc" | "proof";
    title: string;
    subtitle: string;
    at: string;
    href: string;
};

function short(v: string, left = 16, right = 10) {
    const s = String(v || "");
    if (!s) return "-";
    if (s.length <= left + right + 3) return s;
    return `${s.slice(0, left)}...${s.slice(-right)}`;
}

function fmtDateTime(v?: string | null) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
}

function countLabel(n: number, limit: number) {
    return n >= limit ? `${limit}+` : String(n);
}

function StatCard({
    label,
    value,
    hint,
}: {
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
}) {
    return (
        <Card>
            <CardContent>
                <Typography variant="overline" color="text.secondary">
                    {label}
                </Typography>
                <Typography variant="h4" fontWeight={800} mt={0.5}>
                    {value}
                </Typography>
                {hint ? (
                    <Typography variant="body2" color="text.secondary" mt={1}>
                        {hint}
                    </Typography>
                ) : null}
            </CardContent>
        </Card>
    );
}

export default function Page() {
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [err, setErr] = React.useState("");

    const [issuer, setIssuer] = React.useState<IssuerResponse | null>(null);
    const [me, setMe] = React.useState<MeResponse["admin"] | null>(null);
    const [health, setHealth] = React.useState<HealthResponse | null>(null);

    const [pendingVcRequests, setPendingVcRequests] = React.useState<PendingVcRequestRow[]>([]);
    const [openProofRequests, setOpenProofRequests] = React.useState<ProofRequestRow[]>([]);
    const [recentIssued, setRecentIssued] = React.useState<IssuedVcRow[]>([]);
    const [recentProofs, setRecentProofs] = React.useState<ProofRequestRow[]>([]);

    const load = React.useCallback(async (silent = false) => {
        if (silent) setRefreshing(true);
        else setLoading(true);

        setErr("");

        const VC_PENDING_LIMIT = 100;
        const PROOF_OPEN_LIMIT = 100;
        const RECENT_ISSUED_LIMIT = 10;
        const RECENT_PROOFS_LIMIT = 10;

        try {
            const [
                issuerRes,
                meRes,
                healthRes,
                pendingVcRes,
                openProofsRes,
                recentIssuedRes,
                recentProofsRes,
            ] = await Promise.allSettled([
                api<IssuerResponse>("/admin/issuer"),
                api<MeResponse>("/admin/me"),
                api<HealthResponse>("/health"),
                api<{ ok: boolean; items: PendingVcRequestRow[] }>(
                    `/admin/vc/requests?status=pending&limit=${VC_PENDING_LIMIT}`,
                ),
                api<{ ok: boolean; items: ProofRequestRow[] }>(
                    `/admin/proof-requests?status=open&limit=${PROOF_OPEN_LIMIT}`,
                ),
                api<{ ok: boolean; items: IssuedVcRow[] }>(
                    `/admin/vc/issued?limit=${RECENT_ISSUED_LIMIT}`,
                ),
                api<{ ok: boolean; items: ProofRequestRow[] }>(
                    `/admin/proof-requests?status=all&limit=${RECENT_PROOFS_LIMIT}`,
                ),
            ]);

            if (issuerRes.status === "fulfilled") setIssuer(issuerRes.value);
            else setIssuer(null);

            if (meRes.status === "fulfilled") setMe(meRes.value.admin);
            else setMe(null);

            if (healthRes.status === "fulfilled") setHealth(healthRes.value);
            else setHealth(null);

            if (pendingVcRes.status === "fulfilled") setPendingVcRequests(pendingVcRes.value.items || []);
            else setPendingVcRequests([]);

            if (openProofsRes.status === "fulfilled") setOpenProofRequests(openProofsRes.value.items || []);
            else setOpenProofRequests([]);

            if (recentIssuedRes.status === "fulfilled") setRecentIssued(recentIssuedRes.value.items || []);
            else setRecentIssued([]);

            if (recentProofsRes.status === "fulfilled") setRecentProofs(recentProofsRes.value.items || []);
            else setRecentProofs([]);

            const failedCount = [
                issuerRes,
                meRes,
                healthRes,
                pendingVcRes,
                openProofsRes,
                recentIssuedRes,
                recentProofsRes,
            ].filter((x) => x.status === "rejected").length;

            if (failedCount > 0) {
                setErr(`Some dashboard sections could not be loaded (${failedCount}).`);
            }
        } catch (e: any) {
            setErr(e?.message || "Could not load dashboard");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    React.useEffect(() => {
        void load(false);
    }, [load]);

    const recentActivity = React.useMemo<ActivityItem[]>(() => {
        const vcActivity: ActivityItem[] = recentIssued.map((x) => ({
            id: `vc-${x.id}`,
            kind: "vc",
            title: `VC issued · ${x.vc_type}`,
            subtitle: `Subject ${short(x.subject_did, 18, 10)}`,
            at: x.created_at || x.issuance_date,
            href: "/issue-vc",
        }));

        const proofActivity: ActivityItem[] = recentProofs.map((x) => ({
            id: `proof-${x.id}`,
            kind: "proof",
            title: `Proof request · ${String(x.status).toUpperCase()}`,
            subtitle: `${x.policy}${x.requester_id ? ` · ${x.requester_id}` : ""}`,
            at: x.created_at,
            href: "/verifications",
        }));

        return [...vcActivity, ...proofActivity]
            .sort((a, b) => {
                const ta = Date.parse(a.at || "");
                const tb = Date.parse(b.at || "");
                return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
            })
            .slice(0, 8);
    }, [recentIssued, recentProofs]);

    const issuedToday = React.useMemo(() => {
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth();
        const d = today.getDate();

        return recentIssued.filter((x) => {
            const t = new Date(x.created_at || x.issuance_date);
            return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
        }).length;
    }, [recentIssued]);

    const alerts = React.useMemo(() => {
        const out: Array<{ severity: "warning" | "info" | "error"; text: string }> = [];

        if (!health || health.status !== "ok") {
            out.push({
                severity: "error",
                text: "Backend health endpoint is not returning ok.",
            });
        }

        if (!issuer?.activeDid) {
            out.push({
                severity: "warning",
                text: "No active issuer DID found.",
            });
        }

        if (pendingVcRequests.length > 0) {
            out.push({
                severity: "info",
                text: `${countLabel(pendingVcRequests.length, 100)} pending VC requests need review.`,
            });
        }

        if (openProofRequests.length > 0) {
            out.push({
                severity: "info",
                text: `${countLabel(openProofRequests.length, 100)} open proof requests are currently active.`,
            });
        }

        return out;
    }, [health, issuer, pendingVcRequests, openProofRequests]);

    if (loading) {
        return (
            <Box sx={{ minHeight: 320, display: "grid", placeItems: "center" }}>
                <Stack spacing={2} alignItems="center">
                    <CircularProgress />
                    <Typography color="text.secondary">Loading dashboard...</Typography>
                </Stack>
            </Box>
        );
    }

    return (
        <Box>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                gap={2}
                flexWrap="wrap"
                mb={2}
            >
                <Box>
                    <Typography variant="h4" fontWeight={800}>
                        Dashboard
                    </Typography>
                    <Typography color="text.secondary">
                        Overview of issuer / verifier activity
                    </Typography>
                </Box>

                <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button variant="outlined" onClick={() => void load(true)} disabled={refreshing}>
                        {refreshing ? "Refreshing..." : "Refresh"}
                    </Button>

                    <Button component={Link} href="/requests" variant="contained">
                        Review requests
                    </Button>
                </Stack>
            </Stack>

            {err ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {err}
                </Alert>
            ) : null}

            <Box
                sx={{
                    display: "grid",
                    gridTemplateColumns: {
                        xs: "1fr",
                        sm: "repeat(2, minmax(0, 1fr))",
                        xl: "repeat(5, minmax(0, 1fr))",
                    },
                    gap: 2,
                    mb: 2,
                }}
            >
                <StatCard
                    label="Pending VC requests"
                    value={countLabel(pendingVcRequests.length, 100)}
                    hint="Needs admin approval"
                />
                <StatCard
                    label="Open proof requests"
                    value={countLabel(openProofRequests.length, 100)}
                    hint="Verifier flow still active"
                />
                <StatCard
                    label="Recently issued"
                    value={recentIssued.length}
                    hint="Based on latest issued list"
                />
                <StatCard
                    label="Issued today"
                    value={issuedToday}
                    hint="From recent issued entries"
                />
                <StatCard
                    label="Backend health"
                    value={
                        <Chip
                            label={health?.status === "ok" ? "OK" : "DOWN"}
                            color={health?.status === "ok" ? "success" : "error"}
                            variant="outlined"
                        />
                    }
                    hint={health?.timestamp ? fmtDateTime(health.timestamp) : "No timestamp"}
                />
            </Box>

            <Box
                sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", lg: "1.2fr 0.8fr" },
                    gap: 2,
                    mb: 2,
                }}
            >
                <Card>
                    <CardContent>
                        <Typography variant="overline" color="text.secondary">
                            Quick actions
                        </Typography>
                        <Typography variant="h6" fontWeight={800} mt={0.5} mb={2}>
                            Go to main flows
                        </Typography>

                        <Stack direction="row" gap={1} flexWrap="wrap">
                            <Button component={Link} href="/issue-vc" variant="contained">
                                Issue VC
                            </Button>
                            <Button component={Link} href="/requests" variant="outlined">
                                Requests
                            </Button>
                            <Button component={Link} href="/verifications" variant="outlined">
                                Verifications
                            </Button>
                            <Button component={Link} href="/dids" variant="outlined">
                                DIDs
                            </Button>
                            <Button component={Link} href="/audit" variant="outlined">
                                Audit
                            </Button>
                        </Stack>

                        <Divider sx={{ my: 2 }} />

                        <Typography variant="body2" color="text.secondary">
                            Use dashboard for monitoring and jump to dedicated pages for actions.
                        </Typography>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent>
                        <Typography variant="overline" color="text.secondary">
                            Admin session
                        </Typography>
                        <Typography variant="h6" fontWeight={800} mt={0.5} mb={2}>
                            Signed in admin
                        </Typography>

                        <Stack spacing={1}>
                            <Typography variant="body2">
                                <b>Email:</b> {me?.email || "-"}
                            </Typography>
                            <Typography variant="body2">
                                <b>Role:</b> {me?.role || "-"}
                            </Typography>
                            <Typography variant="body2">
                                <b>Issuer DID:</b> {issuer?.activeDid ? short(issuer.activeDid, 24, 12) : "-"}
                            </Typography>
                        </Stack>
                    </CardContent>
                </Card>
            </Box>

            <Box
                sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
                    gap: 2,
                    mb: 2,
                }}
            >
                <Card>
                    <CardContent>
                        <Typography variant="overline" color="text.secondary">
                            Recent activity
                        </Typography>
                        <Typography variant="h6" fontWeight={800} mt={0.5} mb={2}>
                            Latest items
                        </Typography>

                        <Stack spacing={1}>
                            {recentActivity.map((x) => (
                                <Box
                                    key={x.id}
                                    sx={{
                                        p: 1.25,
                                        borderRadius: 2,
                                        border: "1px solid",
                                        borderColor: "divider",
                                        bgcolor: "background.paper",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 2,
                                    }}
                                >
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography fontWeight={700} variant="body2">
                                            {x.title}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {x.subtitle}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            display="block"
                                        >
                                            {fmtDateTime(x.at)}
                                        </Typography>
                                    </Box>

                                    <Chip
                                        size="small"
                                        label={x.kind === "vc" ? "VC" : "PROOF"}
                                        color={x.kind === "vc" ? "primary" : "secondary"}
                                        variant="outlined"
                                        component={Link}
                                        href={x.href}
                                        clickable
                                    />
                                </Box>
                            ))}

                            {recentActivity.length === 0 ? (
                                <Typography color="text.secondary">
                                    No recent activity available.
                                </Typography>
                            ) : null}
                        </Stack>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent>
                        <Typography variant="overline" color="text.secondary">
                            Active issuer
                        </Typography>
                        <Typography variant="h6" fontWeight={800} mt={0.5} mb={2}>
                            Issuer details
                        </Typography>

                        <Stack spacing={1}>
                            <Typography variant="body2">
                                <b>DID:</b> {issuer?.activeDid || "-"}
                            </Typography>
                            <Typography variant="body2">
                                <b>Alias:</b> {issuer?.active?.alias || "-"}
                            </Typography>
                            <Typography variant="body2">
                                <b>Provider:</b> {issuer?.active?.provider || "-"}
                            </Typography>
                            <Typography variant="body2">
                                <b>Created:</b> {fmtDateTime(issuer?.active?.createdAt)}
                            </Typography>
                            <Typography variant="body2">
                                <b>Keys:</b> {issuer?.active?.keys?.length ?? 0}
                            </Typography>
                        </Stack>

                        <Stack direction="row" gap={1} mt={2} flexWrap="wrap">
                            <Button component={Link} href="/dids" variant="outlined">
                                Manage DIDs
                            </Button>
                            <Button component={Link} href="/issue-vc" variant="outlined">
                                Open VC admin
                            </Button>
                        </Stack>
                    </CardContent>
                </Card>
            </Box>

            <Card>
                <CardContent>
                    <Typography variant="overline" color="text.secondary">
                        Attention
                    </Typography>
                    <Typography variant="h6" fontWeight={800} mt={0.5} mb={2}>
                        Current alerts
                    </Typography>

                    <Stack spacing={1}>
                        {alerts.length ? (
                            alerts.map((a, idx) => (
                                <Alert key={idx} severity={a.severity}>
                                    {a.text}
                                </Alert>
                            ))
                        ) : (
                            <Alert severity="success">No immediate issues detected.</Alert>
                        )}
                    </Stack>
                </CardContent>
            </Card>
        </Box>
    );
}