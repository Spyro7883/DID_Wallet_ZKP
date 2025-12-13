import React from "react";
import {
    SafeAreaView,
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../App"; // ajustează path-ul dacă e altul

type WalletItem = {
    id: string;
    title: string;
    subject: string;
    issuedAt: string;
};

type WalletRouteProp = RouteProp<RootStackParamList, "Wallet">;

const MOCK_ITEMS: WalletItem[] = [
    {
        id: "1",
        title: "[Credential] EmploymentCredential",
        subject: "Subject: did:ethr:0x12…ab34",
        issuedAt: "Issued: 2025-03-01",
    },
    {
        id: "2",
        title: "[Credential] EmploymentCredential",
        subject: "Subject: did:ethr:0x12…ab34",
        issuedAt: "Issued: 2025-03-01",
    },
    {
        id: "3",
        title: "[Credential] EmploymentCredential",
        subject: "Subject: did:ethr:0x12…ab34",
        issuedAt: "Issued: 2025-03-01",
    },
];

const WalletScreen: React.FC = () => {
    const route = useRoute<WalletRouteProp>();
    const navigation = useNavigation<any>();

    const profileName = route.params?.profileName ?? "user";

    // deocamdată date mock
    const activeDid = "did:ethr:0x1234…abcd";
    const stats = { dids: 3, vcs: 5, vps: 2 };
    const recentItems = MOCK_ITEMS;

    const handleOpenSettings = () => {
        // aici vei naviga spre Settings când îl faci
        console.log("Open settings");
    };

    const handleOpenWalletItems = () => {
        // aici vei naviga spre pagina cu toate item-urile
        console.log("Open wallet items");
    };

    const handleViewAll = () => {
        console.log("View all recent items");
    };

    const handlePressItem = (item: WalletItem) => {
        console.log("Open item:", item.id);
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.content}>
                {/* header */}
                <View style={styles.headerRow}>
                    <Text style={styles.headerTitle}>Wallet: {profileName}</Text>
                    <Pressable onPress={handleOpenSettings} hitSlop={8}>
                        <MaterialIcons name="settings" size={22} color="#111827" />
                    </Pressable>
                </View>

                {/* card identitate */}
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

                {/* buton mare */}
                <Pressable
                    style={styles.primaryButton}
                    onPress={handleOpenWalletItems}
                >
                    <Text style={styles.primaryButtonText}>Open Wallet Items</Text>
                </Pressable>

                {/* Recent items header */}
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Recent Items</Text>
                    <Pressable onPress={handleViewAll} hitSlop={4}>
                        <Text style={styles.sectionLink}>View All</Text>
                    </Pressable>
                </View>

                {/* Lista de iteme */}
                <View style={styles.itemsList}>
                    {recentItems.map((item) => (
                        <Pressable
                            key={item.id}
                            style={styles.itemCard}
                            onPress={() => handlePressItem(item)}
                        >
                            <Text style={styles.itemTitle}>{item.title}</Text>
                            <Text style={styles.itemSubtitle}>
                                {item.subject} · {item.issuedAt}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

export default WalletScreen;

const CARD_BG = "#F9FAFB";
const ACCENT_BG = "#F3E8FF";

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#FFFFFF",
    },
    content: {
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 24,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "600",
    },
    identityCard: {
        backgroundColor: CARD_BG,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        marginBottom: 16,
    },
    identityName: {
        fontSize: 16,
        fontWeight: "600",
        marginBottom: 4,
    },
    identityLabel: {
        fontSize: 12,
        color: "#6B7280",
    },
    identityDid: {
        fontSize: 12,
        color: "#4B5563",
        marginTop: 2,
        marginBottom: 8,
    },
    identityStatsRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 4,
    },
    identityStat: {
        fontSize: 12,
        color: "#4B5563",
    },
    primaryButton: {
        backgroundColor: ACCENT_BG,
        borderRadius: 999,
        paddingVertical: 12,
        alignItems: "center",
        marginBottom: 24,
    },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: "500",
    },
    sectionHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "600",
    },
    sectionLink: {
        fontSize: 12,
        color: "#6366F1",
        fontWeight: "500",
    },
    itemsList: {
        gap: 10,
    },
    itemCard: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },
    itemTitle: {
        fontSize: 13,
        fontWeight: "600",
        marginBottom: 2,
    },
    itemSubtitle: {
        fontSize: 11,
        color: "#6B7280",
    },
});
