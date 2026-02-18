"use client";

import * as React from "react";
import {
    Box,
    Card,
    CardContent,
    Typography,
    Stack,
    Button,
    Chip,
    Divider,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    MenuItem,
} from "@mui/material";
import { api } from "@/lib/api";
import { InputAdornment } from "@mui/material";

type IssuerRow = {
    did: string;
    alias: string | null;
    provider: string;
    createdAt: string | null;
    keys: Array<{ kid: string; type: string; publicKeyHex: string | null }>;
};

export default function Page() {
    const [loading, setLoading] = React.useState(true);
    const [activeDid, setActiveDid] = React.useState<string>("");
    const [active, setActive] = React.useState<IssuerRow | null>(null);
    const [all, setAll] = React.useState<IssuerRow[]>([]);
    const [err, setErr] = React.useState<string>("");

    const [open, setOpen] = React.useState(false);
    const [provider, setProvider] = React.useState("did:key");
    const [alias, setAlias] = React.useState("");

    async function refresh() {
        setLoading(true);
        setErr("");
        try {
            const res = await api<{ ok: boolean; activeDid: string; active: IssuerRow | null; all: IssuerRow[] }>("/admin/issuer");
            setActiveDid(res.activeDid);
            setActive(res.active);
            setAll(res.all || []);
        } catch (e: any) {
            setErr(e?.message || "Failed to load issuer DIDs");
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => {
        refresh();
    }, []);

    const copy = async (v: string) => {
        await navigator.clipboard.writeText(v);
    };

    const exportDidDoc = async (did: string) => {
        const res = await api<{ ok: boolean; did: string; didDoc: any }>(`/admin/issuer/diddoc?did=${encodeURIComponent(did)}`);
        const blob = new Blob([JSON.stringify(res.didDoc, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `diddoc_${did.replace(/[:/]/g, "_")}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const setActiveIssuer = async (did: string) => {
        await api("/admin/issuer/set-active", { method: "POST", body: JSON.stringify({ did }) });
        await refresh();
    };

    const createIssuer = async () => {
        const suffix = alias.trim();
        const finalAlias = suffix ? `issuer-${suffix}` : undefined;
        await api("/admin/issuer/create", {
            method: "POST",
            body: JSON.stringify({ provider, alias: finalAlias || undefined, setActive: true }),
        });
        setOpen(false);
        setAlias("");
        await refresh();
    };

    return (
        <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Box>
                    <Typography variant="h4" fontWeight={800}>DID Management</Typography>
                    <Typography color="text.secondary">Institution issuer DID (active) + history</Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                    <Button variant="outlined" onClick={refresh} disabled={loading}>Refresh</Button>
                    <Button variant="contained" onClick={() => setOpen(true)}>Create new issuer DID</Button>
                </Stack>
            </Stack>

            {err ? (
                <Card sx={{ mb: 2 }}>
                    <CardContent>
                        <Typography color="error">{err}</Typography>
                    </CardContent>
                </Card>
            ) : null}

            <Stack spacing={2}>
                <Card>
                    <CardContent>
                        <Stack spacing={1}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap">
                                <Box>
                                    <Typography variant="overline" color="text.secondary">Active issuer DID</Typography>
                                    <Typography fontWeight={800} sx={{ wordBreak: "break-all" }}>
                                        {loading ? "Loading..." : (activeDid || "-")}
                                    </Typography>
                                </Box>
                                <Stack direction="row" spacing={1}>
                                    <Button variant="outlined" onClick={() => copy(activeDid)} disabled={!activeDid}>Copy</Button>
                                    <Button variant="outlined" onClick={() => exportDidDoc(activeDid)} disabled={!activeDid}>Export DID Doc</Button>
                                </Stack>
                            </Stack>

                            <Divider sx={{ my: 1 }} />

                            <Stack direction="row" spacing={1} flexWrap="wrap">
                                <Chip label={`provider: ${active?.provider || "-"}`} size="small" />
                                <Chip label={`alias: ${active?.alias || "-"}`} size="small" />
                                <Chip label={`keys: ${active?.keys?.length || 0}`} size="small" />
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent>
                        <Typography variant="overline" color="text.secondary">All issuer DIDs</Typography>
                        <Typography variant="h6" fontWeight={800} mb={1}>Select active</Typography>

                        <Stack spacing={1}>
                            {(all || []).map((x) => (
                                <Box
                                    key={x.did}
                                    sx={{
                                        p: 1.25,
                                        border: "1px solid",
                                        borderColor: "divider",
                                        borderRadius: 2,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 2,
                                    }}
                                >
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography fontWeight={700} sx={{ wordBreak: "break-all" }}>
                                            {x.did}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {x.provider} · {x.alias || "-"} · keys: {x.keys?.length || 0}
                                        </Typography>
                                    </Box>

                                    <Stack direction="row" spacing={1} flexShrink={0}>
                                        <Button size="small" variant="outlined" onClick={() => copy(x.did)}>Copy</Button>
                                        <Button size="small" variant="outlined" onClick={() => exportDidDoc(x.did)}>DID Doc</Button>
                                        <Button
                                            size="small"
                                            variant={x.did === activeDid ? "contained" : "outlined"}
                                            onClick={() => setActiveIssuer(x.did)}
                                            disabled={x.did === activeDid}
                                        >
                                            {x.did === activeDid ? "Active" : "Set active"}
                                        </Button>
                                    </Stack>
                                </Box>
                            ))}
                            {!loading && all.length === 0 ? (
                                <Typography color="text.secondary">No issuer DIDs yet.</Typography>
                            ) : null}
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Create issuer DID</DialogTitle>
                <DialogContent sx={{ pt: 2 }}>
                    <Stack spacing={2} mt={1}>
                        <TextField
                            select
                            label="Provider"
                            value={provider}
                            onChange={(e) => setProvider(e.target.value)}
                        >
                            <MenuItem value="did:key">did:key (recommended)</MenuItem>
                            <MenuItem value="did:ethr">did:ethr (needs chain config)</MenuItem>
                        </TextField>

                        <TextField
                            label="Alias (optional)"
                            value={alias}
                            onChange={(e) => {
                                // păstrează doar a-z 0-9 _ -
                                const v = e.target.value
                                    .toLowerCase()
                                    .replace(/[^a-z0-9_-]+/g, "_")
                                    .replace(/^_+|_+$/g, "");
                                setAlias(v);
                            }}
                            placeholder="test / hr / prod"
                            helperText="Saved as issuer-<alias>. Leave empty for auto."
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">issuer-</InputAdornment>
                                ),
                            }}
                        />

                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={createIssuer}>Create</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
