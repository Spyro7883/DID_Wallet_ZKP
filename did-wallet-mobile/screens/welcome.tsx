import React, { useMemo } from "react";
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Platform,
    StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import { type AppColors } from "../src/theme/colors";
import { useAppTheme } from "../src/theme/AppThemeProvider";

const Welcome: React.FC = () => {
    const { colors } = useAppTheme();
    const COLORS = colors;
    const styles = useMemo(() => createStyles(COLORS), [COLORS]);

    const navigation = useNavigation<any>();
    const TOP_PAD = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 12;

    return (
        <SafeAreaView style={[styles.container, { paddingTop: TOP_PAD }]} edges={["top", "left", "right"]}>
            <View style={styles.content}>
                <View style={styles.heroCard}>
                    <Text style={styles.title}>Welcome to DID Wallet</Text>
                    <Text style={styles.subtitle}>
                        Create or import your decentralized identity.
                    </Text>
                </View>

                <View style={{ flex: 1 }} />

                <View style={styles.buttons}>
                    <Pressable
                        style={styles.button}
                        onPress={() => navigation.navigate("CreateIdentity")}
                    >
                        <Text style={styles.buttonText}>Create new identity</Text>
                    </Pressable>

                    <Pressable
                        style={styles.secondaryButton}
                        onPress={() => navigation.navigate("ImportBackup")}
                    >
                        <Text style={styles.secondaryButtonText}>Import existing identity</Text>
                    </Pressable>
                </View>
            </View>
        </SafeAreaView>
    );
};

export default Welcome;

const createStyles = (COLORS: AppColors) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: COLORS.bg,
        },
        content: {
            flex: 1,
            paddingHorizontal: 16,
            paddingBottom: 24,
        },
        heroCard: {
            marginTop: 24,
            borderRadius: 20,
            paddingHorizontal: 18,
            paddingVertical: 20,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
        },
        title: {
            fontSize: 22,
            fontWeight: "700",
            color: COLORS.text,
            marginBottom: 8,
            textAlign: "center",
        },
        subtitle: {
            fontSize: 14,
            color: COLORS.muted,
            textAlign: "center",
            lineHeight: 20,
        },
        buttons: {
            gap: 12,
            marginBottom: 24,
        },
        button: {
            backgroundColor: COLORS.accentBg,
            borderRadius: 16,
            paddingVertical: 14,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
        },
        buttonText: {
            fontSize: 15,
            fontWeight: "600",
            color: COLORS.accentText,
        },
        secondaryButton: {
            backgroundColor: COLORS.card,
            borderRadius: 16,
            paddingVertical: 14,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.border,
        },
        secondaryButtonText: {
            fontSize: 15,
            fontWeight: "600",
            color: COLORS.text,
        },
    });