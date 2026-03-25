import React, { useCallback, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    Alert,
    Platform,
    Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";

import { COLORS } from "../src/theme/colors";
import {
    clearProofHistory,
    listProofHistory,
    removeProofHistoryItem,
    type ProofHistoryItem,
} from "../src/storage/proofHistory";

function fmtDateTime(iso?: string | null) {
    const v = String(iso || "");
    return v ? v.slice(0, 19).replace("T", " ") : "-";
}

function shortDid(did: string, left = 16, right = 10) {
    if (!did) return "";
    if (did.length <= left + right + 3) return did;
    return `${did.slice(0, left)}...${did.slice(-right)}`;
}

function isExpired(expiresAt?: string | null) {
    const t = Date.parse(String(expiresAt || ""));
    return Number.isFinite(t) ? Date.now() > t : false;
}

export default function ProofHistoryScreen() {
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();

    const [items, setItems] = useState<ProofHistoryItem[]>([]);

    const refresh = useCallback(async () => {
        const data = await listProofHistory();
        setItems(data);
    }, []);

    useFocusEffect(
        useCallback(() => {
            void refresh();
        }, [refresh]),
    );

    const openCheckout = useCallback(async (url?: string | null) => {
        try {
            const target = String(url || "").trim();
            if (!target) return;

            if (Platform.OS === "web") {
                window.open(target, "_blank", "noopener,noreferrer");
                return;
            }

            const supported = await Linking.canOpenURL(target);
            if (!supported) throw new Error("cannot_open_checkout_url");

            await Linking.openURL(target);
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not open Eventbrite");
        }
    }, []);

    const onClearAll = useCallback(() => {
        if (Platform.OS === "web") {
            const ok = window.confirm("Delete all saved proof/access history?");
            if (!ok) return;

            void (async () => {
                await clearProofHistory();
                await refresh();
            })();
            return;
        }

        Alert.alert(
            "Clear history",
            "Delete all saved proof/access history?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                        await clearProofHistory();
                        await refresh();
                    },
                },
            ],
        );
    }, [refresh]);

    const onDeleteOne = useCallback(
        (localId: string) => {
            if (Platform.OS === "web") {
                const ok = window.confirm("Remove this history entry?");
                if (!ok) return;

                void (async () => {
                    await removeProofHistoryItem(localId);
                    await refresh();
                })();
                return;
            }

            Alert.alert(
                "Delete entry",
                "Remove this history entry?",
                [
                    { text: "Cancel", style: "cancel" },
                    {
                        text: "Delete",
                        style: "destructive",
                        onPress: async () => {
                            await removeProofHistoryItem(localId);
                            await refresh();
                        },
                    },
                ],
            );
        },
        [refresh],
    );

    return (
        <SafeAreaView
            style={[styles.container, { paddingTop: insets.top + 12 }]}
            edges={["left", "right"]}
        >
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
                <View style={styles.topBar}>
                    <Pressable
                        onPress={() => navigation.goBack()}
                        hitSlop={10}
                        style={styles.topLeft}
                    >
                        <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                    </Pressable>

                    <Text style={styles.topTitle}>Proof history</Text>

                    <Pressable
                        onPress={onClearAll}
                        hitSlop={10}
                        style={styles.topRightBtn}
                    >
                        <MaterialIcons name="delete-outline" size={22} color={COLORS.text} />
                    </Pressable>
                </View>

                {!items.length ? (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>No history yet</Text>
                        <Text style={styles.cardSub}>
                            Accepted proof submissions and event access entries will appear here.
                        </Text>
                    </View>
                ) : null}

                {items.map((item) => {
                    const accessExpired = isExpired(item.expiresAt);
                    const hasEventAccess = !!(
                        item.eventTitle ||
                        item.accessCode ||
                        item.checkoutUrl
                    );

                    return (
                        <View key={item.localId} style={styles.card}>
                            <View style={styles.rowBetween}>
                                <Text style={styles.cardTitle}>
                                    {item.result === "accepted" ? "Accepted proof" : "Rejected proof"}
                                </Text>

                                <Pressable onPress={() => onDeleteOne(item.localId)} hitSlop={8}>
                                    <MaterialIcons name="close" size={18} color={COLORS.subtle} />
                                </Pressable>
                            </View>

                            <Text style={styles.cardSub}>Policy: {item.policy}</Text>
                            <Text style={styles.cardSub}>Created: {fmtDateTime(item.createdAt)}</Text>
                            <Text style={styles.cardSub}>Holder: {shortDid(item.holderDid)}</Text>

                            {item.vpHash ? (
                                <Text style={styles.cardSub} numberOfLines={1}>
                                    VP hash: {item.vpHash}
                                </Text>
                            ) : null}

                            {item.error ? (
                                <Text style={styles.err}>Error: {item.error}</Text>
                            ) : null}

                            {hasEventAccess && !accessExpired ? (
                                <View style={styles.section}>
                                    <Text style={styles.sectionTitle}>Event access</Text>

                                    {item.eventTitle ? (
                                        <Text style={styles.cardSub}>Event: {item.eventTitle}</Text>
                                    ) : null}

                                    {item.accessCode ? (
                                        <Text style={styles.cardSub}>Code: {item.accessCode}</Text>
                                    ) : null}

                                    {item.expiresAt ? (
                                        <Text style={styles.cardSub}>
                                            Expires: {fmtDateTime(item.expiresAt)}
                                        </Text>
                                    ) : null}

                                    {item.checkoutUrl ? (
                                        <Pressable
                                            onPress={() => openCheckout(item.checkoutUrl)}
                                            style={styles.primaryBtn}
                                        >
                                            <Text style={styles.primaryText}>Open Eventbrite</Text>
                                        </Pressable>
                                    ) : null}
                                </View>
                            ) : null}
                        </View>
                    );
                })}
            </ScrollView>
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
    topRightBtn: { position: "absolute", right: 0, padding: 4 },
    topTitle: { color: COLORS.text, fontSize: 18, fontWeight: "600" },

    card: {
        marginTop: 12,
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card,
    },
    rowBetween: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    cardTitle: { color: COLORS.text, fontWeight: "600", fontSize: 14 },
    cardSub: { color: COLORS.muted, marginTop: 4, fontSize: 12 },
    section: { marginTop: 12 },
    sectionTitle: { color: COLORS.text, fontWeight: "600", fontSize: 13 },
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
    err: { color: "#F87171", marginTop: 8, fontSize: 12 },
    warnText: { color: "#F59E0B" },
});