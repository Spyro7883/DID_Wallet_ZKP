import React, { useEffect, useMemo, useState } from "react";
import {
    SafeAreaView,
    View,
    Text,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Pressable,
    Alert,
    Platform,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../src/navigation/types";
import { loadLastWallet, clearLastWallet } from "../src/storage/walletSession";
import SettingsSheet from "./settings";
import { ItemDetailsPopup } from "./itemDetailsPopup";

type WalletRouteProp = RouteProp<RootStackParamList, "Wallet">;

type WalletItem = {
    kind: "did" | "vc" | "vp";
    id: string;
    title: string;
    subject: string;
    issuedAt: string;
};

type Summary = {
    activeDid: string | null;
    stats: { dids: number; vcs: number; vps: number };
    recentItems: WalletItem[];
};

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export default function WalletScreen() {
    const route = useRoute<WalletRouteProp>();
    const navigation = useNavigation<any>();

    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [profileName, setProfileName] = useState<string>("");

    const [settingsOpen, setSettingsOpen] = useState(false);

    const [detailsOpen, setDetailsOpen] = useState(false);
    const [detailsItem, setDetailsItem] = useState<WalletItem | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState("");
    const [detailsData, setDetailsData] = useState<any>(null);

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                setLoading(true);

                const sess = await loadLastWallet();
                const effectiveProfile = route.params?.profileName ?? sess?.profileName;

                if (!effectiveProfile || !sess?.passphrase) {
                    navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                    return;
                }

                if (sess.profileName !== effectiveProfile) setProfileName(sess.profileName);
                else setProfileName(effectiveProfile);

                const resp = await fetch(`${BASE_URL}/wallets/summary`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        profile: sess.profileName,
                        passphrase: sess.passphrase,
                        limit: 3,
                    }),
                });

                const json = await resp.json();
                if (!resp.ok || !json.ok) throw new Error(json.error || "summary_failed");

                if (alive) {
                    setSummary({
                        activeDid: json.activeDid ?? null,
                        stats: json.stats ?? { dids: 0, vcs: 0, vps: 0 },
                        recentItems: (json.recentItems ?? []) as WalletItem[],
                    });
                }
            } catch (e: any) {
                Alert.alert("Error", e?.message || "Could not load wallet summary");
            } finally {
                if (alive) setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [route.params?.profileName, navigation]);

    const activeDid = summary?.activeDid ?? "No DID yet";
    const stats = summary?.stats ?? { dids: 0, vcs: 0, vps: 0 };
    const recentItems = summary?.recentItems ?? [];

    const recentTitle = useMemo(() => {
        if (!recentItems.length) return "Recent items";
        const allVc = recentItems.every((x) => x.kind === "vc");
        return allVc ? "Verified credentials" : "Recent items";
    }, [recentItems]);

    const goCreateBackup = () => {
        setSettingsOpen(false);
        navigation.navigate("Backup");
    };

    const goImportBackup = () => {
        setSettingsOpen(false);
        navigation.navigate("ImportBackup");
    };

    const doLogout = () => {
        setSettingsOpen(false);

        const run = async () => {
            await clearLastWallet();
            navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
        };

        if (Platform.OS === "web") {
            const ok = window.confirm(
                "Log out?\nYou will need your wallet password to access this identity again."
            );
            if (ok) run();
            return;
        }

        Alert.alert(
            "Log out?",
            "You will need your wallet password to access this identity again.",
            [
                { text: "Cancel", style: "cancel" },
                { text: "Log out", style: "destructive", onPress: run },
            ]
        );
    };

    const openDetails = async (item: WalletItem) => {
        setDetailsItem(item);
        setDetailsOpen(true);
        setDetailsLoading(true);
        setDetailsError("");
        setDetailsData(null);

        try {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                setDetailsOpen(false);
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const resp = await fetch(`${BASE_URL}/wallets/item`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    kind: item.kind,
                    id: item.id,
                }),
            });

            const json = await resp.json().catch(() => ({}));
            if (!resp.ok || !json.ok) throw new Error(json.error || "details_failed");

            setDetailsData(json.item);
        } catch (e: any) {
            setDetailsError(e?.message || "Could not load details");
        } finally {
            setDetailsLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.headerRow}>
                    <Text style={styles.headerTitle}>Wallet: {profileName}</Text>

                    <Pressable hitSlop={8} onPress={() => setSettingsOpen(true)}>
                        <MaterialIcons name="settings" size={22} color="#111827" />
                    </Pressable>
                </View>

                <View style={styles.identityCard}>
                    <Text style={styles.identityName}>{profileName}</Text>
                    <Text style={styles.identityLabel}>Active identity</Text>
                    <Text style={styles.identityDid}>{activeDid}</Text>

                    <View style={styles.identityStatsRow}>
                        <Text style={styles.identityStat}>DIDs: {stats.dids}</Text>
                        <Text style={styles.identityStat}>VCs: {stats.vcs}</Text>
                        <Text style={styles.identityStat}>VPs: {stats.vps}</Text>
                    </View>
                </View>

                <Pressable
                    style={styles.primaryButton}
                    onPress={() => navigation.navigate("WalletItems", { kind: "all" })}
                >
                    <Text style={styles.primaryButtonText}>Open Wallet Items</Text>
                </Pressable>

                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{recentTitle}</Text>
                    <Pressable
                        onPress={() => navigation.navigate("WalletItems", { kind: "all" })}
                        hitSlop={4}
                    >
                        <Text style={styles.sectionLink}>View All</Text>
                    </Pressable>
                </View>

                {loading ? (
                    <View style={{ paddingVertical: 18 }}>
                        <ActivityIndicator />
                    </View>
                ) : (
                    <View style={styles.itemsList}>
                        {recentItems.map((item) => (
                            <Pressable
                                key={`${item.kind}:${item.id}`}
                                style={styles.itemCard}
                                onPress={() => openDetails(item)}
                            >
                                <View style={styles.cardRow}>
                                    <View style={styles.badge}>
                                        <Text style={styles.badgeText}>{item.kind.toUpperCase()}</Text>
                                    </View>

                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.itemTitle} numberOfLines={1}>
                                            {item.title}
                                        </Text>
                                        <Text style={styles.itemSubtitle} numberOfLines={1}>
                                            {item.subject}
                                        </Text>
                                        <Text style={styles.itemSubtitle} numberOfLines={1}>
                                            {item.issuedAt}
                                        </Text>
                                    </View>
                                </View>
                            </Pressable>
                        ))}

                        {!recentItems.length && (
                            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
                                No items yet.
                            </Text>
                        )}
                    </View>
                )}
            </ScrollView>

            <SettingsSheet
                visible={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onCreateBackup={goCreateBackup}
                onImportBackup={goImportBackup}
                onLogout={doLogout}
            />

            {/* ✅ același popup ca în WalletItems */}
            <ItemDetailsPopup
                visible={detailsOpen}
                item={
                    detailsItem
                        ? { kind: detailsItem.kind, id: detailsItem.id, title: detailsItem.title }
                        : null
                }
                loading={detailsLoading}
                error={detailsError}
                data={detailsData}
                onClose={() => {
                    setDetailsOpen(false);
                    setDetailsItem(null);
                    setDetailsError("");
                    setDetailsData(null);
                }}
            />
        </SafeAreaView>
    );
}

const CARD_BG = "#F9FAFB";
const ACCENT_BG = "#F3E8FF";
const BORDER = "#E5E7EB";

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#FFFFFF" },
    content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },

    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    headerTitle: { fontSize: 18, fontWeight: "600" },

    identityCard: {
        backgroundColor: CARD_BG,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: BORDER,
        marginBottom: 16,
    },
    identityName: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
    identityLabel: { fontSize: 12, color: "#6B7280" },
    identityDid: { fontSize: 12, color: "#4B5563", marginTop: 2, marginBottom: 8 },
    identityStatsRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 4,
    },
    identityStat: { fontSize: 12, color: "#4B5563" },

    primaryButton: {
        backgroundColor: ACCENT_BG,
        borderRadius: 999,
        paddingVertical: 12,
        alignItems: "center",
        marginBottom: 24,
    },
    primaryButtonText: { fontSize: 15, fontWeight: "500" },

    sectionHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    sectionTitle: { fontSize: 14, fontWeight: "600" },
    sectionLink: { fontSize: 12, color: "#6366F1", fontWeight: "500" },

    itemsList: { gap: 10 },

    itemCard: {
        backgroundColor: "#FFFFFF",
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: BORDER,
    },
    cardRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    badge: {
        backgroundColor: ACCENT_BG,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: "#D8B4FE",
    },
    badgeText: { fontSize: 11, fontWeight: "700", color: "#111827" },

    itemTitle: { fontSize: 13, fontWeight: "700", color: "#111827" },
    itemSubtitle: { fontSize: 11, color: "#6B7280", marginTop: 2 },
});
