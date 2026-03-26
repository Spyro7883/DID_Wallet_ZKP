import React, { useMemo, useState } from "react";
import {
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Platform,
    StatusBar,
    ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { loadLastWallet } from "../src/storage/walletSession";
import { type AppColors } from "../src/theme/colors";
import { useAppTheme } from "../src/theme/AppThemeProvider";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type DidMethod = "key" | "ethr";

export default function CreateDidScreen() {
    const { colors } = useAppTheme();
    const COLORS = colors;
    const styles = useMemo(() => createStyles(COLORS), [COLORS]);

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
            if (!resp.ok || !json.ok) {
                throw new Error(json.error || "create_did_failed");
            }

            const did = json.did as string | undefined;
            if (did) {
                Alert.alert("DID created", did);
            }

            navigation.goBack();
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not create DID");
        } finally {
            setLoading(false);
        }
    };

    const TOP_PAD = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 12;

    return (
        <SafeAreaView
            style={[styles.container, { paddingTop: TOP_PAD }]}
            edges={["top", "left", "right"]}
        >
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.topBar}>
                    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.topLeft}>
                        <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                    </Pressable>

                    <Text style={styles.topTitle}>Create DID</Text>

                    <View style={styles.topRight} />
                </View>

                <Text style={styles.subtitle}>
                    Create a new decentralized identifier for this wallet
                </Text>

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Method</Text>

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

                    <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Alias</Text>
                    <Text style={styles.fieldHint}>Optional label for easier recognition</Text>

                    <TextInput
                        value={alias}
                        onChangeText={setAlias}
                        placeholder="e.g. Main identity"
                        placeholderTextColor={COLORS.subtle}
                        style={styles.input}
                        {...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {})}
                    />
                </View>

                <Pressable
                    disabled={!canCreate}
                    onPress={createDid}
                    style={[styles.primaryBtn, !canCreate && { opacity: 0.6 }]}
                >
                    {loading ? (
                        <View style={styles.btnRow}>
                            <ActivityIndicator />
                            <Text style={styles.primaryText}>Creating…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryText}>Create DID</Text>
                    )}
                </Pressable>

                <Pressable onPress={() => navigation.goBack()} style={styles.secondaryBtn}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
            </ScrollView>
        </SafeAreaView>
    );
}

const createStyles = (COLORS: AppColors) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: COLORS.bg,
        },
        content: {
            paddingHorizontal: 16,
            paddingBottom: 24,
        },

        topBar: {
            height: 48,
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 8,
        },
        topLeft: {
            position: "absolute",
            left: 0,
            padding: 4,
        },
        topRight: {
            position: "absolute",
            right: 0,
            width: 28,
            height: 28,
        },
        topTitle: {
            color: COLORS.text,
            fontSize: 18,
            fontWeight: "600",
        },

        subtitle: {
            fontSize: 12,
            color: COLORS.subtle,
            marginBottom: 14,
        },

        card: {
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
            marginBottom: 18,
        },

        sectionTitle: {
            fontSize: 13,
            fontWeight: "600",
            color: COLORS.text,
            marginBottom: 8,
        },
        fieldHint: {
            fontSize: 11,
            color: COLORS.subtle,
            marginBottom: 8,
        },

        chipsRow: {
            flexDirection: "row",
            gap: 10,
            flexWrap: "wrap",
        },
        chip: {
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: COLORS.borderSoft,
            backgroundColor: COLORS.card,
        },
        chipActive: {
            backgroundColor: COLORS.accentBg,
            borderColor: COLORS.accentBorder,
        },
        chipText: {
            color: COLORS.text,
            fontWeight: "600",
            fontSize: 13,
        },
        chipTextActive: {
            color: COLORS.accentText,
        },

        input: {
            borderWidth: 1,
            borderColor: COLORS.border,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 11,
            color: COLORS.text,
            backgroundColor: COLORS.inputBg,
            fontSize: 14,
        },

        primaryBtn: {
            backgroundColor: COLORS.accentBg,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
        },
        primaryText: {
            fontSize: 14,
            fontWeight: "600",
            color: COLORS.accentText,
        },

        secondaryBtn: {
            marginTop: 10,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
        },
        secondaryText: {
            color: COLORS.text,
            fontWeight: "600",
            fontSize: 14,
        },

        btnRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
    });