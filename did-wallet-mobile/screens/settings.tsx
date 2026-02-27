import React, { useEffect, useRef, useState, useMemo } from "react";
import {
    Modal,
    View,
    Text,
    Pressable,
    StyleSheet,
    Animated,
    Easing,
    Platform,
    useColorScheme,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS } from "../src/theme/colors";

type Props = {
    visible: boolean;
    onClose: () => void;
    onCreateBackup: () => void;
    onImportBackup: () => void;
    onLogout: () => void;
    onConnectIssuer: () => void;
};

function SheetItem({
    title,
    subtitle,
    icon,
    onPress,
    showChevron = true,
    destructive = false,
    iconColor,
    chevronColor,
    titleColor,
    subColor,
}: {
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    onPress: () => void;
    showChevron?: boolean;
    destructive?: boolean;
    iconColor: string;
    chevronColor: string;
    titleColor: string;
    subColor: string;
}) {
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]}>
            <View style={styles.itemLeft}>
                <MaterialIcons name={icon} size={22} color={destructive ? "#F87171" : iconColor} />
            </View>

            <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: destructive ? "#F87171" : titleColor }]}>{title}</Text>
                <Text style={[styles.itemSub, { color: subColor }]}>{subtitle}</Text>
            </View>

            {showChevron ? <MaterialIcons name="chevron-right" size={24} color={chevronColor} /> : null}
        </Pressable>
    );
}

export default function SettingsSheet({
    visible,
    onClose,
    onCreateBackup,
    onLogout,
    onConnectIssuer,
}: Props) {
    const translateY = useRef(new Animated.Value(420)).current;
    const [mounted, setMounted] = useState(visible);

    const scheme = useColorScheme();
    const isDark = scheme === "dark";

    const theme = useMemo(() => {
        return isDark
            ? {
                overlay: "rgba(0,0,0,0.55)",
                sheetBg: COLORS.bg,
                sheetBorder: COLORS.border,
                handle: "rgba(255,255,255,0.35)",
                title: COLORS.text,
                cardBg: COLORS.card,
                cardBorder: COLORS.border,
                divider: "rgba(229,231,235,0.10)",
                icon: COLORS.text,
                chevron: COLORS.subtle,
                itemTitle: COLORS.text,
                itemSub: COLORS.muted,
            }
            : {
                overlay: "rgba(0,0,0,0.35)",
                sheetBg: "#FFFFFF",
                sheetBorder: "rgba(17,24,39,0.08)",
                handle: "rgba(17,24,39,0.25)",
                title: "#111827",
                cardBg: COLORS.accentBg,
                cardBorder: "rgba(17,24,39,0.08)",
                divider: "rgba(17,24,39,0.08)",
                icon: "#111827",
                chevron: "#6B7280",
                itemTitle: "#111827",
                itemSub: "#4B5563",
            };
    }, [isDark]);

    useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.timing(translateY, {
                toValue: 0,
                duration: 220,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else if (mounted) {
            Animated.timing(translateY, {
                toValue: 420,
                duration: 180,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }
    }, [visible, mounted, translateY]);

    if (!mounted) return null;

    return (
        <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose}>
            <Pressable style={[styles.overlay, { backgroundColor: theme.overlay }]} onPress={onClose} />

            <Animated.View
                style={[
                    styles.sheet,
                    {
                        transform: [{ translateY }],
                        backgroundColor: theme.sheetBg,
                        borderColor: theme.sheetBorder,
                    },
                ]}
            >
                <View style={[styles.handle, { backgroundColor: theme.handle }]} />

                <Text style={[styles.title, { color: theme.title }]}>Settings</Text>

                <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                    <SheetItem
                        title="Create backup"
                        subtitle="Export an encrypted backup file"
                        icon="backup"
                        onPress={() => {
                            onClose();
                            onCreateBackup();
                        }}
                        showChevron
                        iconColor={theme.icon}
                        chevronColor={theme.chevron}
                        titleColor={theme.itemTitle}
                        subColor={theme.itemSub}
                    />

                    <View style={[styles.divider, { backgroundColor: theme.divider }]} />

                    <SheetItem
                        title="Connect issuer"
                        subtitle="Pair to obtain holder token"
                        icon="link"
                        onPress={() => {
                            onClose();
                            onConnectIssuer();
                        }}
                        showChevron
                        iconColor={theme.icon}
                        chevronColor={theme.chevron}
                        titleColor={theme.itemTitle}
                        subColor={theme.itemSub}
                    />

                    <View style={[styles.divider, { backgroundColor: theme.divider }]} />

                    <SheetItem
                        title="Logout"
                        subtitle="End this session on this device"
                        icon="logout"
                        onPress={() => {
                            onClose();
                            onLogout();
                        }}
                        showChevron={false}
                        destructive
                        iconColor={theme.icon}
                        chevronColor={theme.chevron}
                        titleColor={theme.itemTitle}
                        subColor={theme.itemSub}
                    />
                </View>

                <View style={{ height: Platform.OS === "ios" ? 8 : 0 }} />
            </Animated.View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject },

    sheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        paddingTop: 10,
        paddingHorizontal: 16,
        paddingBottom: 18,
        borderWidth: 1,
    },

    handle: {
        alignSelf: "center",
        width: 56,
        height: 5,
        borderRadius: 999,
        marginBottom: 12,
    },

    title: { fontSize: 20, fontWeight: "600", marginBottom: 12 },

    card: {
        borderRadius: 16,
        overflow: "hidden",
        borderWidth: 1,
    },
    divider: { height: 1 },

    item: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    itemLeft: { width: 32, alignItems: "center", marginRight: 10 },

    itemTitle: { fontSize: 16, fontWeight: "600" },
    itemSub: { marginTop: 3, fontSize: 13 },
});