import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";

import {
    SafeAreaView,
    View,
    Text,
    StyleSheet,
    Pressable,
    TextInput,
    FlatList,
    ActivityIndicator,
    Alert,
    Platform,
    Modal,
    ScrollView
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { RootStackParamList, WalletKind } from "../src/navigation/types";
import { loadLastWallet } from "../src/storage/walletSession";
import CreateItem from "./createItems";
import { ItemDetailsPopup } from "./itemDetailsPopup";

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

    const renderItem = ({ item }: { item: Item }) => {
        const badge = item.kind.toUpperCase();
        return (
            <Pressable
                style={styles.card}
                onPress={() => openDetails(item)}
            >
                <View style={styles.cardRow}>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{badge}</Text>
                    </View>

                    <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                            {item.title}
                        </Text>
                        <Text style={styles.cardSub} numberOfLines={2}>
                            {item.line1}
                        </Text>
                        <Text style={styles.cardSub} numberOfLines={1}>
                            {item.line2}
                        </Text>
                    </View>
                </View>
            </Pressable>
        );
    };

    const closeDetails = () => {
        setDetailsOpen(false);
        setSelected(null);
        setDetailsLoading(false);
        setDetailsError("");
        setDetailsData(null);
    };

    const openDetails = useCallback(async (it: Item) => {
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
    }, [navigation]);


    return (
        <SafeAreaView style={styles.container}>
            {/* header */}
            <View style={styles.headerRow}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
                    <MaterialIcons name="arrow-back" size={24} color="#111827" />
                </Pressable>

                <Text style={styles.headerTitle}>Wallet items</Text>

                <Pressable onPress={() => setCreateOpen(true)} hitSlop={10}>
                    <MaterialIcons name="add" size={24} color="#111827" />
                </Pressable>
            </View>

            {/* search */}
            <View style={styles.searchBox}>
                <MaterialIcons name="search" size={20} color="#6B7280" />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search DIDs, credentials, presentations"
                    placeholderTextColor="#6B7280"
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
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                {c.label}
                            </Text>
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
                    contentContainerStyle={{ paddingVertical: 12 }}
                    ListEmptyComponent={
                        <Text style={styles.empty}>No items yet</Text>
                    }
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

const ACCENT_BG = "#F3E8FF";
const BORDER = "#E5E7EB";

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#FFFFFF", paddingHorizontal: 24 },
    headerRow: {
        paddingTop: 12,
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitle: { fontSize: 18, fontWeight: "600", color: "#111827" },

    searchBox: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: "#FFFFFF",
    },
    searchInput: { flex: 1, fontSize: 13, color: "#111827" },

    chipsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: "#FFFFFF",
    },
    chipActive: { backgroundColor: ACCENT_BG, borderColor: "#D8B4FE" },
    chipText: { fontSize: 12, color: "#374151", fontWeight: "500" },
    chipTextActive: { color: "#111827" },

    card: {
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 10,
        backgroundColor: "#FFFFFF",
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

    cardTitle: { fontSize: 13, fontWeight: "700", color: "#111827" },
    cardSub: { fontSize: 11, color: "#6B7280", marginTop: 2 },

    empty: { color: "#9CA3AF", marginTop: 14, textAlign: "center" },
});
