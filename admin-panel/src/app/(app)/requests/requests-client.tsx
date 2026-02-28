"use client";

import * as React from "react";
import {
    Box, Card, CardContent, Typography, Stack, Button, TextField, Divider, Alert
} from "@mui/material";
import { api } from "@/lib/api";
import QRCode from "react-qr-code";

type ProofReqRow = {
    id: string;
    status: string;
    policy: string;
    requester_id: string | null;
    expires_at: string;
    created_at: string;
};

export default function RequestsClient() {
    const [policy, setPolicy] = React.useState("office_entry");
    const [requesterId, setRequesterId] = React.useState("desk-01");
    const [ttlSeconds, setTtlSeconds] = React.useState("600");

    // constraints: momentan simplu (json)
    const [constraintsText, setConstraintsText] = React.useState(`{
  "vcTypes": ["CitizenshipCredential", "IncomeCredential"],
  "rules": ["citizenship=RO", "incomeRange"]
}`);

    const [creating, setCreating] = React.useState(false);
    const [err, setErr] = React.useState("");
    const [created, setCreated] = React.useState<any>(null);

    const [items, setItems] = React.useState<ProofReqRow[]>([]);
    const [loadingList, setLoadingList] = React.useState(true);

    async function loadList() {
        setLoadingList(true);
        try {
            const res = await api<{ ok: boolean; items: ProofReqRow[] }>(
                "/admin/proof-requests?status=all&limit=30",
            );
            setItems(res.items || []);
        } finally {
            setLoadingList(false);
        }
    }

    React.useEffect(() => {
        loadList();
    }, []);

    const copy = (v: string) => navigator.clipboard.writeText(v);

    async function onCreate() {
        if (creating) return;
        setErr("");
        setCreated(null);

        let constraints: any = {};
        try {
            constraints = JSON.parse(constraintsText || "{}");
            if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
                throw new Error("constraints must be JSON object");
            }
        } catch (e: any) {
            setErr(e?.message || "Invalid constraints JSON");
            return;
        }

        setCreating(true);
        try {
            const res = await api("/admin/proof-requests", {
                method: "POST",
                body: JSON.stringify({
                    policy: policy.trim(),
                    requesterId: requesterId.trim(),
                    ttlSeconds: Number(ttlSeconds || 600),
                    constraints,
                }),
            });
            setCreated(res);
            await loadList();
        } catch (e: any) {
            setErr(e?.message || "Create failed");
        } finally {
            setCreating(false);
        }
    }

    const link = created?.link ? String(created.link) : "";

    return (
        <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} gap={2} flexWrap="wrap">
                <Box>
                    <Typography variant="h4" fontWeight={800}>Proof Requests</Typography>
                    <Typography color="text.secondary">Create VP/ZKP requests (policy + challenge + constraints)</Typography>
                </Box>
                <Button variant="outlined" onClick={loadList} disabled={loadingList}>
                    {loadingList ? "Refreshing..." : "Refresh"}
                </Button>
            </Stack>

            {err ? <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert> : null}

            <Stack spacing={2}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" fontWeight={800} mb={1}>Create request</Typography>
                        <Stack spacing={2}>
                            <TextField label="Policy" value={policy} onChange={(e) => setPolicy(e.target.value)} />
                            <TextField label="Requester ID" value={requesterId} onChange={(e) => setRequesterId(e.target.value)} />
                            <TextField
                                label="TTL seconds"
                                value={ttlSeconds}
                                onChange={(e) => setTtlSeconds(e.target.value.replace(/[^\d]/g, ""))}
                            />
                            <TextField
                                label="Constraints (JSON)"
                                value={constraintsText}
                                onChange={(e) => setConstraintsText(e.target.value)}
                                multiline
                                minRows={6}
                            />
                            <Button variant="contained" onClick={onCreate} disabled={creating}>
                                {creating ? "Creating..." : "Create"}
                            </Button>
                        </Stack>
                    </CardContent>
                </Card>

                {created ? (
                    <Card>
                        <CardContent>
                            <Typography variant="h6" fontWeight={800} mb={1}>Created</Typography>

                            <Typography variant="body2" color="text.secondary">
                                requestId: <b>{created.request?.id}</b>
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                expiresAt: <b>{String(created.request?.expiresAt)}</b>
                            </Typography>

                            <Divider sx={{ my: 2 }} />

                            <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
                                <Box sx={{ p: 1, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
                                    {link ? <QRCode value={link} size={140} /> : null}
                                </Box>

                                <Box sx={{ minWidth: 0 }}>
                                    <Typography fontWeight={700} sx={{ wordBreak: "break-all" }}>
                                        {link}
                                    </Typography>
                                    <Stack direction="row" spacing={1} mt={1} flexWrap="wrap">
                                        <Button variant="outlined" onClick={() => copy(link)} disabled={!link}>Copy link</Button>
                                        <Button variant="outlined" onClick={() => copy(String(created.request?.id || ""))}>
                                            Copy requestId
                                        </Button>
                                    </Stack>
                                </Box>
                            </Stack>
                        </CardContent>
                    </Card>
                ) : null}

                <Card>
                    <CardContent>
                        <Typography variant="h6" fontWeight={800} mb={1}>Recent requests</Typography>
                        <Stack spacing={1}>
                            {items.map((r) => (
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
                                    }}
                                >
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography fontWeight={700} variant="body2">
                                            {r.policy} · <span style={{ opacity: 0.8 }}>{r.status}</span>
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                                            {r.id} · exp {String(r.expires_at).slice(0, 19)} · {r.requester_id || "-"}
                                        </Typography>
                                    </Box>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => {
                                            const base = (created?.link || "").split("/proof-requests/")[0];
                                            const publicUrlBase = base || window.location.origin.replace(":3000", ":5501");
                                            copy(`${publicUrlBase}/proof-requests/${encodeURIComponent(r.id)}`);
                                        }}
                                    >
                                        Copy link
                                    </Button>
                                </Box>
                            ))}
                            {!loadingList && items.length === 0 ? (
                                <Typography color="text.secondary">No requests yet.</Typography>
                            ) : null}
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </Box>
    );
}