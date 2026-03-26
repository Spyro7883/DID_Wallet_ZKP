import React, { useEffect, useMemo, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Pressable,
    Alert,
    Platform,
    StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../src/navigation/types";
import { loadLastWallet, clearLastWallet } from "../src/storage/walletSession";
import SettingsSheet from "./settings";
import { ItemDetailsPopup } from "./itemDetailsPopup";
import ConnectIssuerSheet from "./connectIssuer";

import { type AppColors } from "../src/theme/colors";
import { useAppTheme } from "../src/theme/AppThemeProvider";

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
    const { colors } = useAppTheme();
    const COLORS = colors;
    const styles = useMemo(() => createStyles(COLORS), [COLORS]);

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

    const [connectOpen, setConnectOpen] = useState(false);

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

                setProfileName(effectiveProfile);

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

    const goProofRequestScreen = () => {
        setSettingsOpen(false);
        navigation.navigate("ProofRequest");
    };

    const doLogout = () => {
        setSettingsOpen(false);

        const run = async () => {
            await clearLastWallet();
            navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
        };

        if (Platform.OS === "web") {
            const ok = window.confirm("Log out?\nYou will need your wallet password to access this identity again.");
            if (ok) run();
            return;
        }

        Alert.alert("Log out?", "You will need your wallet password to access this identity again.", [
            { text: "Cancel", style: "cancel" },
            { text: "Log out", style: "destructive", onPress: run },
        ]);
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

    const TOP_PAD = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 12;

    return (
        <SafeAreaView style={[styles.container, { paddingTop: TOP_PAD }]} edges={["top", "left", "right"]}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.topBar}>
                    <View style={{ width: 32 }} />
                    <Text style={styles.topTitle}>Wallet</Text>
                    <Pressable hitSlop={8} onPress={() => setSettingsOpen(true)} style={styles.iconBtn}>
                        <MaterialIcons name="settings" size={22} color={COLORS.accentText} />
                    </Pressable>
                </View>

                <Text style={styles.subTitle} numberOfLines={1}>
                    Wallet: {profileName}
                </Text>

                <View style={styles.identityCard}>
                    <Text style={styles.identityName}>{profileName}</Text>
                    <Text style={styles.identityLabel}>Active identity</Text>
                    <Text style={styles.identityDid} numberOfLines={2} ellipsizeMode="middle">
                        {activeDid}
                    </Text>

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
                    <Text style={styles.primaryButtonText}>Open Wallet items</Text>
                </Pressable>

                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{recentTitle}</Text>
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
                                        <Text style={styles.itemSubtitle} numberOfLines={1} ellipsizeMode="middle">
                                            {item.subject}
                                        </Text>
                                        <Text style={styles.itemSubtitle} numberOfLines={1}>
                                            {item.issuedAt}
                                        </Text>
                                    </View>
                                </View>
                            </Pressable>
                        ))}

                        {!recentItems.length && <Text style={styles.empty}>No items yet.</Text>}
                    </View>
                )}
            </ScrollView>

            <SettingsSheet
                visible={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onCreateBackup={goCreateBackup}
                onImportBackup={goImportBackup}
                onLogout={doLogout}
                onConnectIssuer={() => {
                    setSettingsOpen(false);
                    setTimeout(() => setConnectOpen(true), 50);
                }}
                onProofRequest={goProofRequestScreen}
            />

            <ItemDetailsPopup
                visible={detailsOpen}
                item={detailsItem ? { kind: detailsItem.kind, id: detailsItem.id, title: detailsItem.title } : null}
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

            <ConnectIssuerSheet
                visible={connectOpen}
                onClose={() => setConnectOpen(false)}
            />
        </SafeAreaView>
    );
}

const createStyles = (COLORS: AppColors) =>
    StyleSheet.create({
        container: { flex: 1, backgroundColor: COLORS.bg },
        content: { paddingHorizontal: 16, paddingBottom: 24 },

        topBar: {
            height: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
        },
        topTitle: { color: COLORS.text, fontSize: 18, fontWeight: "600" },

        iconBtn: {
            backgroundColor: COLORS.accentBg,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
        },

        subTitle: { color: COLORS.subtle, fontSize: 12, marginBottom: 10 },

        identityCard: {
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
            marginBottom: 14,
        },
        identityName: { fontSize: 16, fontWeight: "600", color: COLORS.text, marginBottom: 4 },
        identityLabel: { fontSize: 12, color: COLORS.muted },
        identityDid: { fontSize: 12, color: COLORS.text, marginTop: 4, marginBottom: 10 },
        identityStatsRow: { flexDirection: "row", justifyContent: "space-between" },
        identityStat: { fontSize: 12, color: COLORS.muted },

        primaryButton: {
            backgroundColor: COLORS.accentBg,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
            marginBottom: 18,
        },
        primaryButtonText: { fontSize: 14, fontWeight: "600", color: COLORS.accentText },

        sectionHeader: {
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 10,
        },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: COLORS.text },
        sectionLink: { fontSize: 12, color: COLORS.link, fontWeight: "600" },

        itemsList: { gap: 10 },

        itemCard: {
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
        },
        cardRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
        badge: {
            backgroundColor: COLORS.accentBg,
            borderRadius: 10,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
        },
        badgeText: { fontSize: 11, fontWeight: "600", color: COLORS.accentText },

        itemTitle: { fontSize: 13, fontWeight: "600", color: COLORS.text },
        itemSubtitle: { fontSize: 11, color: COLORS.muted, marginTop: 2 },

        empty: { color: COLORS.subtle, marginTop: 6 },
    });