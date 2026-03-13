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
import { useNavigation } from "@react-navigation/native";
import { loadLastWallet } from "../src/storage/walletSession";
import { COLORS } from "../src/theme/colors";

import { loadAgeSecret, loadCitizenshipSecret, loadIncomeSecret } from "../src/zk/secrets";

import { runAggregateProof } from "../src/zk/proverBridge";
import { ZkProver } from "../src/components/ZKProver";
import type { AggregateZkInput } from "../src/zk/proverTypes";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const REQUIRED_TYPES = ["CitizenshipCredential", "AgeCredential", "IncomeCredential"] as const;
const FIXED_POLICY = "office_entry";

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
    vc?: any;
};

function notify(title: string, msg: string) {
    if (Platform.OS === "web") {
        window.alert(`${title}\n\n${msg}`);
    } else {
        Alert.alert(title, msg);
    }
}

function fmtDateTime(iso: string) {
    const v = String(iso || "");
    return v ? v.slice(0, 19).replace("T", " ") : "-";
}

function isExpired(expiresAtIso: string) {
    const t = Date.parse(String(expiresAtIso || ""));
    return Number.isFinite(t) ? Date.now() > t : false;
}

function getHolderToken(sess: any): string | null {
    return (
        sess?.holderToken ||
        sess?.holderJwt ||
        sess?.token ||
        sess?.holder?.token ||
        null
    );
}

function getCommitmentsFromVc(vc: any) {
    const cs = vc?.credentialSubject ?? {};
    return {
        ageCommit: cs.ageCommit ? String(cs.ageCommit) : null,
        citizenshipCommit: cs.citizenshipCommit ? String(cs.citizenshipCommit) : null,
        incomeCommit: cs.incomeCommit ? String(cs.incomeCommit) : null,
        currency: cs.currency ? String(cs.currency) : null,
    };
}


export default function ProofRequestScreen() {
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();

    const [holderDid, setHolderDid] = useState("");

    const [req, setReq] = useState<ProofRequest | null>(null);
    const [reqErr, setReqErr] = useState("");

    const [vcsLoading, setVcsLoading] = useState(false);
    const [vcs, setVcs] = useState<VCListItem[]>([]);
    const [selected, setSelected] = useState<Record<string, boolean>>({});

    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

    const [proverReady, setProverReady] = useState(false);

    const toggle = (hash: string) => setSelected((p) => ({ ...p, [hash]: !p[hash] }));

    const selectedHashes = useMemo(
        () => Object.keys(selected).filter((h) => selected[h]),
        [selected],
    );

    const missingRequired = useMemo(() => {
        const have = new Set(vcs.map((v) => v.title));
        return REQUIRED_TYPES.filter((t) => !have.has(t));
    }, [vcs]);

    const missingSelection = useMemo(() => {
        const selectedVCs = vcs.filter((x) => selected[x.hash]);
        const haveTypes = new Set(selectedVCs.map((x) => x.title));
        return REQUIRED_TYPES.filter((t) => !haveTypes.has(t));
    }, [vcs, selected]);

    const canSend =
        !sending &&
        proverReady &&
        !!holderDid.trim() &&
        missingRequired.length === 0 &&
        missingSelection.length === 0;

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

    const listForDisplay = useMemo(() => {
        const a = vcs.filter((x) => (REQUIRED_TYPES as readonly string[]).includes(x.title));
        const b = vcs.filter((x) => !(REQUIRED_TYPES as readonly string[]).includes(x.title));
        return [...a, ...b];
    }, [vcs]);

    async function fetchProofRequest(id: string): Promise<ProofRequest> {
        const r = await fetch(`${BASE_URL}/proof-requests/${encodeURIComponent(id)}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok || !j?.request) throw new Error(j?.error || "request_not_found");

        return {
            id: String(j.request.id),
            status: String(j.request.status),
            policy: String(j.request.policy),
            requesterId: j.request.requesterId ? String(j.request.requesterId) : null,
            nonce: String(j.request.nonce),
            constraints: j.request.constraints ?? {},
            expiresAt: String(j.request.expiresAt),
            createdAt: String(j.request.createdAt),
        };
    }

    async function startProofSessionFixed(): Promise<ProofRequest> {
        const sess = await loadLastWallet();
        const holderToken = getHolderToken(sess);
        if (!holderToken) throw new Error("missing_holder_token");

        const r = await fetch(`${BASE_URL}/holder/proof-requests/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${holderToken}`,
            },
            body: JSON.stringify({ policy: FIXED_POLICY }),
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || "start_failed");

        const requestId = String(j.requestId || j.id || j.request?.id || "").trim();
        if (!requestId) throw new Error("bad_start_response");

        return await fetchProofRequest(requestId);
    }

    async function fetchVcByHash(profile: string, passphrase: string, hash: string) {
        const r = await fetch(`${BASE_URL}/wallets/item`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                profile,
                passphrase,
                kind: "vc",
                id: hash,
            }),
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok || !j?.item?.verifiableCredential) {
            throw new Error(j?.error || "vc_item_failed");
        }

        return j.item.verifiableCredential;
    }

    async function buildAggregateInput(
        selectedVcs: any[],
        constraints: any,
    ): Promise<AggregateZkInput> {
        let ageCommit: string | null = null;
        let citizenshipCommit: string | null = null;
        let incomeCommit: string | null = null;

        for (const vc of selectedVcs) {
            const typeArr = Array.isArray(vc?.type) ? vc.type : [vc?.type].filter(Boolean);
            const mainType =
                typeArr.find((t: string) => t !== "VerifiableCredential") || "";

            const commits = getCommitmentsFromVc(vc);

            if (mainType === "AgeCredential") {
                ageCommit = commits.ageCommit;
            }
            if (mainType === "CitizenshipCredential") {
                citizenshipCommit = commits.citizenshipCommit;
            }
            if (mainType === "IncomeCredential") {
                incomeCommit = commits.incomeCommit;
            }
        }

        if (!ageCommit) throw new Error("missing_age_commit");
        if (!citizenshipCommit) throw new Error("missing_citizenship_commit");
        if (!incomeCommit) throw new Error("missing_income_commit");

        const ageSecret = await loadAgeSecret(ageCommit);
        const citSecret = await loadCitizenshipSecret(citizenshipCommit);
        const incomeSecret = await loadIncomeSecret(incomeCommit);

        if (!ageSecret) throw new Error("missing_age_secret");
        if (!citSecret) throw new Error("missing_cit_secret");
        if (!incomeSecret) throw new Error("missing_income_secret");

        const expectedCitizenship =
            String(
                constraints?.expectedCitizenship ??
                constraints?.citizenshipNumeric ??
                constraints?.citizenship ??
                "",
            );

        const L = String(constraints?.L ?? "");
        const U = String(constraints?.U ?? "");
        const contextId = String(constraints?.contextId ?? "");

        if (!expectedCitizenship) throw new Error("missing_expected_citizenship");
        if (!L) throw new Error("missing_L");
        if (!U) throw new Error("missing_U");
        if (!contextId) throw new Error("missing_context_id");

        return {
            age: String(ageSecret.age),
            citizenship: String(citSecret.citizenship),
            income: String(incomeSecret.income),

            saltAge: String(ageSecret.saltAge),
            saltCit: String(citSecret.saltCit),
            saltIncome: String(incomeSecret.saltIncome),

            ageCommit,
            citizenshipCommit,
            incomeCommit,

            expectedCitizenship,
            L,
            U,
            contextId,
        };
    }

    const generateAndSend = useCallback(async () => {
        if (!BASE_URL) return notify("Error", "Missing EXPO_PUBLIC_API_BASE_URL");

        setSending(true);
        setReqErr("");
        setResult(null);

        try {
            if (!holderDid.trim()) throw new Error("missing_holder_did");

            if (missingRequired.length) {
                throw new Error(`wallet_missing:${missingRequired.join(",")}`);
            }
            if (missingSelection.length) {
                throw new Error(`select_required:${missingSelection.join(",")}`);
            }

            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const pr = await startProofSessionFixed();
            setReq(pr);

            if (pr.status !== "open" || isExpired(pr.expiresAt)) {
                throw new Error("request_not_open_or_expired");
            }

            const vcHashes = Object.keys(selected).filter((h) => selected[h]);
            if (!vcHashes.length) throw new Error("no_credentials_selected");

            const selectedVcObjects = [];
            for (const h of vcHashes) {
                const vc = await fetchVcByHash(sess.profileName, sess.passphrase, h);
                selectedVcObjects.push(vc);
            }

            const zkInput = await buildAggregateInput(selectedVcObjects, pr.constraints);
            console.log("zkInput", zkInput);

            const vpResp = await fetch(`${BASE_URL}/wallets/vps/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    holderDid: holderDid.trim(),
                    vcHashes,
                    challenge: pr.nonce,
                    domain: pr.policy,
                }),
            });

            const vpJson = await vpResp.json().catch(() => ({}));
            if (!vpResp.ok || !vpJson?.ok) {
                throw new Error(vpJson?.error || vpJson?.message || "create_vp_failed");
            }

            const vpJwt = vpJson.vpJwt ? String(vpJson.vpJwt) : "";
            const vpHash = vpJson.hash ? String(vpJson.hash) : "";

            if (!vpJwt) {
                throw new Error("missing_vp_jwt");
            }

            const { proof, publicSignals } = await runAggregateProof(zkInput);

            const subResp = await fetch(`${BASE_URL}/proof-requests/${encodeURIComponent(pr.id)}/submit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    holderDid: holderDid.trim(),
                    vpJwt: vpJwt,
                    vpHash: vpHash || undefined,
                    proof,
                    publicSignals,
                }),
            });

            const subJson = await subResp.json().catch(() => ({}));
            if (!subResp.ok || !subJson?.ok) throw new Error(subJson?.error || "submit_failed");

            setResult({ ok: true, msg: String(subJson.status || "accepted") });
            notify("Sent", "Proof submitted.");
        } catch (e: any) {
            const msg = String(e?.message || e);

            if (msg.startsWith("wallet_missing:")) {
                notify("Missing credentials", `Wallet is missing: ${msg.replace("wallet_missing:", "").split(",").join(", ")}`);
            } else if (msg.startsWith("select_required:")) {
                notify("Select required", `Select credentials for: ${msg.replace("select_required:", "").split(",").join(", ")}`);
            } else if (msg === "missing_holder_token") {
                notify("Not connected", "Missing holder token. Do pairing/connect first.");
            } else {
                notify("Error", msg || "Could not generate/send proof");
            }

            setResult({ ok: false, msg });
            setReqErr(msg);
        } finally {
            setSending(false);
        }
    }, [holderDid, missingRequired, missingSelection, selected, navigation]);

    useEffect(() => {
        loadHolderDid();
        loadVcs();
    }, [loadHolderDid, loadVcs]);

    return (
        <SafeAreaView
            style={[styles.container, { paddingTop: insets.top + 12 }]}
            edges={["left", "right"]}
        >
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
                <View style={styles.topBar}>
                    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.topLeft}>
                        <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                    </Pressable>
                    <Text style={styles.topTitle}>Proof request</Text>
                    <View style={styles.topRight} />
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Required credentials</Text>
                    <View style={[styles.chipsRow, { marginTop: 8 }]}>
                        {REQUIRED_TYPES.map((t) => (
                            <View key={t} style={styles.chip}>
                                <Text style={styles.chipText}>{t}</Text>
                            </View>
                        ))}
                    </View>

                    {missingRequired.length ? (
                        <Text style={[styles.err, { marginTop: 10 }]}>
                            Wallet missing: {missingRequired.join(", ")}
                        </Text>
                    ) : null}

                    {!missingRequired.length && missingSelection.length ? (
                        <Text style={[styles.err, { marginTop: 10 }]}>
                            Select: {missingSelection.join(", ")}
                        </Text>
                    ) : null}
                </View>

                {reqErr ? <Text style={styles.err}>{reqErr}</Text> : null}

                {req ? (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Session</Text>
                        <Text style={styles.cardSub}>policy: {req.policy}</Text>
                        <Text style={styles.cardSub}>status: {String(req.status).toUpperCase()}</Text>
                        <Text style={styles.cardSub}>expires: {fmtDateTime(req.expiresAt)}</Text>
                        <Text style={[styles.cardSub, { marginTop: 6 }]} numberOfLines={1}>
                            id: {req.id}
                        </Text>
                    </View>
                ) : null}

                <Text style={styles.label}>Holder DID</Text>
                <TextInput
                    value={holderDid}
                    editable={false}
                    selectTextOnFocus={false}
                    placeholder="did:..."
                    placeholderTextColor={COLORS.subtle}
                    style={[styles.input, { opacity: 0.9 }]}
                />

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <Text style={styles.label}>(Select) Credentials</Text>
                    <Pressable
                        onPress={loadVcs}
                        disabled={vcsLoading}
                        style={[styles.smallBtn, vcsLoading && { opacity: 0.6 }]}
                    >
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
                    disabled={!canSend}
                    onPress={generateAndSend}
                    style={[styles.primaryBtn, !canSend && { opacity: 0.6 }]}
                >
                    {sending ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <ActivityIndicator />
                            <Text style={styles.primaryText}>Sending…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryText}>Generate proof & Send</Text>
                    )}
                </Pressable>

                {result ? (
                    <Text style={[styles.result, { color: result.ok ? COLORS.muted : "#F87171" }]}>
                        {result.ok ? `Result: ${result.msg}` : `Error: ${result.msg}`}
                    </Text>
                ) : null}
            </ScrollView>
            <ZkProver
                baseUrl={BASE_URL || ""}
                onReadyChange={setProverReady}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.bg,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },

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