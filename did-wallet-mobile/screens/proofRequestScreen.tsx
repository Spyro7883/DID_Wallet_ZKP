import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    FlatList,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../src/navigation/types";
import { loadLastWallet } from "../src/storage/walletSession";
import { COLORS } from "../src/theme/colors";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type RouteT = RouteProp<RootStackParamList, "ProofRequest">;

type ProofRequest = {
    id: string;
    status: "open" | "closed" | "expired" | string;
    policy: string;
    requesterId: string | null;
    nonce: string;
    constraints: any;
    expiresAt: string;
    createdAt: string;
};

type VCListItem = {
    hash: string;
    title: string;
    subjectId: string;
    issuanceDate: string;
};

function notify(title: string, msg: string) {
    if (Platform.OS === "web") {
        window.alert(`${title}\n\n${msg}`);
    } else {
        Alert.alert(title, msg);
    }
}

function parseRequestId(input: string): string {
    const s = String(input || "").trim();
    if (!s) return "";

    if (/^[a-z0-9_-]{8,}$/i.test(s) && !s.includes("/") && !s.includes(":")) return s;

    const m1 = /\/proof-requests\/([^/?#]+)/i.exec(s);
    if (m1?.[1]) return decodeURIComponent(m1[1]);

    const m2 = /proof-request\/([^/?#]+)/i.exec(s);
    if (m2?.[1]) return decodeURIComponent(m2[1]);

    return "";
}

function fmtDateTime(iso: string) {
    const v = String(iso || "");
    return v ? v.slice(0, 19).replace("T", " ") : "-";
}

function isExpired(expiresAtIso: string) {
    const t = Date.parse(String(expiresAtIso || ""));
    return Number.isFinite(t) ? Date.now() > t : false;
}

export default function ProofRequestScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<RouteT>();
    const insets = useSafeAreaInsets();

    const [holderDid, setHolderDid] = useState("");

    const [input, setInput] = useState(route.params?.requestId || route.params?.link || "");
    const requestId = useMemo(() => parseRequestId(input), [input]);

    const [reqLoading, setReqLoading] = useState(false);
    const [req, setReq] = useState<ProofRequest | null>(null);
    const [reqErr, setReqErr] = useState("");

    const [vcsLoading, setVcsLoading] = useState(false);
    const [vcs, setVcs] = useState<VCListItem[]>([]);
    const [selected, setSelected] = useState<Record<string, boolean>>({});

    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

    const constraints = req?.constraints ?? {};
    const requiredTypes: string[] = useMemo(() => {
        const vt = constraints?.vcTypes;
        return Array.isArray(vt) ? vt.map(String) : [];
    }, [constraints]);

    const requiredRules: string[] = useMemo(() => {
        const rr = constraints?.rules;
        return Array.isArray(rr) ? rr.map(String) : [];
    }, [constraints]);

    const expires = req?.expiresAt ? isExpired(req.expiresAt) : false;

    const canLoad = !!requestId && !reqLoading;
    const canSend = !!req && req.status === "open" && !expires && !sending;

    const selectedHashes = useMemo(
        () => Object.keys(selected).filter((h) => selected[h]),
        [selected],
    );

    const missingRequired = useMemo(() => {
        if (!requiredTypes.length) return [];
        const have = new Set(vcs.map((v) => v.title));
        return requiredTypes.filter((t) => !have.has(t));
    }, [requiredTypes, vcs]);

    const toggle = (hash: string) => setSelected((p) => ({ ...p, [hash]: !p[hash] }));

    const loadHolderDid = useCallback(async () => {
        try {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase || !BASE_URL) return;

            const s = await fetch(`${BASE_URL}/wallets/summary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profile: sess.profileName, passphrase: sess.passphrase, limit: 1 }),
            });
            const sj = await s.json().catch(() => ({}));
            if (s.ok && sj?.ok && sj?.activeDid) setHolderDid(String(sj.activeDid));
        } catch { }
    }, []);

    const loadVcs = useCallback(async (): Promise<VCListItem[]> => {
        setVcsLoading(true);
        try {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return [];
            }
            if (!BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

            const r = await fetch(`${BASE_URL}/wallets/vcs/list`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profile: sess.profileName, passphrase: sess.passphrase }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j?.ok) throw new Error(j?.error || "vcs_list_failed");

            const list: VCListItem[] = (j.vcs ?? []).map((x: any) => ({
                hash: String(x.hash),
                title: String(x.title),
                subjectId: String(x.subjectId ?? "-"),
                issuanceDate: String(x.issuanceDate ?? "-"),
            }));

            setVcs(list);
            return list;
        } catch (e: any) {
            notify("Error", e?.message || "Could not load credentials");
            setVcs([]);
            return [];
        } finally {
            setVcsLoading(false);
        }
    }, [navigation]);

    const autoSelectForTypes = useCallback(
        (types: string[], list: VCListItem[]) => {
            if (!types.length) return;

            const byType = new Map<string, VCListItem[]>();
            for (const vc of list) {
                if (!byType.has(vc.title)) byType.set(vc.title, []);
                byType.get(vc.title)!.push(vc);
            }
            for (const arr of byType.values()) {
                arr.sort((a, b) => String(b.issuanceDate).localeCompare(String(a.issuanceDate)));
            }

            const next: Record<string, boolean> = {};
            for (const t of types) {
                const arr = byType.get(t);
                if (arr?.length) next[arr[0].hash] = true;
            }
            setSelected(next);
        },
        [],
    );

    const loadRequest = useCallback(async () => {
        if (!requestId) {
            setReqErr("Paste a proof request link or id.");
            return;
        }
        if (!BASE_URL) {
            setReqErr("Missing EXPO_PUBLIC_API_BASE_URL");
            return;
        }

        setReqErr("");
        setResult(null);
        setReqLoading(true);

        try {
            const r = await fetch(`${BASE_URL}/proof-requests/${encodeURIComponent(requestId)}`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j?.ok || !j?.request) throw new Error(j?.error || "request_not_found");

            const rr: ProofRequest = {
                id: String(j.request.id),
                status: String(j.request.status),
                policy: String(j.request.policy),
                requesterId: j.request.requesterId ? String(j.request.requesterId) : null,
                nonce: String(j.request.nonce),
                constraints: j.request.constraints ?? {},
                expiresAt: String(j.request.expiresAt),
                createdAt: String(j.request.createdAt),
            };
            setReq(rr);

            const list = await loadVcs();
            autoSelectForTypes(
                Array.isArray(rr.constraints?.vcTypes) ? rr.constraints.vcTypes.map(String) : [],
                list,
            );
        } catch (e: any) {
            setReq(null);
            setReqErr(e?.message || "Could not load request");
        } finally {
            setReqLoading(false);
        }
    }, [requestId, loadVcs, autoSelectForTypes]);

    useEffect(() => {
        loadHolderDid();
    }, [loadHolderDid]);

    useEffect(() => {
        if ((route.params?.requestId || route.params?.link) && requestId) {
            loadRequest();
        }
    }, []);

    const generateAndSend = useCallback(async () => {
        if (!req) return;
        if (!BASE_URL) return notify("Error", "Missing EXPO_PUBLIC_API_BASE_URL");

        if (req.status !== "open" || isExpired(req.expiresAt)) {
            notify("Request", "This request is not open anymore (closed/expired).");
            return;
        }

        if (requiredTypes.length) {
            const selectedVCs = vcs.filter((x) => selected[x.hash]);
            const haveTypes = new Set(selectedVCs.map((x) => x.title));
            const miss = requiredTypes.filter((t) => !haveTypes.has(t));
            if (miss.length) {
                notify("Missing credentials", `Select credentials for: ${miss.join(", ")}`);
                return;
            }
        }

        const vcHashes = Object.keys(selected).filter((h) => selected[h]);
        if (!vcHashes.length) {
            notify("Select", "Select at least one credential.");
            return;
        }

        setSending(true);
        setResult(null);

        try {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const vpResp = await fetch(`${BASE_URL}/wallets/vps/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    holderDid: holderDid.trim(),
                    vcHashes,
                    challenge: req.nonce,
                    domain: req.policy,
                }),
            });
            const vpJson = await vpResp.json().catch(() => ({}));
            if (!vpResp.ok || !vpJson?.ok) throw new Error(vpJson?.error || vpJson?.message || "create_vp_failed");

            const vpJwt = vpJson.vpJwt ? String(vpJson.vpJwt) : "";
            const vpHash = vpJson.hash ? String(vpJson.hash) : "";

            const subResp = await fetch(`${BASE_URL}/proof-requests/${encodeURIComponent(req.id)}/submit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    holderDid: holderDid.trim(),
                    vpJwt: vpJwt || undefined,
                    vpHash: vpHash || undefined,
                    vp: vpJson.vp || undefined,
                }),
            });
            const subJson = await subResp.json().catch(() => ({}));
            if (!subResp.ok || !subJson?.ok) throw new Error(subJson?.error || "submit_failed");

            setResult({ ok: true, msg: String(subJson.status || "accepted") });
            notify("Sent", "Proof submitted.");
        } catch (e: any) {
            setResult({ ok: false, msg: e?.message || "failed" });
            notify("Error", e?.message || "Could not generate/send proof");
        } finally {
            setSending(false);
        }
    }, [req, requiredTypes, selected, vcs, holderDid, navigation]);

    const listForDisplay = useMemo(() => {
        if (!requiredTypes.length) return vcs;
        const a = vcs.filter((x) => requiredTypes.includes(x.title));
        const b = vcs.filter((x) => !requiredTypes.includes(x.title));
        return [...a, ...b];
    }, [vcs, requiredTypes]);

    return (
        <SafeAreaView style={[styles.container, { paddingTop: insets.top + 12 }]} edges={["left", "right"]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
                <View style={styles.topBar}>
                    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.topLeft}>
                        <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                    </Pressable>
                    <Text style={styles.topTitle}>Proof request</Text>
                    <View style={styles.topRight} />
                </View>

                <Text style={styles.label}>Request link / id</Text>
                <View style={styles.inputRow}>
                    <TextInput
                        value={input}
                        onChangeText={setInput}
                        placeholder="Paste /proof-requests/<id> or id"
                        placeholderTextColor={COLORS.subtle}
                        style={[styles.input, { flex: 1 }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <Pressable
                        onPress={loadRequest}
                        disabled={!canLoad}
                        style={[styles.smallBtn, !canLoad && { opacity: 0.6 }]}
                    >
                        <Text style={styles.smallBtnText}>{reqLoading ? "..." : "Load"}</Text>
                    </Pressable>
                </View>
                {reqErr ? <Text style={styles.err}>{reqErr}</Text> : null}

                {req ? (
                    <View style={styles.card}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.cardTitle}>{req.policy}</Text>
                                <Text style={styles.cardSub}>
                                    {req.requesterId ? `By: ${req.requesterId}` : "By: -"} · {req.status.toUpperCase()}
                                </Text>
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                                <Text style={styles.cardSub}>Expires</Text>
                                <Text style={[styles.mono, { fontSize: 12 }]}>{fmtDateTime(req.expiresAt)}</Text>
                            </View>
                        </View>

                        {expires ? <Text style={[styles.err, { marginTop: 8 }]}>Expired.</Text> : null}

                        {(requiredTypes.length || requiredRules.length) ? (
                            <View style={{ marginTop: 10 }}>
                                {requiredTypes.length ? (
                                    <>
                                        <Text style={styles.sectionLabel}>Needs</Text>
                                        <View style={styles.chipsRow}>
                                            {requiredTypes.map((t) => (
                                                <View key={t} style={styles.chip}>
                                                    <Text style={styles.chipText}>{t}</Text>
                                                </View>
                                            ))}
                                        </View>
                                    </>
                                ) : null}

                                {requiredRules.length ? (
                                    <>
                                        <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Rules</Text>
                                        {requiredRules.map((r) => (
                                            <Text key={r} style={styles.rule}>
                                                • {r}
                                            </Text>
                                        ))}
                                    </>
                                ) : null}

                                {missingRequired.length ? (
                                    <Text style={[styles.err, { marginTop: 10 }]}>
                                        Missing: {missingRequired.join(", ")}
                                    </Text>
                                ) : null}
                            </View>
                        ) : null}
                    </View>
                ) : null}

                <Text style={styles.label}>Holder DID</Text>
                <TextInput
                    value={holderDid}
                    onChangeText={setHolderDid}
                    placeholder="did:..."
                    placeholderTextColor={COLORS.subtle}
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                />

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <Text style={styles.label}>(Select) Credentials</Text>
                    <Pressable onPress={loadVcs} disabled={vcsLoading} style={[styles.smallBtn, vcsLoading && { opacity: 0.6 }]}>
                        <Text style={styles.smallBtnText}>{vcsLoading ? "..." : "Reload"}</Text>
                    </Pressable>
                </View>

                <FlatList
                    data={listForDisplay}
                    keyExtractor={(x) => x.hash}
                    scrollEnabled={false}
                    contentContainerStyle={{ paddingTop: 10 }}
                    ListEmptyComponent={
                        <Text style={{ color: COLORS.subtle, marginTop: 10 }}>
                            {vcsLoading ? "Loading..." : "No credentials yet."}
                        </Text>
                    }
                    renderItem={({ item }) => {
                        const on = !!selected[item.hash];
                        return (
                            <Pressable onPress={() => toggle(item.hash)} style={[styles.vcRow, on && styles.vcRowOn]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.vcTitle} numberOfLines={1}>{item.title}</Text>
                                    <Text style={styles.vcSub} numberOfLines={1} ellipsizeMode="middle">
                                        Subject: {item.subjectId}
                                    </Text>
                                    <Text style={styles.vcSub}>Issued: {item.issuanceDate}</Text>
                                </View>
                                <MaterialIcons
                                    name={on ? "check-circle" : "radio-button-unchecked"}
                                    size={22}
                                    color={on ? COLORS.accentBorder : COLORS.subtle}
                                />
                            </Pressable>
                        );
                    }}
                />

                <Pressable
                    disabled={!canSend || !selectedHashes.length}
                    onPress={generateAndSend}
                    style={[
                        styles.primaryBtn,
                        (!canSend || !selectedHashes.length) && { opacity: 0.6 },
                    ]}
                >
                    {sending ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <ActivityIndicator />
                            <Text style={styles.primaryText}>Sending…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryText}>Generate & Send</Text>
                    )}
                </Pressable>

                {result ? (
                    <Text style={[styles.result, { color: result.ok ? COLORS.muted : "#F87171" }]}>
                        {result.ok ? `Result: ${result.msg}` : `Error: ${result.msg}`}
                    </Text>
                ) : null}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingBottom: 16 },

    topBar: { height: 48, justifyContent: "center", alignItems: "center", marginBottom: 12 },
    topLeft: { position: "absolute", left: 0, padding: 4 },
    topRight: { position: "absolute", right: 0, width: 28, height: 28 },
    topTitle: { color: COLORS.text, fontSize: 18, fontWeight: "600" },

    label: { fontSize: 12, color: COLORS.muted, marginBottom: 6, marginTop: 10, letterSpacing: 0.2 },

    input: {
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: COLORS.text,
        backgroundColor: COLORS.inputBg,
        fontSize: 14,
        ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
    },
    inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },

    smallBtn: {
        backgroundColor: COLORS.accentBg,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
    },
    smallBtnText: { color: COLORS.accentText, fontWeight: "600", fontSize: 12 },

    err: { color: "#F87171", marginTop: 8, fontSize: 12 },

    card: {
        marginTop: 12,
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card,
    },
    cardTitle: { color: COLORS.text, fontWeight: "600", fontSize: 14 },
    cardSub: { color: COLORS.muted, marginTop: 4, fontSize: 12 },
    mono: { color: COLORS.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },

    sectionLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "600", marginBottom: 6 },
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        backgroundColor: COLORS.accentBg,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    chipText: { color: COLORS.accentText, fontWeight: "600", fontSize: 12 },

    rule: { color: COLORS.muted, fontSize: 12, marginTop: 4 },

    vcRow: {
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        backgroundColor: COLORS.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    vcRowOn: { borderColor: "rgba(216,180,254,0.85)" },
    vcTitle: { color: COLORS.text, fontWeight: "600", fontSize: 13 },
    vcSub: { color: COLORS.subtle, marginTop: 2, fontSize: 11 },

    primaryBtn: {
        backgroundColor: COLORS.accentBg,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
        marginTop: 6,
    },
    primaryText: { fontSize: 14, fontWeight: "600", color: COLORS.accentText },

    result: { marginTop: 10, fontSize: 12 },
});