import React, { useEffect, useMemo, useState } from "react";
import {
    SafeAreaView,
    View,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Platform,
    FlatList,
    TextInput,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { loadLastWallet } from "../src/storage/walletSession";
import { MaterialIcons } from "@expo/vector-icons";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type VCListItem = {
    hash: string;
    title: string;
    subjectId: string;
    issuanceDate: string;
};

const BORDER = "#E5E7EB";
const ACCENT_BG = "#F3E8FF";

export default function CreatePresentationScreen() {
    const navigation = useNavigation<any>();

    const [holderDid, setHolderDid] = useState("");
    const [vcs, setVcs] = useState<VCListItem[]>([]);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(false);
    const canCreate = useMemo(() => !loading, [loading]);

    useEffect(() => {
        let alive = true;

        (async () => {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) return;

            try {
                // default holder = activeDid
                const s = await fetch(`${BASE_URL}/wallets/summary`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profile: sess.profileName, passphrase: sess.passphrase, limit: 1 }),
                });
                const sj = await s.json();
                if (alive && s.ok && sj.ok && sj.activeDid) setHolderDid(String(sj.activeDid));

                // list VCs
                const r = await fetch(`${BASE_URL}/wallets/vcs/list`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profile: sess.profileName, passphrase: sess.passphrase }),
                });
                const j = await r.json();
                if (!r.ok || !j.ok) throw new Error(j.error || "vcs_list_failed");

                if (alive) setVcs(j.vcs ?? []);
            } catch (e: any) {
                Alert.alert("Error", e?.message || "Could not load VCs");
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    const toggle = (hash: string) => {
        setSelected((prev) => ({ ...prev, [hash]: !prev[hash] }));
    };

    const createVp = async () => {
        try {
            setLoading(true);

            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const vcHashes = Object.keys(selected).filter((h) => selected[h]);
            if (!vcHashes.length) throw new Error("Select at least one VC");

            const resp = await fetch(`${BASE_URL}/wallets/vps/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    holderDid: holderDid.trim(),
                    vcHashes,
                }),
            });

            const json = await resp.json();
            if (!resp.ok || !json.ok) throw new Error(json.error || json.message || "create_vp_failed");

            Alert.alert("VP created", `Saved hash: ${json.hash ?? "-"}`);
            navigation.goBack();
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not create VP");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <Text style={styles.title}>Create VP</Text>

            <Text style={styles.label}>Holder DID</Text>
            <TextInput
                value={holderDid}
                onChangeText={setHolderDid}
                placeholder="did:..."
                placeholderTextColor="#6B7280"
                style={styles.input}
                autoCapitalize="none"
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Select credentials</Text>

            <FlatList
                data={vcs}
                keyExtractor={(x) => x.hash}
                contentContainerStyle={{ paddingVertical: 10 }}
                ListEmptyComponent={<Text style={{ color: "#9CA3AF", marginTop: 10 }}>No credentials yet.</Text>}
                renderItem={({ item }) => {
                    const isOn = !!selected[item.hash];
                    return (
                        <Pressable onPress={() => toggle(item.hash)} style={[styles.vcRow, isOn && styles.vcRowOn]}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.vcTitle} numberOfLines={1}>{item.title}</Text>
                                <Text style={styles.vcSub} numberOfLines={1}>Subject: {item.subjectId}</Text>
                                <Text style={styles.vcSub}>Issued: {item.issuanceDate}</Text>
                            </View>
                            <MaterialIcons name={isOn ? "check-circle" : "radio-button-unchecked"} size={22} color={isOn ? "#A855F7" : "#6B7280"} />
                        </Pressable>
                    );
                }}
            />

            <Pressable disabled={!canCreate} onPress={createVp} style={[styles.primaryBtn, !canCreate && { opacity: 0.6 }]}>
                {loading ? <ActivityIndicator /> : <Text style={styles.primaryText}>Create VP</Text>}
            </Pressable>

            <Pressable onPress={() => navigation.goBack()} style={styles.secondaryBtn}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0B0F14", padding: 24 },
    title: { fontSize: 20, fontWeight: "700", color: "white", marginBottom: 18 },
    label: { fontSize: 12, color: "#C7CDD6", marginBottom: 6 },
    input: {
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: "white",
        backgroundColor: "rgba(255,255,255,0.06)",
    },
    vcRow: {
        borderWidth: 1,
        borderColor: "rgba(229,231,235,0.15)",
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        backgroundColor: "rgba(255,255,255,0.04)",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    vcRowOn: { borderColor: "rgba(168,85,247,0.6)" },
    vcTitle: { color: "white", fontWeight: "700", fontSize: 13 },
    vcSub: { color: "#9CA3AF", marginTop: 2, fontSize: 11 },

    primaryBtn: {
        backgroundColor: ACCENT_BG,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#D8B4FE",
        marginTop: 6,
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
