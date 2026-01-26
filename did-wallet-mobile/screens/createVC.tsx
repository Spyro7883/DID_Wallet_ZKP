import React, { useEffect, useMemo, useState } from "react";
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

const rid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

function parseValue(v: string): any {
    const s = v.trim();

    // bool
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";

    // number (int/float)
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);

    // string
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

export default function CreateCredentialScreen() {
    const navigation = useNavigation<any>();

    const [subjectDid, setSubjectDid] = useState("");
    const [type, setType] = useState("EmploymentCredential");
    const [validDays, setValidDays] = useState("365");

    const [claimRows, setClaimRows] = useState<ClaimRow[]>([
        { id: rid(), key: "citizenship", value: "RO" },
    ]);

    const [loading, setLoading] = useState(false);
    const canCreate = useMemo(() => !loading, [loading]);

    useEffect(() => {
        (async () => {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) return;

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

    const createVc = async () => {
        try {
            setLoading(true);

            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const { claims, error } = buildClaims(claimRows);
            if (error) throw new Error(error);

            const days = Number(validDays || "0");
            const validitySeconds = days > 0 ? Math.floor(days * 24 * 3600) : undefined;

            const resp = await fetch(`${BASE_URL}/wallets/vcs/issue-demo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    subjectDid: subjectDid.trim(),
                    claims,
                    type: type.trim(),
                    validitySeconds,
                }),
            });

            const json = await resp.json();
            if (!resp.ok || !json.ok) throw new Error(json.error || json.message || "create_vc_failed");

            Alert.alert("VC created", `Saved hash: ${json.hash ?? "-"}`);
            navigation.goBack();
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not create VC");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
                <Text style={styles.title}>Create VC</Text>

                <Text style={styles.label}>Subject DID</Text>
                <TextInput
                    value={subjectDid}
                    onChangeText={setSubjectDid}
                    placeholder="did:..."
                    placeholderTextColor="#6B7280"
                    style={styles.input}
                    autoCapitalize="none"
                />

                <Text style={styles.label}>Credential type</Text>
                <TextInput
                    value={type}
                    onChangeText={setType}
                    placeholder="EmploymentCredential"
                    placeholderTextColor="#6B7280"
                    style={styles.input}
                />

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


                <View style={{ height: 16 }} />

                <Pressable
                    disabled={!canCreate}
                    onPress={createVc}
                    style={[styles.primaryBtn, !canCreate && { opacity: 0.6 }]}
                >
                    {loading ? <ActivityIndicator /> : <Text style={styles.primaryText}>Create VC</Text>}
                </Pressable>

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
