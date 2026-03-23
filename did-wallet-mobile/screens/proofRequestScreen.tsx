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
    Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { loadLastWallet } from "../src/storage/walletSession";
import { saveProofHistoryItem } from "../src/storage/proofHistory";
import { COLORS } from "../src/theme/colors";
import {
    loadAgeSecret,
    loadCitizenshipSecret,
    loadIncomeSecret,
} from "../src/zk/secrets";
import { runAggregateProof } from "../src/zk/proverBridge";
import { ZkProver } from "../src/components/ZkProver";
import type { AggregateZkInput } from "../src/zk/proverTypes";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const REQUIRED_TYPES = [
    "CitizenshipCredential",
    "AgeCredential",
    "IncomeCredential",
] as const;

const FIXED_POLICY = "office_entry.v1";

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

type CheckoutInfo = {
    sessionToken: string;
    eventId: string;
    title: string;
    eventbriteEventId?: string;
    code: string;
    checkoutUrl: string;
    expiresAt: string;
};

type VCListItem = {
    hash: string;
    title: string;
    subjectId: string;
    issuanceDate: string;
    issuanceDateIso?: string;
    issuedAtMs?: number;
    vc?: any;
    hasLocalSecret?: boolean;
    preview?: string;
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

function getVcMainType(vc: any) {
    const typeArr = Array.isArray(vc?.type) ? vc.type : [vc?.type].filter(Boolean);
    return typeArr.find((t: string) => t !== "VerifiableCredential") || "";
}

function getVcSubjectId(vc: any) {
    const cs = vc?.credentialSubject;
    return typeof cs === "object" && cs?.id ? String(cs.id) : "";
}

async function getLocalPreviewForVc(
    vc: any,
): Promise<{ hasLocalSecret: boolean; preview: string }> {
    const cs = vc?.credentialSubject ?? {};
    const mainType = getVcMainType(vc);

    if (mainType === "AgeCredential" && cs.ageCommit) {
        const secret = await loadAgeSecret(String(cs.ageCommit));
        return {
            hasLocalSecret: !!secret,
            preview: secret ? `Age: ${String(secret.age)}` : "Missing local secret",
        };
    }

    if (mainType === "CitizenshipCredential" && cs.citizenshipCommit) {
        const secret = await loadCitizenshipSecret(String(cs.citizenshipCommit));
        return {
            hasLocalSecret: !!secret,
            preview: secret
                ? `Citizenship: ${String(
                    secret.citizenshipAlpha2 ?? secret.citizenship ?? "-",
                )}`
                : "Missing local secret",
        };
    }

    if (mainType === "IncomeCredential" && cs.incomeCommit) {
        const secret = await loadIncomeSecret(String(cs.incomeCommit));
        return {
            hasLocalSecret: !!secret,
            preview: secret ? `Income: ${String(secret.income)}` : "Missing local secret",
        };
    }

    return { hasLocalSecret: false, preview: "Missing local secret" };
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
    const [checkout, setCheckout] = useState<CheckoutInfo | null>(null);

    const toggle = (hash: string) =>
        setSelected((prev) => {
            const item = vcs.find((x) => x.hash === hash);
            if (!item) return prev;

            const next = { ...prev };
            const sameTypeHashes = vcs
                .filter((x) => x.title === item.title)
                .map((x) => x.hash);

            for (const h of sameTypeHashes) {
                delete next[h];
            }

            if (!prev[hash]) {
                next[hash] = true;
            }

            return next;
        });

    const openCheckout = useCallback(async () => {
        try {
            const url = String(checkout?.checkoutUrl || "").trim();
            if (!url) return;

            if (Platform.OS === "web") {
                window.open(url, "_blank", "noopener,noreferrer");
                return;
            }

            const supported = await Linking.canOpenURL(url);
            if (!supported) {
                throw new Error("cannot_open_checkout_url");
            }

            await Linking.openURL(url);
        } catch (e: any) {
            notify("Error", e?.message || "Could not open Eventbrite");
        }
    }, [checkout]);

    const loadHolderDid = useCallback(async () => {
        try {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase || !BASE_URL) return;

            const s = await fetch(`${BASE_URL}/wallets/summary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    limit: 1,
                }),
            });

            const sj = await s.json().catch(() => ({}));
            if (s.ok && sj?.ok && sj?.activeDid) {
                setHolderDid(String(sj.activeDid));
            }
        } catch { }
    }, []);

    async function fetchVcByHash(
        profile: string,
        passphrase: string,
        hash: string,
    ) {
        const r = await fetch(`${BASE_URL}/wallets/item`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile, passphrase, kind: "vc", id: hash }),
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok || !j?.item?.verifiableCredential) {
            throw new Error(j?.error || "vc_item_failed");
        }

        return j.item.verifiableCredential;
    }

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
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                }),
            });

            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j?.ok) throw new Error(j?.error || "vcs_list_failed");

            const baseList: VCListItem[] = (j.vcs ?? []).map((x: any) => ({
                hash: String(x.hash),
                title: String(x.title),
                subjectId: String(x.subjectId ?? "-"),
                issuanceDate: String(x.issuanceDate ?? "-"),
            }));

            const hydrated = await Promise.all(
                baseList.map(async (item) => {
                    try {
                        const vc = await fetchVcByHash(
                            sess.profileName,
                            sess.passphrase,
                            item.hash,
                        );

                        const mainType = getVcMainType(vc) || item.title;
                        const subjectId = getVcSubjectId(vc) || item.subjectId;
                        const issuanceDateIso =
                            typeof vc?.issuanceDate === "string" ? vc.issuanceDate : "";
                        const ts = Date.parse(issuanceDateIso);
                        const issuedAtMs = Number.isFinite(ts) ? ts : 0;

                        const { hasLocalSecret, preview } = await getLocalPreviewForVc(vc);

                        return {
                            ...item,
                            title: mainType,
                            subjectId,
                            vc,
                            hasLocalSecret,
                            preview,
                            issuanceDateIso,
                            issuedAtMs,
                            issuanceDate: issuanceDateIso
                                ? fmtDateTime(issuanceDateIso)
                                : item.issuanceDate,
                        };
                    } catch {
                        return {
                            ...item,
                            vc: null,
                            hasLocalSecret: false,
                            preview: "Missing local secret",
                            issuanceDateIso: "",
                            issuedAtMs: 0,
                        };
                    }
                }),
            );

            setVcs(hydrated);
            return hydrated;
        } catch (e: any) {
            notify("Error", e?.message || "Could not load credentials");
            setVcs([]);
            return [];
        } finally {
            setVcsLoading(false);
        }
    }, [navigation]);

    const holderCredentialsByType = useMemo(() => {
        const map = new Map<string, VCListItem[]>();

        for (const item of vcs) {
            if (!(REQUIRED_TYPES as readonly string[]).includes(item.title)) continue;
            if (String(item.subjectId || "") !== holderDid.trim()) continue;

            const arr = map.get(item.title) ?? [];
            arr.push(item);
            map.set(item.title, arr);
        }

        for (const arr of map.values()) {
            arr.sort((a, b) => (b.issuedAtMs ?? 0) - (a.issuedAtMs ?? 0));
        }

        return map;
    }, [vcs, holderDid]);

    const missingRequired = useMemo(() => {
        return REQUIRED_TYPES.filter(
            (t) => (holderCredentialsByType.get(t)?.length ?? 0) === 0,
        );
    }, [holderCredentialsByType]);

    const duplicateRequired = useMemo(() => {
        return REQUIRED_TYPES.filter(
            (t) => (holderCredentialsByType.get(t)?.length ?? 0) > 1,
        );
    }, [holderCredentialsByType]);

    const selectedHolderVcs = useMemo(() => {
        const selectedHashes = new Set(
            Object.keys(selected).filter((h) => selected[h]),
        );

        return vcs.filter(
            (v) => selectedHashes.has(v.hash) && String(v.subjectId || "") === holderDid.trim(),
        );
    }, [selected, vcs, holderDid]);

    const missingSelection = useMemo(() => {
        const haveTypes = new Set(selectedHolderVcs.map((x) => x.title));
        return REQUIRED_TYPES.filter((t) => !haveTypes.has(t));
    }, [selectedHolderVcs]);

    const listForDisplay = useMemo(() => {
        return [...vcs]
            .filter((x) => (REQUIRED_TYPES as readonly string[]).includes(x.title))
            .sort((a, b) => {
                const ai = REQUIRED_TYPES.indexOf(
                    a.title as (typeof REQUIRED_TYPES)[number],
                );
                const bi = REQUIRED_TYPES.indexOf(
                    b.title as (typeof REQUIRED_TYPES)[number],
                );
                if (ai !== bi) return ai - bi;
                return (b.issuedAtMs ?? 0) - (a.issuedAtMs ?? 0);
            });
    }, [vcs]);

    useEffect(() => {
        setSelected((prev) => {
            const next: Record<string, boolean> = {};

            for (const t of REQUIRED_TYPES) {
                const items = holderCredentialsByType.get(t) ?? [];

                if (items.length === 1) {
                    next[items[0].hash] = true;
                    continue;
                }

                const alreadySelected = items.find((item) => prev[item.hash]);
                if (alreadySelected) {
                    next[alreadySelected.hash] = true;
                }
            }

            return next;
        });
    }, [holderCredentialsByType]);

    const canSend =
        !sending &&
        proverReady &&
        !!holderDid.trim() &&
        missingRequired.length === 0 &&
        missingSelection.length === 0;

    useEffect(() => {
        loadHolderDid();
        loadVcs();
    }, [loadHolderDid, loadVcs]);

    async function fetchProofRequest(id: string): Promise<ProofRequest> {
        const r = await fetch(
            `${BASE_URL}/proof-requests/${encodeURIComponent(id)}`,
            {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            },
        );

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok || !j?.request) {
            throw new Error(j?.error || "request_not_found");
        }

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
            body: JSON.stringify({
                policy: FIXED_POLICY,
            }),
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || "start_failed");

        const requestId = String(j.requestId || j.id || j.request?.id || "").trim();
        if (!requestId) throw new Error("bad_start_response");

        return await fetchProofRequest(requestId);
    }

    async function buildAggregateInput(
        selectedVcs: any[],
        constraints: any,
    ): Promise<AggregateZkInput> {
        let ageCommit: string | null = null;
        let citizenshipCommit: string | null = null;
        let incomeCommit: string | null = null;

        for (const vc of selectedVcs) {
            const mainType = getVcMainType(vc);
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

        const expectedCitizenship = String(
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
        if (!BASE_URL) {
            notify("Error", "Missing EXPO_PUBLIC_API_BASE_URL");
            return;
        }

        setSending(true);
        setReqErr("");
        setResult(null);
        setCheckout(null);

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

            if (
                !pr.constraints?.expectedCitizenship ||
                !pr.constraints?.L ||
                !pr.constraints?.U ||
                !pr.constraints?.contextId
            ) {
                throw new Error("invalid_request_constraints");
            }

            if (pr.status !== "open" || isExpired(pr.expiresAt)) {
                throw new Error("request_not_open_or_expired");
            }

            const selectedItems = vcs.filter((item) => selected[item.hash]);
            const vcHashes = selectedItems.map((item) => item.hash);
            if (!vcHashes.length) throw new Error("no_credentials_selected");

            const selectedVcObjects: any[] = [];
            for (const item of selectedItems) {
                if (item.vc) {
                    selectedVcObjects.push(item.vc);
                } else {
                    const vc = await fetchVcByHash(
                        sess.profileName,
                        sess.passphrase,
                        item.hash,
                    );
                    selectedVcObjects.push(vc);
                }
            }

            const selectedTypes = new Set(
                selectedVcObjects.map((vc) => getVcMainType(vc)),
            );

            for (const required of REQUIRED_TYPES) {
                if (!selectedTypes.has(required)) {
                    throw new Error(`select_required:${required}`);
                }
            }

            for (const vc of selectedVcObjects) {
                const subjectId = getVcSubjectId(vc);
                if (subjectId && subjectId !== holderDid.trim()) {
                    throw new Error("selected_vc_subject_mismatch");
                }
            }

            const zkInput = await buildAggregateInput(selectedVcObjects, pr.constraints);
            const { proof, publicSignals } = await runAggregateProof(zkInput);

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

            const subResp = await fetch(
                `${BASE_URL}/proof-requests/${encodeURIComponent(pr.id)}/submit`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        holderDid: holderDid.trim(),
                        vpJwt,
                        vpHash: vpHash || undefined,
                        proof,
                        publicSignals,
                    }),
                },
            );

            const subJson = await subResp.json().catch(() => ({}));
            if (!subResp.ok || !subJson?.ok) {
                throw new Error(subJson?.error || "submit_failed");
            }

            const checkoutInfo = subJson.checkout
                ? {
                    sessionToken: String(subJson.checkout.sessionToken),
                    eventId: String(subJson.checkout.eventId),
                    title: String(subJson.checkout.title),
                    eventbriteEventId: subJson.checkout.eventbriteEventId
                        ? String(subJson.checkout.eventbriteEventId)
                        : undefined,
                    code: String(subJson.checkout.code),
                    checkoutUrl: String(subJson.checkout.checkoutUrl),
                    expiresAt: String(subJson.checkout.expiresAt),
                }
                : null;

            await saveProofHistoryItem({
                proofRequestId: pr.id,
                policy: pr.policy,
                holderDid: holderDid.trim(),
                result: "accepted",
                vpHash: vpHash || null,
                eventId: checkoutInfo?.eventId ?? null,
                eventTitle: checkoutInfo?.title ?? null,
                accessCode: checkoutInfo?.code ?? null,
                checkoutUrl: checkoutInfo?.checkoutUrl ?? null,
                expiresAt: checkoutInfo?.expiresAt ?? null,
            });

            setCheckout(checkoutInfo);
            setResult({
                ok: true,
                msg: checkoutInfo
                    ? "accepted - access granted"
                    : String(subJson.status || "accepted"),
            });

            const updatedReq = await fetchProofRequest(pr.id).catch(() => null);
            if (updatedReq) {
                setReq(updatedReq);
            } else {
                setReq((prev) => (prev ? { ...prev, status: "closed" } : prev));
            }

            setSelected({});
            await loadVcs();

            notify(
                "Sent",
                checkoutInfo
                    ? "Proof accepted. Event access reserved."
                    : "Proof submitted.",
            );
        } catch (e: any) {
            const msg = String(e?.message || e);
            setCheckout(null);

            if (msg.startsWith("wallet_missing:")) {
                notify(
                    "Missing credentials",
                    `Wallet is missing: ${msg
                        .replace("wallet_missing:", "")
                        .split(",")
                        .join(", ")}`,
                );
            } else if (msg.startsWith("select_required:")) {
                notify(
                    "Select required",
                    `Select credentials for: ${msg
                        .replace("select_required:", "")
                        .split(",")
                        .join(", ")}`,
                );
            } else if (msg === "missing_holder_token") {
                notify("Not connected", "Missing holder token. Do pairing/connect first.");
            } else if (msg === "selected_vc_subject_mismatch") {
                notify(
                    "Invalid selection",
                    "One of the selected credentials belongs to another holder.",
                );
            } else if (msg === "prover_not_ready") {
                notify("Prover", "ZK prover is not ready yet. Wait a few seconds.");
            } else if (msg === "no_codes_available") {
                notify("No tickets", "No Eventbrite access codes are available.");
            } else {
                notify("Error", msg || "Could not generate/send proof");
            }

            setResult({ ok: false, msg });
            setReqErr(msg);
        } finally {
            setSending(false);
        }
    }, [
        holderDid,
        missingRequired,
        missingSelection,
        selected,
        navigation,
        vcs,
        loadVcs,
    ]);

    return (
        <SafeAreaView
            style={[styles.container, { paddingTop: insets.top + 12 }]}
            edges={["left", "right"]}
        >
            <ScrollView
                contentContainerStyle={{ paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.topBar}>
                    <Pressable
                        onPress={() => navigation.goBack()}
                        hitSlop={10}
                        style={styles.topLeft}
                    >
                        <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                    </Pressable>

                    <Text style={styles.topTitle}>Proof request</Text>
                    <Pressable
                        onPress={() => navigation.navigate("ProofHistory")}
                        hitSlop={10}
                        style={styles.topRight}
                    >
                        <MaterialIcons name="history" size={22} color={COLORS.text} />
                    </Pressable>
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
                            Choose one credential for: {missingSelection.join(", ")}.
                        </Text>
                    ) : null}

                    {duplicateRequired.length ? (
                        <Text style={[styles.err, { marginTop: 10 }]}>
                            Multiple credentials available for: {duplicateRequired.join(", ")}. Choose one for each.
                        </Text>
                    ) : null}

                    <Text style={[styles.cardSub, { marginTop: 10 }]}>
                        Prover: {proverReady ? "READY" : "LOADING"}
                    </Text>
                </View>

                {reqErr ? <Text style={styles.err}>{reqErr}</Text> : null}

                {/* {req ? (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Session</Text>
                        <Text style={styles.cardSub}>policy: {req.policy}</Text>
                        <Text style={styles.cardSub}>
                            status: {String(req.status).toUpperCase()}
                        </Text>
                        <Text style={styles.cardSub}>expires: {fmtDateTime(req.expiresAt)}</Text>
                        <Text style={styles.cardSub}>
                            constraints: {JSON.stringify(req.constraints ?? {})}
                        </Text>
                        <Text
                            style={[styles.cardSub, { marginTop: 6 }]}
                            numberOfLines={1}
                        >
                            id: {req.id}
                        </Text>
                    </View>
                ) : null} */}

                {req?.constraints ? (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Verifier rules</Text>
                        <Text style={styles.cardSub}>Minimum age: 18</Text>
                        <Text style={styles.cardSub}>
                            Citizenship:{" "}
                            {String(
                                req.constraints.expectedCitizenshipAlpha2 ??
                                req.constraints.expectedCitizenship ??
                                "-",
                            )}
                        </Text>
                        <Text style={styles.cardSub}>
                            Income range: {String(req.constraints.L ?? "-")} -{" "}
                            {String(req.constraints.U ?? "-")}
                        </Text>
                        {/* <Text style={styles.cardSub}>
                            Context: {String(req.constraints.contextId ?? "-")}
                        </Text> */}
                    </View>
                ) : null}

                {checkout ? (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Event access</Text>
                        <Text style={styles.cardSub}>Event: {checkout.title}</Text>
                        <Text style={styles.cardSub}>Your Eventbrite access code: {checkout.code}</Text>
                        <Text style={styles.cardSub}>
                            Expires: {fmtDateTime(checkout.expiresAt)}
                        </Text>

                        <Pressable onPress={openCheckout} style={styles.primaryBtn}>
                            <Text style={styles.primaryText}>Open Eventbrite</Text>
                        </Pressable>
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

                <View
                    style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 10,
                    }}
                >
                    <Text style={styles.label}>(Select) Credentials</Text>

                    <Pressable
                        onPress={loadVcs}
                        disabled={vcsLoading}
                        style={[styles.smallBtn, vcsLoading && { opacity: 0.6 }]}
                    >
                        <Text style={styles.smallBtnText}>
                            {vcsLoading ? "..." : "Reload"}
                        </Text>
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
                        const wrongSubject = !!holderDid && item.subjectId !== holderDid;
                        const missingSecret = item.hasLocalSecret === false;
                        const disabled = wrongSubject || missingSecret;
                        const on = !!selected[item.hash];

                        let reason = "";
                        if (wrongSubject) reason = "Belongs to another holder";
                        else if (missingSecret) reason = "Missing local secret";

                        return (
                            <Pressable
                                disabled={disabled}
                                onPress={() => toggle(item.hash)}
                                style={[
                                    styles.vcRow,
                                    on && styles.vcRowOn,
                                    disabled && styles.vcRowDisabled,
                                ]}
                            >
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.vcTitle} numberOfLines={1}>
                                        {item.title}
                                    </Text>

                                    <Text
                                        style={styles.vcSub}
                                        numberOfLines={1}
                                        ellipsizeMode="middle"
                                    >
                                        Subject: {item.subjectId}
                                    </Text>

                                    <Text style={styles.vcSub}>Issued: {item.issuanceDate}</Text>

                                    {item.preview ? (
                                        <Text style={styles.vcSub}>{item.preview}</Text>
                                    ) : null}

                                    {reason ? <Text style={styles.vcWarn}>{reason}</Text> : null}
                                </View>

                                <MaterialIcons
                                    name={on ? "check-circle" : "radio-button-unchecked"}
                                    size={22}
                                    color={
                                        disabled
                                            ? COLORS.subtle
                                            : on
                                                ? COLORS.accentBorder
                                                : COLORS.subtle
                                    }
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
                    <Text
                        style={[
                            styles.result,
                            { color: result.ok ? COLORS.muted : "#F87171" },
                        ]}
                    >
                        {result.ok ? `Result: ${result.msg}` : `Error: ${result.msg}`}
                    </Text>
                ) : null}
            </ScrollView>

            <ZkProver baseUrl={BASE_URL || ""} onReadyChange={setProverReady} />
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
    topBar: {
        height: 48,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 12,
    },
    topLeft: { position: "absolute", left: 0, padding: 4 },
    topRight: { position: "absolute", right: 0, width: 28, height: 28 },
    topTitle: { color: COLORS.text, fontSize: 18, fontWeight: "600" },
    label: {
        fontSize: 12,
        color: COLORS.muted,
        marginBottom: 6,
        marginTop: 10,
        letterSpacing: 0.2,
    },
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
    smallBtn: {
        backgroundColor: COLORS.accentBg,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
    },
    smallBtnText: {
        color: COLORS.accentText,
        fontWeight: "600",
        fontSize: 12,
    },
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
    vcRowDisabled: { opacity: 0.45 },
    vcWarn: { color: "#F59E0B", marginTop: 4, fontSize: 11 },
    primaryBtn: {
        backgroundColor: COLORS.accentBg,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
        marginTop: 10,
    },
    primaryText: {
        fontSize: 14,
        fontWeight: "600",
        color: COLORS.accentText,
    },
    result: { marginTop: 10, fontSize: 12 },
});