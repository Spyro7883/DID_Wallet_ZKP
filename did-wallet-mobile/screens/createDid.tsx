import React, { useMemo, useState } from "react";
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
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { loadLastWallet } from "../src/storage/walletSession";

const BASE_URL =
    Platform.OS === "android"
        ? "http://IP_LAPTOP_LAN:5501"
        : "http://localhost:5501";

type DidMethod = "key" | "ethr";

export default function CreateDidScreen() {
    const navigation = useNavigation<any>();

    const [method, setMethod] = useState<DidMethod>("key");
    const [alias, setAlias] = useState("");
    const [loading, setLoading] = useState(false);

    const canCreate = useMemo(() => !loading, [loading]);

    const createDid = async () => {
        try {
            setLoading(true);

            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const resp = await fetch(`${BASE_URL}/wallets/dids/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    method,
                    alias: alias.trim() || undefined,
                }),
            });

            const json = await resp.json();
            if (!resp.ok || !json.ok) throw new Error(json.error || "create_did_failed");

            const did = json.did as string | undefined;
            if (did) Alert.alert("DID created", did);

            navigation.goBack();
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not create DID");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <Text style={styles.title}>Create DID</Text>

            <Text style={styles.label}>Method</Text>
            <View style={styles.chipsRow}>
                <Pressable
                    onPress={() => setMethod("key")}
                    style={[styles.chip, method === "key" && styles.chipActive]}
                >
                    <Text style={[styles.chipText, method === "key" && styles.chipTextActive]}>
                        did:key
                    </Text>
                </Pressable>

                <Pressable
                    onPress={() => setMethod("ethr")}
                    style={[styles.chip, method === "ethr" && styles.chipActive]}
                >
                    <Text style={[styles.chipText, method === "ethr" && styles.chipTextActive]}>
                        did:ethr
                    </Text>
                </Pressable>
            </View>

            <Text style={styles.label}>Alias (optional)</Text>
            <TextInput
                value={alias}
                onChangeText={setAlias}
                placeholder="e.g. Main identity"
                placeholderTextColor="#6B7280"
                style={styles.input}
            />

            <View style={{ height: 16 }} />

            <Pressable
                disabled={!canCreate}
                onPress={createDid}
                style={[styles.primaryBtn, !canCreate && { opacity: 0.6 }]}
            >
                {loading ? <ActivityIndicator /> : <Text style={styles.primaryText}>Create DID</Text>}
            </Pressable>

            <Pressable onPress={() => navigation.goBack()} style={styles.secondaryBtn}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
        </SafeAreaView>
    );
}

const BORDER = "#E5E7EB";
const ACCENT_BG = "#F3E8FF";

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0B0F14", padding: 24 },
    title: { fontSize: 20, fontWeight: "700", color: "white", marginBottom: 18 },

    label: { fontSize: 12, color: "#C7CDD6", marginBottom: 6 },

    chipsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: "rgba(255,255,255,0.06)",
    },
    chipActive: { backgroundColor: ACCENT_BG, borderColor: "#D8B4FE" },
    chipText: { color: "#E5E7EB", fontWeight: "600" },
    chipTextActive: { color: "#111827" },

    input: {
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: "white",
        backgroundColor: "rgba(255,255,255,0.06)",
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
