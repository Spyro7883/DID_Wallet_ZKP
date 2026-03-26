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
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { type AppColors } from "../src/theme/colors";
import { useAppTheme } from "../src/theme/AppThemeProvider";

type Props = {
    visible: boolean;
    onClose: () => void;
    onCreateDid: () => void;
    onCreateVc: () => void;
    onCreateVp: () => void;
};

function SheetItem({
    title,
    subtitle,
    icon,
    onPress,
    iconColor,
    chevronColor,
    titleColor,
    subColor,
    styles,
}: {
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    onPress: () => void;
    iconColor: string;
    chevronColor: string;
    titleColor: string;
    subColor: string;
    styles: ReturnType<typeof createStyles>;
}) {
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]}>
            <View style={styles.itemLeft}>
                <MaterialIcons name={icon} size={22} color={iconColor} />
            </View>

            <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: titleColor }]}>{title}</Text>
                <Text style={[styles.itemSub, { color: subColor }]}>{subtitle}</Text>
            </View>

            <MaterialIcons name="chevron-right" size={24} color={chevronColor} />
        </Pressable>
    );
}

export default function CreateItemSheet({
    visible,
    onClose,
    onCreateDid,
    onCreateVc,
    onCreateVp,
}: Props) {
    const { colors, resolvedMode } = useAppTheme();
    const COLORS = colors;
    const styles = useMemo(() => createStyles(COLORS), [COLORS]);

    const translateY = useRef(new Animated.Value(420)).current;
    const [mounted, setMounted] = useState(visible);

    const isDark = resolvedMode === "dark";

    const theme = useMemo(() => {
        return {
            overlay: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
            sheetBg: COLORS.bg,
            sheetBorder: COLORS.border,
            handle: isDark ? "rgba(255,255,255,0.35)" : "rgba(17,24,39,0.25)",
            title: COLORS.text,
            sub: COLORS.muted,
            cardBg: COLORS.card,
            cardBorder: COLORS.border,
            divider: isDark ? "rgba(229,231,235,0.10)" : "rgba(17,24,39,0.08)",
            icon: COLORS.accentText,
            chevron: COLORS.subtle,
            itemTitle: COLORS.text,
            itemSub: COLORS.muted,
        };
    }, [COLORS, isDark]);

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

                <Text style={[styles.title, { color: theme.title }]}>Create item</Text>
                <Text style={[styles.subtitle, { color: theme.sub }]}>
                    Choose what you want to add to this wallet
                </Text>

                <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                    <SheetItem
                        title="New DID"
                        subtitle="Create a new decentralized identifier"
                        icon="badge"
                        onPress={() => {
                            onClose();
                            onCreateDid();
                        }}
                        iconColor={theme.icon}
                        chevronColor={theme.chevron}
                        titleColor={theme.itemTitle}
                        subColor={theme.itemSub}
                        styles={styles}
                    />

                    <View style={[styles.divider, { backgroundColor: theme.divider }]} />

                    <SheetItem
                        title="New Credential"
                        subtitle="Issue or import a verifiable credential"
                        icon="verified"
                        onPress={() => {
                            onClose();
                            onCreateVc();
                        }}
                        iconColor={theme.icon}
                        chevronColor={theme.chevron}
                        titleColor={theme.itemTitle}
                        subColor={theme.itemSub}
                        styles={styles}
                    />
                </View>

                <View style={{ height: Platform.OS === "ios" ? 8 : 0 }} />
            </Animated.View>
        </Modal>
    );
}

const createStyles = (COLORS: AppColors) =>
    StyleSheet.create({
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

        title: {
            fontSize: 20,
            fontWeight: "600",
            marginBottom: 4,
        },
        subtitle: {
            fontSize: 13,
            marginBottom: 12,
        },

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
        itemLeft: {
            width: 32,
            alignItems: "center",
            marginRight: 10,
        },

        itemTitle: {
            fontSize: 16,
            fontWeight: "600",
        },
        itemSub: {
            marginTop: 3,
            fontSize: 13,
        },
    });