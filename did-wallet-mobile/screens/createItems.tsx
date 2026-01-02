import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, Animated, Easing } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

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
    showChevron = true,
}: {
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    onPress: () => void;
    showChevron?: boolean;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]}
        >
            <View style={styles.itemLeft}>
                <MaterialIcons name={icon} size={22} color="#111827" />
            </View>

            <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{title}</Text>
                <Text style={styles.itemSub}>{subtitle}</Text>
            </View>

            {showChevron ? (
                <MaterialIcons name="chevron-right" size={24} color="#6B7280" />
            ) : null}
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
    const translateY = useRef(new Animated.Value(420)).current;
    const [mounted, setMounted] = useState(visible);

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
            <Pressable style={styles.overlay} onPress={onClose} />

            <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
                <View style={styles.handle} />
                <Text style={styles.title}>Choose what to create</Text>

                <View style={styles.card}>
                    <SheetItem
                        title="New DID"
                        subtitle="Create a new decentralized identifier"
                        icon="badge"
                        onPress={onCreateDid}
                    />
                    <View style={styles.divider} />
                    <SheetItem
                        title="New Credential"
                        subtitle="Issue or import a verifiable credential"
                        icon="verified"
                        onPress={onCreateVc}
                    />
                    <View style={styles.divider} />
                    <SheetItem
                        title="New Presentation"
                        subtitle="Create a verifiable presentation (ZKP)"
                        icon="assignment"
                        onPress={onCreateVp}
                    />
                </View>
            </Animated.View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
    sheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2,
        backgroundColor: "#FFFFFF",
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        paddingTop: 10,
        paddingHorizontal: 16,
        paddingBottom: 18,
    },
    handle: {
        alignSelf: "center",
        width: 56,
        height: 5,
        borderRadius: 999,
        backgroundColor: "#111827",
        opacity: 0.25,
        marginBottom: 12,
    },
    title: { fontSize: 18, fontWeight: "600", marginBottom: 12, color: "#111827" },
    card: {
        borderRadius: 16,
        backgroundColor: "#F3E8FF",
        overflow: "hidden",
    },
    divider: { height: 1, backgroundColor: "rgba(17,24,39,0.08)" },
    item: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
    itemLeft: { width: 32, alignItems: "center", marginRight: 10 },
    itemTitle: { fontSize: 16, fontWeight: "600", color: "#111827" },
    itemSub: { marginTop: 3, fontSize: 13, color: "#4B5563" },
});
