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

type RequestRow = {
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

type RequestDetail = RequestRow & {
    claims: any;
    preview_claims?: any;
    validity_days: number | null;
    decision_note?: string | null;
    issued_vc_jwt?: string | null;
};

function pretty(v: any) {
    try {
        return JSON.stringify(v ?? {}, null, 2);
    } catch {
        return String(v);
    }
}

export default function Page() {
    const [pending, setPending] = React.useState<RequestRow[]>([]);
    const [loadingPending, setLoadingPending] = React.useState(false);

    const [selected, setSelected] = React.useState<RequestDetail | null>(null);
    const [loadingSelected, setLoadingSelected] = React.useState(false);
    const [note, setNote] = React.useState("");
    const [approving, setApproving] = React.useState<number | null>(null);

    const [subjectDid, setSubjectDid] = React.useState("");
    const [vcType, setVcType] = React.useState("CitizenshipCredential");
    const [claimsText, setClaimsText] = React.useState(`{"citizenship":"RO"}`);
    const [validityDays, setValidityDays] = React.useState<string>("");

    const [issuing, setIssuing] = React.useState(false);
    const [err, setErr] = React.useState("");
    const [result, setResult] = React.useState<any>(null);

    const [recent, setRecent] = React.useState<IssuedRow[]>([]);
    const [loadingRecent, setLoadingRecent] = React.useState(true);

    async function loadPending() {
        setLoadingPending(true);
        try {
            const res = await api<{ ok: boolean; items: RequestRow[] }>(
                "/admin/vc/requests?status=pending&limit=50",
            );
            setPending(res.items || []);
        } finally {
            setLoadingPending(false);
        }
    }

    async function openRequest(id: number) {
        setLoadingSelected(true);
        try {
            const res = await api<{ ok: boolean; request: RequestDetail }>(
                `/admin/vc/requests/${id}`,
            );
            setSelected(res.request);
        } finally {
            setLoadingSelected(false);
        }
    }

    async function approveRequest(id: number) {
        setErr("");
        setApproving(id);
        try {
            await api(`/admin/vc/requests/${id}/approve`, {
                method: "POST",
                body: JSON.stringify({ note: note.trim() || undefined }),
            });

            setSelected(null);
            setNote("");
            await Promise.all([loadPending(), loadRecent()]);
        } catch (e: any) {
            setErr(e?.message || "Approve failed");
        } finally {
            setApproving(null);
        }
    }

    async function loadRecent() {
        setLoadingRecent(true);
        try {
            const res = await api<{ ok: boolean; items: IssuedRow[] }>(
                "/admin/vc/issued?limit=20",
            );
            setRecent(res.items || []);
        } finally {
            setLoadingRecent(false);
        }
    }

    React.useEffect(() => {
        loadPending();
        loadRecent();
    }, []);

    const onIssue = async () => {
        if (issuing) return;
        setErr("");
        setResult(null);

        let claimsObj: any;
        try {
            claimsObj = JSON.parse(claimsText || "{}");
            if (!claimsObj || typeof claimsObj !== "object" || Array.isArray(claimsObj)) {
                throw new Error("Claims must be a JSON object.");
            }
        } catch (e: any) {
            setErr(e?.message || "Invalid claims JSON");
            return;
        }

        setIssuing(true);
        try {
            const body: any = {
                subjectDid: subjectDid.trim(),
                type: vcType,
                claims: claimsObj,
            };
            if (validityDays.trim()) {
                body.validityDays = Number(validityDays.trim());
            }

            const res = await api("/admin/vc/issue", {
                method: "POST",
                body: JSON.stringify(body),
            });

            setResult(res);
            await loadRecent();
        } catch (e: any) {
            setErr(e?.message || "Issue failed");
        } finally {
            setIssuing(false);
        }
    };

    const copy = async (v: string) => navigator.clipboard.writeText(v);

    const downloadJson = (obj: any, filename: string) => {
        const blob = new Blob([JSON.stringify(obj, null, 2)], {
            type: "application/json",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const vcRaw = typeof result?.vc === "string" ? result.vc : pretty(result?.vc);

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
                        VC Admin
                    </Typography>
                    <Typography color="text.secondary">
                        Approve requests and issue credentials as the institution issuer DID
                    </Typography>
                </Box>

                <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button variant="outlined" onClick={loadPending} disabled={loadingPending}>
                        {loadingPending ? "Refreshing..." : "Refresh pending"}
                    </Button>
                    <Button variant="outlined" onClick={loadRecent} disabled={loadingRecent}>
                        {loadingRecent ? "Refreshing..." : "Refresh issued"}
                    </Button>
                </Stack>
            </Stack>

            {err ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {err}
                </Alert>
            ) : null}

            <Stack spacing={2}>
                <Card>
                    <CardContent>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                            <Typography variant="h6" fontWeight={800}>
                                Pending VC requests
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {pending.length} pending
                            </Typography>
                        </Stack>

                        <Stack spacing={1}>
                            {pending.map((r) => (
                                <Box
                                    key={r.id}
                                    sx={{
                                        p: 1.25,
                                        border: "1px solid",
                                        borderColor: "divider",
                                        borderRadius: 2,
                                        bgcolor: "background.paper",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 2,
                                        cursor: "pointer",
                                    }}
                                    onClick={() => openRequest(r.id)}
                                >
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography fontWeight={700} variant="body2">
                                            #{r.id} · {r.vc_type}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            holder {String(r.holder_did).slice(0, 22)}… ·{" "}
                                            {String(r.created_at).slice(0, 19)}
                                        </Typography>
                                    </Box>

                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openRequest(r.id);
                                        }}
                                    >
                                        Details
                                    </Button>
                                </Box>
                            ))}

                            {!loadingPending && pending.length === 0 ? (
                                <Typography color="text.secondary">No pending requests.</Typography>
                            ) : null}
                        </Stack>

                        {selected ? (
                            <>
                                <Divider sx={{ my: 2 }} />

                                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
                                    <Typography fontWeight={800}>Request #{selected.id}</Typography>
                                    <Button variant="outlined" onClick={() => setSelected(null)}>
                                        Close
                                    </Button>
                                </Stack>

                                <Stack spacing={0.5} sx={{ mt: 1 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        Status: <b>{selected.status}</b>
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Type: <b>{selected.vc_type}</b>
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Holder: <b>{selected.holder_did}</b>
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Subject: <b>{selected.subject_did}</b>
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Validity days: <b>{selected.validity_days ?? "-"}</b>
                                    </Typography>
                                </Stack>

                                <TextField
                                    label="Preview claims"
                                    value={pretty(selected.preview_claims)}
                                    fullWidth
                                    multiline
                                    minRows={4}
                                    InputProps={{ readOnly: true } as any}
                                    sx={{ mt: 2 }}
                                />

                                <TextField
                                    label="Claims"
                                    value={pretty(selected.claims)}
                                    fullWidth
                                    multiline
                                    minRows={6}
                                    InputProps={{ readOnly: true } as any}
                                    sx={{ mt: 2 }}
                                />

                                <TextField
                                    label="Decision note (optional)"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    fullWidth
                                    sx={{ mt: 2 }}
                                />

                                <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
                                    <Button
                                        variant="contained"
                                        onClick={() => approveRequest(selected.id)}
                                        disabled={approving === selected.id || loadingSelected}
                                    >
                                        {approving === selected.id ? "Approving..." : "Approve & Issue"}
                                    </Button>

                                    <Button
                                        variant="outlined"
                                        onClick={() => {
                                            copy(String(selected.holder_did));
                                        }}
                                    >
                                        Copy holder DID
                                    </Button>

                                    {selected.issued_vc_hash ? (
                                        <Button
                                            variant="outlined"
                                            onClick={() => copy(String(selected.issued_vc_hash))}
                                        >
                                            Copy issued hash
                                        </Button>
                                    ) : null}
                                </Stack>

                                {loadingSelected ? (
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                                        Loading details...
                                    </Typography>
                                ) : null}
                            </>
                        ) : null}
                    </CardContent>
                </Card>

                <Card>
                    <CardContent>
                        <Typography variant="h6" fontWeight={800} mb={1}>
                            Manual issue (dev)
                        </Typography>
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            Use this only if you want to issue without the request/approval flow.
                        </Typography>

                        <Stack spacing={2}>
                            <TextField
                                label="Subject DID"
                                value={subjectDid}
                                onChange={(e) => setSubjectDid(e.target.value)}
                                placeholder="did:key:z6Mk..."
                                fullWidth
                            />

                            <TextField
                                select
                                label="Credential type"
                                value={vcType}
                                onChange={(e) => setVcType(e.target.value)}
                                slotProps={{ select: { native: true } }}
                                fullWidth
                            >
                                <option value="CitizenshipCredential">CitizenshipCredential</option>
                                <option value="AgeCredential">AgeCredential</option>
                                <option value="IncomeCredential">IncomeCredential</option>
                            </TextField>

                            <TextField
                                label="Claims (JSON object)"
                                value={claimsText}
                                onChange={(e) => setClaimsText(e.target.value)}
                                fullWidth
                                multiline
                                minRows={6}
                                placeholder='{"citizenship":"RO"}'
                            />

                            <TextField
                                label="Validity days (optional)"
                                value={validityDays}
                                onChange={(e) => setValidityDays(e.target.value.replace(/[^\d]/g, ""))}
                                placeholder="30"
                                fullWidth
                            />

                            <Button variant="contained" onClick={onIssue} disabled={issuing}>
                                {issuing ? "Issuing..." : "Issue VC"}
                            </Button>
                        </Stack>
                    </CardContent>
                </Card>

                {result ? (
                    <Card>
                        <CardContent>
                            <Typography variant="h6" fontWeight={800} mb={1}>
                                Issued (manual)
                            </Typography>

                            <Stack spacing={1}>
                                <Typography variant="body2" color="text.secondary">
                                    vcHash: <b>{result.vcHash}</b>
                                </Typography>

                                <Stack direction="row" spacing={1} flexWrap="wrap">
                                    <Button variant="outlined" onClick={() => copy(vcRaw)}>
                                        Copy VC
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        onClick={() => downloadJson(result, `issued_vc_${result.vcHash}.json`)}
                                    >
                                        Download JSON
                                    </Button>
                                </Stack>

                                <Divider sx={{ my: 1 }} />

                                <TextField
                                    label="VC (raw)"
                                    value={vcRaw}
                                    fullWidth
                                    multiline
                                    minRows={6}
                                    InputProps={{ readOnly: true } as any}
                                />
                            </Stack>
                        </CardContent>
                    </Card>
                ) : null}

                <Card>
                    <CardContent>
                        <Typography variant="h6" fontWeight={800} mb={1}>
                            Recent issued
                        </Typography>
                        <Stack spacing={1}>
                            {recent.map((r) => (
                                <Box
                                    key={r.id}
                                    sx={{
                                        p: 1.25,
                                        border: "1px solid",
                                        borderColor: "divider",
                                        borderRadius: 2,
                                        bgcolor: "background.paper",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 2,
                                    }}
                                >
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography fontWeight={700} variant="body2">
                                            {r.vc_type} · {r.subject_did}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {String(r.created_at).slice(0, 19)} · hash {r.vc_hash.slice(0, 12)}…
                                        </Typography>
                                    </Box>
                                    <Button size="small" variant="outlined" onClick={() => copy(r.vc_hash)}>
                                        Copy hash
                                    </Button>
                                </Box>
                            ))}

                            {!loadingRecent && recent.length === 0 ? (
                                <Typography color="text.secondary">No issued credentials yet.</Typography>
                            ) : null}
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </Box>
    );
}