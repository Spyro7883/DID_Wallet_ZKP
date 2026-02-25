import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    SafeAreaView,
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { MaterialIcons } from "@expo/vector-icons";
import { loadLastWallet } from "../src/storage/walletSession";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ClaimRow = { id: string; key: string; value: string };

type VCType = "AgeCredential" | "CitizenshipCredential" | "IncomeCredential";

type VcRequestStatus =
    | "pending"
    | "approved"
    | "rejected"
    | "unknown";

type VcRequestDetail = {
    id: number;
    status: VcRequestStatus;
    holderDid: string;
    subjectDid: string;
    vcType: string;
    claims: any;
    validityDays: number | null;
    createdAt: string;
    decidedAt: string | null;
    decidedBy: string | null;
    decisionNote: string | null;
    issued: null | { vcHash: string; vcJwt: string | null };
};

const rid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const notify = (title: string, message: string) => {
    console.log(`[${title}] ${message}`);
    if (Platform.OS === "web") {
        // @ts-ignore
        window.alert(`${title}\n\n${message}`);
    } else {
        Alert.alert(title, message);
    }
};

async function readJsonSafe(resp: Response) {
    const text = await resp.text();
    try {
        return { json: JSON.parse(text), text };
    } catch {
        return { json: null, text };
    }
}

function parseValue(v: string): any {
    const s = v.trim();
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return v;
}

function buildClaims(rows: ClaimRow[]): { claims: Record<string, any>; error?: string } {
    const out: Record<string, any> = {};
    const seen = new Set<string>();

    for (const r of rows) {
        const k = r.key.trim();
        if (!k) continue;

        const kl = k.toLowerCase();
        if (seen.has(kl)) return { claims: {}, error: `Duplicate field name: "${k}"` };
        seen.add(kl);

        out[k] = parseValue(r.value);
    }

    if (!Object.keys(out).length) return { claims: {}, error: "Add at least one claim field" };
    return { claims: out };
}

function validateClaimsForType(t: VCType, claims: Record<string, any>) {
    if (t === "CitizenshipCredential") {
        const c = String(claims.citizenship || "").toUpperCase();
        if (!/^[A-Z]{2}$/.test(c)) throw new Error("citizenship must be 2 letters (e.g. RO)");
        claims.citizenship = c;
    }

    if (t === "AgeCredential") {
        const dob = String(claims.dateOfBirth || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error("dateOfBirth must be YYYY-MM-DD");
    }

    if (t === "IncomeCredential") {
        const min = Number(claims.incomeMin);
        const max = Number(claims.incomeMax);
        const cur = String(claims.currency || "").toUpperCase();
        if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("incomeMin/incomeMax must be numbers");
        if (min > max) throw new Error("incomeMin must be <= incomeMax");
        if (!/^[A-Z]{3}$/.test(cur)) throw new Error("currency must be 3 letters (e.g. RON)");
        claims.incomeMin = min;
        claims.incomeMax = max;
        claims.currency = cur;
    }
}

export default function CreateCredentialScreen() {
    const navigation = useNavigation<any>();

    const [subjectDid, setSubjectDid] = useState("");
    const [type, setType] = useState<VCType>("CitizenshipCredential");
    const [validDays, setValidDays] = useState("365");

    const [claimRows, setClaimRows] = useState<ClaimRow[]>([
        { id: rid(), key: "citizenship", value: "RO" },
    ]);

    const [loading, setLoading] = useState(false);
    const canCreate = useMemo(() => !loading, [loading]);

    const [imported, setImported] = useState(false);

    const [requestId, setRequestId] = useState<number | null>(null);
    const [requestDetail, setRequestDetail] = useState<VcRequestDetail | null>(null);
    const [loadingStatus, setLoadingStatus] = useState(false);

    const pollRef = useRef<any>(null);

    const DEFAULT_FIELDS: Record<VCType, { key: string; value: string }[]> = {
        CitizenshipCredential: [{ key: "citizenship", value: "RO" }],
        AgeCredential: [{ key: "dateOfBirth", value: "1999-01-01" }],
        IncomeCredential: [
            { key: "incomeMin", value: "1000" },
            { key: "incomeMax", value: "3000" },
            { key: "currency", value: "RON" },
        ],
    };

    const TYPES: { label: string; value: VCType }[] = [
        { label: "Citizenship", value: "CitizenshipCredential" },
        { label: "Age", value: "AgeCredential" },
        { label: "Income", value: "IncomeCredential" },
    ];

    useEffect(() => {
        setClaimRows(DEFAULT_FIELDS[type].map((f) => ({ id: rid(), ...f })));
    }, [type]);

    useEffect(() => {
        (async () => {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase || !BASE_URL) return;

            try {
                const resp = await fetch(`${BASE_URL}/wallets/summary`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profile: sess.profileName, passphrase: sess.passphrase, limit: 1 }),
                });
                const json = await resp.json();
                if (resp.ok && json.ok && json.activeDid) setSubjectDid(String(json.activeDid));
            } catch { }
        })();
    }, []);

    const addRow = () => setClaimRows((p) => [...p, { id: rid(), key: "", value: "" }]);
    const removeRow = (id: string) => setClaimRows((p) => p.filter((x) => x.id !== id));
    const updateRow = (id: string, patch: Partial<ClaimRow>) =>
        setClaimRows((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));

    async function importIssuedVc(vcJwt: string) {
        const sess = await loadLastWallet();
        if (!sess?.profileName || !sess?.passphrase) throw new Error("missing_session");
        if (!BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

        const r = await fetch(`${BASE_URL}/wallets/vcs/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                profile: sess.profileName,
                passphrase: sess.passphrase,
                vcJwt,
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || j?.message || "save_vc_failed");
    }

    async function fetchRequestStatus(id: number) {
        const sess = await loadLastWallet();
        if (!sess?.holderToken) throw new Error("Missing holder token. Pair first.");
        if (!BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

        setLoadingStatus(true);
        try {
            const resp = await fetch(`${BASE_URL}/vc/requests/${id}`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${sess.holderToken}`,
                },
            });
            const { json, text } = await readJsonSafe(resp);
            if (!resp.ok) throw new Error((json && (json.error || json.message)) || text || `HTTP ${resp.status}`);
            if (!json?.ok) throw new Error(json?.error || json?.message || "status_failed");

            const r = json.request as any;

            const detail: VcRequestDetail = {
                id: Number(r.id),
                status: (String(r.status || "unknown") as VcRequestStatus) || "unknown",
                holderDid: String(r.holderDid || ""),
                subjectDid: String(r.subjectDid || ""),
                vcType: String(r.vcType || ""),
                claims: r.claims ?? {},
                validityDays: r.validityDays ?? null,
                createdAt: String(r.createdAt || ""),
                decidedAt: r.decidedAt ? String(r.decidedAt) : null,
                decidedBy: r.decidedBy ? String(r.decidedBy) : null,
                decisionNote: r.decisionNote ? String(r.decisionNote) : null,
                issued: r.issued
                    ? {
                        vcHash: String(r.issued.vcHash || ""),
                        vcJwt: r.issued.vcJwt ? String(r.issued.vcJwt) : null,
                    }
                    : null,
            };

            setRequestDetail(detail);

            if (!imported && detail.status === "approved" && detail.issued?.vcJwt) {
                setImported(true);
                try {
                    await importIssuedVc(detail.issued.vcJwt);
                    notify("Saved", "VC was saved into your wallet.");
                } catch (e: any) {
                    setImported(false);
                    throw e;
                }
            }

            if (detail.status !== "pending") {
                if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                }
            }
        } finally {
            setLoadingStatus(false);
        }
    }

    useEffect(() => {
        if (!requestId) return;

        fetchRequestStatus(requestId).catch(() => { });

        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
            fetchRequestStatus(requestId).catch(() => { });
        }, 4000);

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [requestId]);

    const submitRequest = async () => {
        console.log("submitRequest: start", { BASE_URL });
        try {
            setLoading(true);

            const sess = await loadLastWallet();
            console.log("submitRequest: session", sess);
            if (!sess?.profileName || !sess?.passphrase) {
                notify("Auth", "No wallet session. Redirecting to Welcome.");
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }
            if (!BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

            const holderToken = sess.holderToken;
            if (!holderToken) throw new Error("Missing holderToken. Pair first (/connect/*).");

            const { claims, error } = buildClaims(claimRows);
            if (error) throw new Error(error);
            validateClaimsForType(type, claims);

            const days = Number(validDays || "0");
            if (!Number.isFinite(days) || days <= 0) throw new Error("validityDays must be > 0");

            const body = { type, validityDays: days, claims };
            console.log("submitRequest: POST /vc/requests body", body);

            const resp = await fetch(`${BASE_URL}/vc/requests`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${holderToken}`,
                },
                body: JSON.stringify(body),
            });

            const { json, text } = await readJsonSafe(resp);
            console.log("submitRequest: response", { status: resp.status, ok: resp.ok, json, text });

            if (!resp.ok) {
                const msg =
                    (json && (json.error || json.message)) ||
                    text ||
                    `HTTP ${resp.status}`;
                throw new Error(msg);
            }

            if (!json?.ok) throw new Error(json?.error || json?.message || "request_failed");

            const id = Number(json.request?.id);
            if (!Number.isFinite(id)) throw new Error("bad_request_id");

            setRequestId(id);
            setRequestDetail(null);
            setImported(false);

            notify("Request submitted", `Request #${id} is pending approval`);
        } catch (e: any) {
            console.error("submitRequest: error", e);
            notify("Error", e?.message || "Could not submit request");
        } finally {
            setLoading(false);
        }
    };

    const statusLabel =
        requestDetail?.status === "approved"
            ? "Approved"
            : requestDetail?.status === "rejected"
                ? "Rejected"
                : requestDetail?.status === "pending"
                    ? "Pending"
                    : requestId
                        ? "Pending"
                        : "—";

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView
                contentContainerStyle={{ paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
            >
                <Text style={styles.title}>Request VC</Text>

                <Text style={styles.label}>Your DID (subject = holder)</Text>
                <TextInput
                    value={subjectDid}
                    onChangeText={setSubjectDid}
                    placeholder="did:..."
                    placeholderTextColor="#6B7280"
                    style={styles.input}
                    autoCapitalize="none"
                    editable={false}
                />

                <Text style={styles.label}>Credential type</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    {TYPES.map((t) => (
                        <Pressable
                            key={t.value}
                            onPress={() => setType(t.value)}
                            style={[styles.typePill, type === t.value && styles.typePillActive]}
                        >
                            <Text style={[styles.typeText, type === t.value && styles.typeTextActive]}>
                                {t.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                <Text style={styles.label}>Validity (days)</Text>
                <TextInput
                    value={validDays}
                    onChangeText={setValidDays}
                    placeholder="365"
                    placeholderTextColor="#6B7280"
                    style={styles.input}
                    keyboardType="number-pad"
                />

                <View style={styles.claimsHeader}>
                    <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Claims</Text>
                    <Pressable onPress={addRow} style={styles.addBtn}>
                        <MaterialIcons name="add" size={18} color="#111827" />
                        <Text style={styles.addBtnText}>Add field</Text>
                    </Pressable>
                </View>

                {claimRows.map((r, idx) => (
                    <View key={r.id} style={styles.claimCard}>
                        <View style={styles.claimCardHeader}>
                            <Text style={styles.claimCardTitle}>Claim {idx + 1}</Text>

                            <Pressable onPress={() => removeRow(r.id)} hitSlop={10} style={styles.removeBtn}>
                                <MaterialIcons name="close" size={18} color="#9CA3AF" />
                            </Pressable>
                        </View>

                        <View style={styles.claimFields}>
                            <TextInput
                                value={r.key}
                                onChangeText={(t) => updateRow(r.id, { key: t })}
                                placeholder="Field name (e.g. citizenship)"
                                placeholderTextColor="#6B7280"
                                style={[styles.claimFieldInput, styles.claimFieldTop]}
                                autoCapitalize="none"
                            />

                            <TextInput
                                value={r.value}
                                onChangeText={(t) => updateRow(r.id, { value: t })}
                                placeholder="Value (e.g. RO, 22, true)"
                                placeholderTextColor="#6B7280"
                                style={styles.claimFieldInput}
                            />
                        </View>
                    </View>
                ))}

                <View style={{ height: 8 }} />

                <Pressable
                    disabled={!canCreate}
                    onPressIn={() => console.log("PRESS IN")}
                    onPress={() => { console.log("PRESS"); submitRequest(); }}
                    style={[styles.primaryBtn, !canCreate && { opacity: 0.6 }]}
                >
                    {loading ? <ActivityIndicator /> : <Text style={styles.primaryText}>Submit request</Text>}
                </Pressable>

                {requestId ? (
                    <View style={styles.statusCard}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.statusTitle}>Request #{requestId}</Text>
                                <Text style={styles.statusSub}>
                                    Status: <Text style={{ fontWeight: "800" }}>{statusLabel}</Text>
                                </Text>
                            </View>

                            <Pressable
                                onPress={() => fetchRequestStatus(requestId).catch((e) => Alert.alert("Error", e?.message || "status_failed"))}
                                style={styles.refreshBtn}
                            >
                                {loadingStatus ? (
                                    <ActivityIndicator />
                                ) : (
                                    <>
                                        <MaterialIcons name="refresh" size={18} color="#111827" />
                                        <Text style={styles.refreshText}>Refresh</Text>
                                    </>
                                )}
                            </Pressable>
                        </View>

                        {requestDetail?.decisionNote ? (
                            <Text style={styles.statusNote}>Note: {requestDetail.decisionNote}</Text>
                        ) : null}

                        {requestDetail?.issued?.vcHash ? (
                            <View style={{ marginTop: 10 }}>
                                <Text style={styles.statusSub}>Issued VC hash:</Text>
                                <Text style={styles.mono}>{requestDetail.issued.vcHash}</Text>

                                {requestDetail.issued.vcJwt ? (
                                    <>
                                        <Text style={[styles.statusSub, { marginTop: 8 }]}>VC JWT:</Text>
                                        <Text style={styles.monoSmall} numberOfLines={6}>
                                            {requestDetail.issued.vcJwt}
                                        </Text>
                                    </>
                                ) : null}
                            </View>
                        ) : null}
                    </View>
                ) : null}

                <Pressable onPress={() => navigation.goBack()} style={styles.secondaryBtn}>
                    <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
            </ScrollView>
        </SafeAreaView>
    );
}

const BORDER = "#E5E7EB";
const ACCENT_BG = "#F3E8FF";

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0B0F14", padding: 24 },
    title: { fontSize: 20, fontWeight: "700", color: "white", marginBottom: 18 },
    label: { fontSize: 12, color: "#C7CDD6", marginBottom: 6, marginTop: 10, letterSpacing: 0.2 },

    input: {
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
        color: "white",
        backgroundColor: "rgba(255,255,255,0.06)",
        fontSize: 14,
        ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
    },

    typePill: {
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.2)",
        backgroundColor: "rgba(255,255,255,0.04)",
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
    },
    typePillActive: {
        backgroundColor: ACCENT_BG,
        borderColor: "#D8B4FE",
    },
    typeText: { color: "white", fontWeight: "600", fontSize: 12 },
    typeTextActive: { color: "#111827" },

    claimsHeader: {
        marginTop: 12,
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    addBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: ACCENT_BG,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: "#D8B4FE",
    },
    addBtnText: { color: "#111827", fontWeight: "700", fontSize: 12 },

    claimCard: {
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        borderRadius: 14,
        padding: 12,
        marginBottom: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
    },

    claimCardHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
    },

    claimCardTitle: {
        color: "#C7CDD6",
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0.2,
    },

    claimFields: {
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    claimFieldInput: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: "white",
        fontSize: 14,
        ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
    },

    claimFieldTop: {
        borderBottomWidth: 1,
        borderBottomColor: "rgba(229,231,235,0.12)",
    },

    removeBtn: {
        width: 30,
        height: 30,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.12)",
    },

    primaryBtn: {
        backgroundColor: ACCENT_BG,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#D8B4FE",
    },
    primaryText: { fontSize: 14, fontWeight: "700", color: "#111827" },

    statusCard: {
        marginTop: 14,
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        borderRadius: 14,
        padding: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
    },
    statusTitle: { color: "white", fontWeight: "800", fontSize: 14 },
    statusSub: { color: "#C7CDD6", marginTop: 4, fontSize: 12 },
    statusNote: { color: "#C7CDD6", marginTop: 8, fontSize: 12 },

    refreshBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: ACCENT_BG,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: "#D8B4FE",
    },
    refreshText: { color: "#111827", fontWeight: "800", fontSize: 12 },

    mono: { color: "white", marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
    monoSmall: {
        color: "white",
        marginTop: 4,
        fontSize: 12,
        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },

    secondaryBtn: {
        marginTop: 10,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.2)",
        backgroundColor: "rgba(255,255,255,0.04)",
    },
    secondaryText: { color: "white", fontWeight: "600" },
});