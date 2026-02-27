import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";

import {
    View,
    Text,
    StyleSheet,
    Pressable,
    TextInput,
    FlatList,
    ActivityIndicator,
    Alert,
    Platform,
    StatusBar,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { RootStackParamList, WalletKind } from "../src/navigation/types";
import { loadLastWallet } from "../src/storage/walletSession";
import CreateItem from "./createItems";
import { ItemDetailsPopup } from "./itemDetailsPopup";
import { COLORS } from "../src/theme/colors";

import { SafeAreaView } from "react-native-safe-area-context";

type RouteT = RouteProp<RootStackParamList, "WalletItems">;

type Item = {
    kind: "did" | "vc" | "vp";
    id: string;
    title: string;
    line1: string;
    line2: string;
};

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const CHIPS: { label: string; value: WalletKind }[] = [
    { label: "All", value: "all" },
    { label: "DIDs", value: "did" },
    { label: "Credentials", value: "vc" },
    { label: "Presentations", value: "vp" },
];

export default function WalletItemsScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<RouteT>();

    const [kind, setKind] = useState<WalletKind>(route.params?.kind ?? "all");
    const [q, setQ] = useState("");
    const [qDebounced, setQDebounced] = useState("");

    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<Item[]>([]);
    const [createOpen, setCreateOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [selected, setSelected] = useState<Item | null>(null);

    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState("");
    const [detailsData, setDetailsData] = useState<any>(null);

    useEffect(() => {
        const t = setTimeout(() => setQDebounced(q.trim()), 250);
        return () => clearTimeout(t);
    }, [q]);

    const loadItems = useCallback(() => {
        let alive = true;

        (async () => {
            try {
                setLoading(true);

                const sess = await loadLastWallet();
                if (!sess?.profileName || !sess?.passphrase) {
                    navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                    return;
                }

                const resp = await fetch(`${BASE_URL}/wallets/items`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        profile: sess.profileName,
                        passphrase: sess.passphrase,
                        kind,
                        q: qDebounced,
                        limit: 200,
                        offset: 0,
                    }),
                });

                const json = await resp.json();
                if (!resp.ok || !json.ok) throw new Error(json.error || "items_failed");

                if (alive) setItems(json.items ?? []);
            } catch (e: any) {
                Alert.alert("Error", e?.message || "Could not load wallet items");
            } finally {
                if (alive) setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [kind, qDebounced, navigation]);

    useFocusEffect(loadItems);

    const title = useMemo(() => {
        const c = CHIPS.find((x) => x.value === kind);
        return c ? c.label : "Wallet items";
    }, [kind]);

    const closeDetails = () => {
        setDetailsOpen(false);
        setSelected(null);
        setDetailsLoading(false);
        setDetailsError("");
        setDetailsData(null);
    };

    const openDetails = useCallback(
        async (it: Item) => {
            setSelected(it);
            setDetailsOpen(true);
            setDetailsError("");
            setDetailsData(null);

            try {
                setDetailsLoading(true);

                const sess = await loadLastWallet();
                if (!sess?.profileName || !sess?.passphrase) {
                    closeDetails();
                    navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                    return;
                }

                const r = await fetch(`${BASE_URL}/wallets/item`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        profile: sess.profileName,
                        passphrase: sess.passphrase,
                        kind: it.kind,
                        id: it.id,
                    }),
                });

                const j = await r.json().catch(() => ({}));
                if (!r.ok || !j?.ok) throw new Error(j?.error || "item_failed");

                setDetailsData(j.item);
            } catch (e: any) {
                setDetailsError(e?.message || "Could not load item details");
            } finally {
                setDetailsLoading(false);
            }
        },
        [navigation],
    );

    const renderItem = ({ item }: { item: Item }) => {
        const badge = item.kind.toUpperCase();
        return (
            <Pressable style={styles.card} onPress={() => openDetails(item)}>
                <View style={styles.cardRow}>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{badge}</Text>
                    </View>

                    <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                            {item.title}
                        </Text>
                        <Text style={styles.cardSub} numberOfLines={2} ellipsizeMode="tail">
                            {item.line1}
                        </Text>
                        <Text style={styles.cardSub} numberOfLines={1} ellipsizeMode="tail">
                            {item.line2}
                        </Text>
                    </View>
                </View>
            </Pressable>
        );
    };

    const TOP_PAD = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 12;

    return (
        <SafeAreaView style={[styles.container, { paddingTop: TOP_PAD }]}>
            {/* header (centered) */}
            <View style={styles.topBar}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.topLeft}>
                    <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                </Pressable>

                <Text style={styles.topTitle}>{title}</Text>

                <Pressable onPress={() => setCreateOpen(true)} hitSlop={10} style={styles.topRight}>
                    <MaterialIcons name="add" size={24} color={COLORS.text} />
                </Pressable>
            </View>

            {/* search */}
            <View style={styles.searchBox}>
                <MaterialIcons name="search" size={20} color={COLORS.subtle} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search DIDs, credentials, presentations"
                    placeholderTextColor={COLORS.subtle}
                    style={styles.searchInput}
                />
            </View>

            {/* chips */}
            <View style={styles.chipsRow}>
                {CHIPS.map((c) => {
                    const active = c.value === kind;
                    return (
                        <Pressable
                            key={c.value}
                            onPress={() => setKind(c.value)}
                            style={[styles.chip, active && styles.chipActive]}
                        >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                        </Pressable>
                    );
                })}
            </View>

            {/* list */}
            {loading ? (
                <View style={{ paddingTop: 18 }}>
                    <ActivityIndicator />
                </View>
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(x) => `${x.kind}:${x.id}`}
                    renderItem={renderItem}
                    contentContainerStyle={{ paddingVertical: 12, paddingBottom: 20 }}
                    ListEmptyComponent={<Text style={styles.empty}>No items yet</Text>}
                />
            )}

            <CreateItem
                visible={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreateDid={() => {
                    setCreateOpen(false);
                    navigation.navigate("CreateDid");
                }}
                onCreateVc={() => {
                    setCreateOpen(false);
                    navigation.navigate("CreateCredential");
                }}
                onCreateVp={() => {
                    setCreateOpen(false);
                    navigation.navigate("CreatePresentation");
                }}
            />

            <ItemDetailsPopup
                visible={detailsOpen}
                item={selected}
                loading={detailsLoading}
                error={detailsError}
                data={detailsData}
                onClose={closeDetails}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingBottom: 16 },

    topBar: {
        height: 48,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 12,
    },
    topLeft: { position: "absolute", left: 0, padding: 4 },
    topRight: { position: "absolute", right: 0, padding: 4 },
    topTitle: { color: COLORS.text, fontSize: 18, fontWeight: "600" },

    searchBox: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: COLORS.card,
    },
    searchInput: { flex: 1, fontSize: 13, color: COLORS.text },

    chipsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
        backgroundColor: COLORS.card,
    },
    chipActive: { backgroundColor: COLORS.accentBg, borderColor: COLORS.accentBorder },
    chipText: { fontSize: 12, color: COLORS.text, fontWeight: "700" },
    chipTextActive: { color: COLORS.accentText },

    card: {
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 10,
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

    cardTitle: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    cardSub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },

    empty: { color: COLORS.subtle, marginTop: 14, textAlign: "center" },
});