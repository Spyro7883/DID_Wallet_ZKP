import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    Modal,
    FlatList,
    StatusBar,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { MaterialIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as circomlibjs from "circomlibjs";

import {
    loadLastWallet,
    saveLastVcRequest,
    loadLastVcRequest,
} from "../src/storage/walletSession";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type VCType = "AgeCredential" | "CitizenshipCredential" | "IncomeCredential";
type VcRequestStatus = "pending" | "approved" | "rejected" | "unknown";

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

const notify = (title: string, message: string) => {
    if (Platform.OS === "web") {
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

function short(s: string, head = 10, tail = 6) {
    const v = String(s || "");
    if (v.length <= head + tail + 3) return v;
    return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

let _poseidon: any | null = null;

async function getPoseidon() {
    if (_poseidon) return _poseidon;
    _poseidon = await (circomlibjs as any).buildPoseidon();
    return _poseidon;
}

async function poseidon2(a: bigint, b: bigint): Promise<string> {
    const p = await getPoseidon();
    const out = p([a, b]);
    return p.F.toString(out);
}

async function randomSalt31(): Promise<bigint> {
    const bytes = await Crypto.getRandomBytesAsync(31);
    const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return BigInt("0x" + hex);
}

async function saveSecretByCommit(
    kind: "age" | "cit" | "income",
    commit: string,
    payload: any,
) {
    await SecureStore.setItemAsync(`zk:${kind}:${commit}`, JSON.stringify(payload));
}

function calcAgeYears(dobIso: string): number {
    const [y, m, d] = String(dobIso || "").split("-").map(Number);
    if (!y || !m || !d) {
        throw new Error("dateOfBirth must be YYYY-MM-DD");
    }

    const dob = new Date(y, m - 1, d);
    const now = new Date();

    let age = now.getFullYear() - dob.getFullYear();
    const beforeBirthday =
        now.getMonth() < dob.getMonth() ||
        (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());

    if (beforeBirthday) age -= 1;

    if (age < 0 || age > 255) {
        throw new Error("derived age out of range");
    }

    return age;
}

function alpha2ToNumericDemo(code: string): bigint {
    const c = String(code || "").toUpperCase().trim();

    if (c === "RO") return 642n;

    throw new Error("Only RO is supported for now");
}

async function buildAgeClaims(dateOfBirth: string) {
    const age = calcAgeYears(dateOfBirth);
    const saltAge = await randomSalt31();
    const ageCommit = await poseidon2(BigInt(age), saltAge);

    await saveSecretByCommit("age", ageCommit, {
        age,
        saltAge: saltAge.toString(),
        dateOfBirth,
    });

    return { ageCommit };
}

async function buildCitizenshipClaims(citizenship: string) {
    const citizenshipNum = alpha2ToNumericDemo(citizenship);
    const saltCit = await randomSalt31();
    const citizenshipCommit = await poseidon2(citizenshipNum, saltCit);

    await saveSecretByCommit("cit", citizenshipCommit, {
        citizenship: citizenshipNum.toString(),
        saltCit: saltCit.toString(),
        citizenshipAlpha2: String(citizenship).toUpperCase().trim(),
    });

    return { citizenshipCommit };
}

async function buildIncomeClaims(incomeText: string, currency: string) {
    const incomeNum = Number(incomeText);
    const cur = String(currency || "").toUpperCase().trim();

    if (!Number.isFinite(incomeNum)) {
        throw new Error("income must be a number");
    }
    if (incomeNum < 0) {
        throw new Error("income must be >= 0");
    }
    if (!/^[A-Z]{3}$/.test(cur)) {
        throw new Error("currency must be 3 letters (e.g. RON)");
    }

    const income = BigInt(Math.trunc(incomeNum));
    const saltIncome = await randomSalt31();
    const incomeCommit = await poseidon2(income, saltIncome);

    await saveSecretByCommit("income", incomeCommit, {
        income: income.toString(),
        saltIncome: saltIncome.toString(),
        currency: cur,
    });

    return { incomeCommit, currency: cur };
}

export default function CreateCredentialScreen() {
    const navigation = useNavigation<any>();

    const [subjectDid, setSubjectDid] = useState("");
    const [type, setType] = useState<VCType>("CitizenshipCredential");
    const [validDays, setValidDays] = useState("365");

    const [citizenship, setCitizenship] = useState("RO");
    const [dob, setDob] = useState("1999-01-01");
    const [income, setIncome] = useState("3000");
    const [currency, setCurrency] = useState("RON");

    const [requestId, setRequestId] = useState<number | null>(null);
    const [requests, setRequests] = useState<VcRequestDetail[]>([]);
    const [syncing, setSyncing] = useState(false);
    const [loading, setLoading] = useState(false);

    const [reqModalOpen, setReqModalOpen] = useState(false);
    const [reqFilter, setReqFilter] = useState<"pending" | "all">("pending");
    const [detailsOpen, setDetailsOpen] = useState(false);

    const [vcModalOpen, setVcModalOpen] = useState(false);

    const syncingRef = useRef(false);
    const importedReqIdsRef = useRef<Set<number>>(new Set());
    const pinnedReqIdRef = useRef<number | null>(null);

    const selectedReq = useMemo(
        () => (requestId ? requests.find((x) => x.id === requestId) ?? null : null),
        [requests, requestId],
    );

    const pendingCount = useMemo(
        () => requests.filter((r) => r.status === "pending").length,
        [requests],
    );

    const TYPES: { label: string; value: VCType }[] = [
        { label: "Citizenship", value: "CitizenshipCredential" },
        { label: "Age", value: "AgeCredential" },
        { label: "Income", value: "IncomeCredential" },
    ];

    useEffect(() => {
        if (type === "CitizenshipCredential") {
            setCitizenship("RO");
        }
        if (type === "AgeCredential") {
            setDob("1999-01-01");
        }
        if (type === "IncomeCredential") {
            setIncome("3000");
            setCurrency("RON");
        }
    }, [type]);

    useEffect(() => {
        (async () => {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase || !BASE_URL) return;

            try {
                const resp = await fetch(`${BASE_URL}/wallets/summary`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        profile: sess.profileName,
                        passphrase: sess.passphrase,
                        limit: 1,
                    }),
                });
                const json = await resp.json();
                if (resp.ok && json?.ok && json.activeDid) {
                    setSubjectDid(String(json.activeDid));
                }
            } catch { }
        })();
    }, []);

    const importIssuedVc = useCallback(async (vcJwt: string) => {
        const sess = await loadLastWallet();
        if (!sess?.profileName || !sess?.passphrase) {
            throw new Error("missing_session");
        }
        if (!BASE_URL) {
            throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");
        }

        const r = await fetch(`${BASE_URL}/wallets/vcs/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                profile: sess.profileName,
                passphrase: sess.passphrase,
                vcJwt,
            }),
        });

        const { json, text } = await readJsonSafe(r);
        if (!r.ok || !json?.ok) {
            throw new Error((json && (json.error || json.message)) || text || "save_vc_failed");
        }
    }, []);

    const syncRequests = useCallback(async () => {
        if (syncingRef.current) return;

        syncingRef.current = true;
        setSyncing(true);

        try {
            const sess = await loadLastWallet();
            if (!sess?.holderToken || !sess?.profileName) return;
            if (!BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

            const resp = await fetch(`${BASE_URL}/vc/requests?status=all&limit=50&offset=0`, {
                method: "GET",
                headers: { Authorization: `Bearer ${sess.holderToken}` },
            });

            const { json, text } = await readJsonSafe(resp);
            if (!resp.ok) {
                throw new Error((json && (json.error || json.message)) || text || `HTTP ${resp.status}`);
            }
            if (!json?.ok || !Array.isArray(json.items)) {
                throw new Error("bad_list_response");
            }

            const items = json.items as VcRequestDetail[];
            setRequests(items);

            const pendingId = items.find((x) => x.status === "pending")?.id ?? null;

            if (!requestId) {
                const last = await loadLastVcRequest(sess.profileName).catch(() => null);

                const fallback =
                    pendingId ||
                    (last && items.find((x) => x.id === last)?.id) ||
                    items[0]?.id ||
                    null;

                if (fallback) {
                    setRequestId(fallback);
                    await saveLastVcRequest(sess.profileName, fallback).catch(() => { });
                }
            } else {
                const current = items.find((x) => x.id === requestId) || null;

                if (!current) {
                    if (pinnedReqIdRef.current === requestId) {
                        pinnedReqIdRef.current = null;
                    }

                    const next = pendingId || items[0]?.id || null;
                    if (next) {
                        setRequestId(next);
                        await saveLastVcRequest(sess.profileName, next).catch(() => { });
                    }
                } else {
                    const isPinned = pinnedReqIdRef.current === requestId;
                    if (!isPinned && current.status !== "pending" && pendingId && pendingId !== requestId) {
                        setRequestId(pendingId);
                        await saveLastVcRequest(sess.profileName, pendingId).catch(() => { });
                    }
                }
            }

            for (const r of items) {
                if (r.status === "approved" && r.issued?.vcJwt) {
                    if (!importedReqIdsRef.current.has(r.id)) {
                        await importIssuedVc(r.issued.vcJwt);
                        importedReqIdsRef.current.add(r.id);
                    }
                }
            }
        } catch (e: any) {
            console.error("syncRequests error:", e);
        } finally {
            syncingRef.current = false;
            setSyncing(false);
        }
    }, [requestId, importIssuedVc]);

    useFocusEffect(
        useCallback(() => {
            syncRequests();
            const t = setInterval(syncRequests, 4000);
            return () => clearInterval(t);
        }, [syncRequests]),
    );

    const submitRequest = useCallback(async () => {
        try {
            setLoading(true);

            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                notify("Auth", "No wallet session. Redirecting to Welcome.");
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }
            if (!BASE_URL) {
                throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");
            }

            const holderToken = sess.holderToken;
            if (!holderToken) {
                throw new Error("Missing holderToken. Pair first.");
            }

            const days = Number(validDays || "0");
            if (!Number.isFinite(days) || days <= 0) {
                throw new Error("validityDays must be > 0");
            }

            let claims: any = {};

            if (type === "AgeCredential") {
                claims = await buildAgeClaims(dob);
            }

            if (type === "CitizenshipCredential") {
                claims = await buildCitizenshipClaims(citizenship);
            }

            if (type === "IncomeCredential") {
                claims = await buildIncomeClaims(income, currency);
            }

            const body = {
                type,
                validityDays: days,
                claims,
            };

            const resp = await fetch(`${BASE_URL}/vc/requests`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${holderToken}`,
                },
                body: JSON.stringify(body),
            });

            const { json, text } = await readJsonSafe(resp);
            if (!resp.ok || !json?.ok) {
                throw new Error((json && (json.error || json.message)) || text || "request_failed");
            }

            const id = Number(json.request?.id);
            if (!Number.isFinite(id)) {
                throw new Error("bad_request_id");
            }

            pinnedReqIdRef.current = null;

            setRequestId(id);
            await saveLastVcRequest(sess.profileName, id).catch(() => { });
            await syncRequests();

            notify("Request submitted", `Request #${id} is pending approval`);
        } catch (e: any) {
            console.error("submitRequest error:", e);
            notify("Error", e?.message || "Could not submit request");
        } finally {
            setLoading(false);
        }
    }, [
        navigation,
        validDays,
        type,
        citizenship,
        dob,
        income,
        currency,
        syncRequests,
    ]);

    const statusLabel =
        selectedReq?.status === "approved"
            ? "APPROVED"
            : selectedReq?.status === "rejected"
                ? "REJECTED"
                : selectedReq?.status === "pending"
                    ? "PENDING"
                    : requestId
                        ? "UNKNOWN"
                        : "—";

    const canSubmit = !loading;

    const TOP_PAD =
        Platform.OS === "android"
            ? (StatusBar.currentHeight ?? 0) + 12
            : 12;

    return (
        <SafeAreaView style={[styles.container, { paddingTop: TOP_PAD }]}>
            <ScrollView
                contentContainerStyle={{ paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
            >
                <View style={styles.topBar}>
                    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.topLeft}>
                        <MaterialIcons name="arrow-back" size={24} color="white" />
                    </Pressable>

                    <Text style={styles.titleText}>Request VC</Text>

                    <Pressable onPress={() => setReqModalOpen(true)} style={[styles.smallBtn, styles.topRight]}>
                        <Text style={styles.smallBtnText}>Requests ({pendingCount})</Text>
                    </Pressable>
                </View>

                <Modal
                    visible={reqModalOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setReqModalOpen(false)}
                >
                    <Pressable style={styles.backdrop} onPress={() => setReqModalOpen(false)} />
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Requests</Text>
                            <Pressable onPress={() => setReqModalOpen(false)}>
                                <MaterialIcons name="close" size={22} color="#C7CDD6" />
                            </Pressable>
                        </View>

                        <View style={{ flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" }}>
                            <Pressable
                                onPress={() => setReqFilter("pending")}
                                style={[styles.chip, reqFilter === "pending" && styles.chipActive]}
                            >
                                <Text style={[styles.chipText, reqFilter === "pending" && styles.chipTextActive]}>
                                    Pending
                                </Text>
                            </Pressable>

                            <Pressable
                                onPress={() => setReqFilter("all")}
                                style={[styles.chip, reqFilter === "all" && styles.chipActive]}
                            >
                                <Text style={[styles.chipText, reqFilter === "all" && styles.chipTextActive]}>
                                    All
                                </Text>
                            </Pressable>

                            <View style={{ flex: 1 }} />

                            <Pressable
                                onPress={syncRequests}
                                style={[styles.smallBtn, syncing && { opacity: 0.6 }]}
                                disabled={syncing}
                            >
                                <Text style={styles.smallBtnText}>{syncing ? "Sync..." : "Sync"}</Text>
                            </Pressable>
                        </View>

                        <FlatList
                            style={{ marginTop: 12 }}
                            data={requests.filter((r) => (reqFilter === "all" ? true : r.status === "pending"))}
                            keyExtractor={(r) => String(r.id)}
                            renderItem={({ item }) => (
                                <Pressable
                                    onPress={async () => {
                                        pinnedReqIdRef.current = item.id;

                                        setRequestId(item.id);
                                        setDetailsOpen(false);
                                        setVcModalOpen(false);

                                        const sess = await loadLastWallet();
                                        if (sess?.profileName) {
                                            await saveLastVcRequest(sess.profileName, item.id).catch(() => { });
                                        }

                                        setReqModalOpen(false);
                                    }}
                                    style={[styles.reqRow, item.id === requestId && styles.reqRowActive]}
                                >
                                    <Text style={styles.reqRowTitle}>#{item.id} · {item.vcType}</Text>
                                    <Text style={styles.reqRowSub}>
                                        {String(item.status).toUpperCase()} ·{" "}
                                        {String(item.createdAt || "").slice(0, 16).replace("T", " ")}
                                    </Text>
                                </Pressable>
                            )}
                            ListEmptyComponent={<Text style={{ color: "#9CA3AF", marginTop: 10 }}>No requests</Text>}
                        />
                    </View>
                </Modal>

                <Modal
                    visible={vcModalOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setVcModalOpen(false)}
                >
                    <Pressable style={styles.backdrop} onPress={() => setVcModalOpen(false)} />
                    <View style={styles.vcModalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Issued VC</Text>
                            <Pressable onPress={() => setVcModalOpen(false)}>
                                <MaterialIcons name="close" size={22} color="#C7CDD6" />
                            </Pressable>
                        </View>

                        <View style={{ marginTop: 10 }}>
                            <Text style={styles.statusSub}>VC hash</Text>
                            <Text style={[styles.mono, { marginTop: 6 }]} selectable>
                                {selectedReq?.issued?.vcHash || ""}
                            </Text>

                            <View style={{ height: 12 }} />

                            <Text style={styles.statusSub}>VC JWT</Text>
                            <TextInput
                                value={selectedReq?.issued?.vcJwt || ""}
                                editable={false}
                                multiline
                                scrollEnabled
                                selectTextOnFocus
                                autoCorrect={false}
                                autoCapitalize="none"
                                style={[styles.input, styles.jwtBox]}
                            />
                        </View>
                    </View>
                </Modal>

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

                <Text style={styles.label}>Claims</Text>

                {type === "CitizenshipCredential" && (
                    <>
                        <TextInput
                            value={citizenship}
                            onChangeText={setCitizenship}
                            placeholder="RO"
                            placeholderTextColor="#6B7280"
                            style={styles.input}
                            autoCapitalize="characters"
                        />
                        <Text style={styles.helperText}>
                            On submit, the app computes a commitment and sends only the commitment.
                        </Text>
                    </>
                )}

                {type === "AgeCredential" && (
                    <>
                        <TextInput
                            value={dob}
                            onChangeText={setDob}
                            placeholder="YYYY-MM-DD"
                            placeholderTextColor="#6B7280"
                            style={styles.input}
                            autoCapitalize="none"
                        />
                        <Text style={styles.helperText}>
                            DOB stays local. The app derives age and sends only the commitment.
                        </Text>
                    </>
                )}

                {type === "IncomeCredential" && (
                    <>
                        <TextInput
                            value={income}
                            onChangeText={setIncome}
                            placeholder="income"
                            placeholderTextColor="#6B7280"
                            style={styles.input}
                            keyboardType="number-pad"
                        />
                        <View style={{ height: 8 }} />
                        <TextInput
                            value={currency}
                            onChangeText={setCurrency}
                            placeholder="RON"
                            placeholderTextColor="#6B7280"
                            style={styles.input}
                            autoCapitalize="characters"
                        />
                        <Text style={styles.helperText}>
                            The app sends only `incomeCommit` and optional currency.
                        </Text>
                    </>
                )}

                <View style={{ height: 14 }} />

                <Pressable
                    disabled={!canSubmit}
                    onPress={submitRequest}
                    style={[styles.primaryBtn, !canSubmit && { opacity: 0.6 }]}
                >
                    {loading ? <ActivityIndicator /> : <Text style={styles.primaryText}>Submit request</Text>}
                </Pressable>

                {requestId && selectedReq ? (
                    <View style={styles.statusCard}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <View style={{ flex: 1, paddingRight: 10 }}>
                                <Text style={styles.statusTitle}>#{selectedReq.id} · {statusLabel}</Text>
                                <Text style={styles.statusSub}>{selectedReq.vcType}</Text>

                                {selectedReq.status === "pending" ? (
                                    <Text style={[styles.statusSub, { marginTop: 8 }]}>
                                        Waiting for approval…
                                    </Text>
                                ) : null}

                                {selectedReq.decisionNote ? (
                                    <Text style={[styles.statusSub, { marginTop: 8 }]}>
                                        Note: {selectedReq.decisionNote}
                                    </Text>
                                ) : null}
                            </View>

                            <View style={{ gap: 8 }}>
                                <Pressable onPress={syncRequests} style={styles.smallBtn}>
                                    <Text style={styles.smallBtnText}>Refresh</Text>
                                </Pressable>

                                {selectedReq.status === "approved" && selectedReq.issued?.vcJwt ? (
                                    <Pressable onPress={() => setVcModalOpen(true)} style={styles.smallBtn}>
                                        <Text style={styles.smallBtnText}>View VC</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        </View>

                        {detailsOpen ? (
                            <View style={{ marginTop: 12 }}>
                                <View style={styles.kvRow}>
                                    <Text style={styles.kvLabel}>Created</Text>
                                    <Text style={styles.kvValue} numberOfLines={1} ellipsizeMode="tail">
                                        {String(selectedReq.createdAt || "").slice(0, 19).replace("T", " ")}
                                    </Text>
                                </View>

                                {selectedReq.decidedAt ? (
                                    <View style={styles.kvRow}>
                                        <Text style={styles.kvLabel}>Decided</Text>
                                        <Text style={styles.kvValue} numberOfLines={1} ellipsizeMode="tail">
                                            {String(selectedReq.decidedAt).slice(0, 19).replace("T", " ")}
                                        </Text>
                                    </View>
                                ) : null}

                                {selectedReq.issued?.vcHash ? (
                                    <View style={styles.kvRow}>
                                        <Text style={styles.kvLabel}>VC hash</Text>
                                        <Text style={styles.kvValue} numberOfLines={1} ellipsizeMode="middle">
                                            {short(selectedReq.issued.vcHash, 14, 10)}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                        ) : null}

                        <Pressable onPress={() => setDetailsOpen((v) => !v)} style={{ marginTop: 12 }}>
                            <Text style={{ color: "#D8B4FE", fontWeight: "600" }}>
                                {detailsOpen ? "Hide details" : "Show details"}
                            </Text>
                        </Pressable>
                    </View>
                ) : null}

                <Pressable onPress={() => navigation.goBack()} style={styles.secondaryBtn}>
                    <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
            </ScrollView>
        </SafeAreaView>
    );
}

const ACCENT_BG = "#F3E8FF";

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#0B0F14",
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
    topRight: { position: "absolute", right: 0 },

    titleText: { color: "white", fontSize: 18, fontWeight: "600" },

    label: { fontSize: 12, color: "#C7CDD6", marginBottom: 6, marginTop: 10, letterSpacing: 0.2 },

    input: {
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: "white",
        backgroundColor: "rgba(255,255,255,0.06)",
        fontSize: 14,
        ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
    },

    helperText: {
        color: "#9CA3AF",
        marginTop: 6,
        fontSize: 11,
        lineHeight: 16,
    },

    typePill: {
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.2)",
        backgroundColor: "rgba(255,255,255,0.04)",
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
    },
    typePillActive: { backgroundColor: ACCENT_BG, borderColor: "#D8B4FE" },
    typeText: { color: "white", fontWeight: "700", fontSize: 12 },
    typeTextActive: { color: "#111827" },

    primaryBtn: {
        backgroundColor: ACCENT_BG,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#D8B4FE",
    },
    primaryText: { fontSize: 14, fontWeight: "600", color: "#111827" },

    secondaryBtn: {
        marginTop: 12,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.2)",
        backgroundColor: "rgba(255,255,255,0.04)",
    },
    secondaryText: { color: "white", fontWeight: "700" },

    smallBtn: {
        backgroundColor: ACCENT_BG,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "#D8B4FE",
        alignSelf: "flex-end",
    },
    smallBtnText: { color: "#111827", fontWeight: "600", fontSize: 12 },

    statusCard: {
        marginTop: 14,
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        borderRadius: 14,
        padding: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
    },
    statusTitle: { color: "white", fontWeight: "600", fontSize: 14 },
    statusSub: { color: "#C7CDD6", marginTop: 4, fontSize: 12 },

    mono: { color: "white", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },

    kvRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 6,
        borderTopWidth: 1,
        borderTopColor: "rgba(229,231,235,0.08)",
    },
    kvLabel: { color: "#9CA3AF", fontSize: 12, fontWeight: "800" },
    kvValue: {
        flex: 1,
        marginLeft: 12,
        color: "white",
        fontSize: 12,
        textAlign: "right",
        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },

    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
    modalCard: {
        position: "absolute",
        left: 16,
        right: 16,
        top: 80,
        bottom: 80,
        backgroundColor: "#0B0F14",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        padding: 12,
    },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    modalTitle: { color: "white", fontWeight: "600", fontSize: 16 },

    chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.2)",
        backgroundColor: "rgba(255,255,255,0.04)",
    },
    chipActive: { backgroundColor: ACCENT_BG, borderColor: "#D8B4FE" },
    chipText: { color: "white", fontWeight: "800", fontSize: 12 },
    chipTextActive: { color: "#111827" },

    reqRow: {
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        backgroundColor: "rgba(255,255,255,0.04)",
        marginBottom: 8,
    },
    reqRowActive: { borderColor: "#D8B4FE", backgroundColor: "rgba(243,232,255,0.12)" },
    reqRowTitle: { color: "white", fontWeight: "600" },
    reqRowSub: { color: "#9CA3AF", marginTop: 2, fontSize: 12 },

    vcModalCard: {
        position: "absolute",
        left: 16,
        right: 16,
        top: 90,
        bottom: 90,
        backgroundColor: "#0B0F14",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        padding: 12,
    },
    jwtBox: {
        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
        fontSize: 12,
        minHeight: 160,
        maxHeight: 260,
        textAlignVertical: "top",
    },
});