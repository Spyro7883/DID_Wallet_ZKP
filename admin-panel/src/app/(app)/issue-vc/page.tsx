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

export default function Page() {
    const [subjectDid, setSubjectDid] = React.useState("");
    const [vcType, setVcType] = React.useState("DemoCredential");
    const [claimsText, setClaimsText] = React.useState(`{"citizenship":"RO"}`);
    const [validitySeconds, setValiditySeconds] = React.useState<string>("");

    const [issuing, setIssuing] = React.useState(false);
    const [err, setErr] = React.useState("");
    const [result, setResult] = React.useState<any>(null);

    const [recent, setRecent] = React.useState<IssuedRow[]>([]);
    const [loadingRecent, setLoadingRecent] = React.useState(true);

    async function loadRecent() {
        setLoadingRecent(true);
        try {
            const res = await api<{ ok: boolean; items: IssuedRow[] }>("/admin/vc/issued?limit=20");
            setRecent(res.items || []);
        } finally {
            setLoadingRecent(false);
        }
    }

    React.useEffect(() => {
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
            if (validitySeconds.trim()) body.validitySeconds = Number(validitySeconds.trim());

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
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} gap={2} flexWrap="wrap">
                <Box>
                    <Typography variant="h4" fontWeight={800}>Issue VC</Typography>
                    <Typography color="text.secondary">Manual issuance by institution issuer DID</Typography>
                </Box>
                <Button variant="outlined" onClick={loadRecent} disabled={loadingRecent}>
                    {loadingRecent ? "Refreshing..." : "Refresh recent"}
                </Button>
            </Stack>

            {err ? (
                <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>
            ) : null}

            <Stack spacing={2}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" fontWeight={800} mb={1}>Create credential</Typography>

                        <Stack spacing={2}>
                            <TextField
                                label="Subject DID"
                                value={subjectDid}
                                onChange={(e) => setSubjectDid(e.target.value)}
                                placeholder="did:key:z6Mk..."
                                fullWidth
                            />

                            <TextField
                                label="Credential type"
                                value={vcType}
                                onChange={(e) => setVcType(e.target.value)}
                                placeholder="CitizenshipCredential / IncomeCredential"
                                fullWidth
                            />

                            <TextField
                                label="Claims (JSON object)"
                                value={claimsText}
                                onChange={(e) => setClaimsText(e.target.value)}
                                fullWidth
                                multiline
                                minRows={6}
                                placeholder='{"citizenship":"RO","incomeMin":1000,"incomeMax":3000}'
                            />

                            <TextField
                                label="Validity seconds (optional)"
                                value={validitySeconds}
                                onChange={(e) => setValiditySeconds(e.target.value.replace(/[^\d]/g, ""))}
                                placeholder="2592000 (30 days)"
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
                            <Typography variant="h6" fontWeight={800} mb={1}>Issued</Typography>

                            <Stack spacing={1}>
                                <Typography variant="body2" color="text.secondary">
                                    vcHash: <b>{result.vcHash}</b>
                                </Typography>

                                <Stack direction="row" spacing={1} flexWrap="wrap">
                                    <Button variant="outlined" onClick={() => copy(String(result.vc))}>
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
                                    value={typeof result.vc === "string" ? result.vc : JSON.stringify(result.vc, null, 2)}
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
                        <Typography variant="h6" fontWeight={800} mb={1}>Recent issued</Typography>
                        <Stack spacing={1}>
                            {recent.map((r) => (
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
