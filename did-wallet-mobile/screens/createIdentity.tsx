import React, { useMemo, useState } from "react";
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Pressable,
    Alert,
    Platform,
    StatusBar,
    ScrollView,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../src/navigation/types";
import { saveLastWallet } from "../src/storage/walletSession";
import { type AppColors } from "../src/theme/colors";
import { useAppTheme } from "../src/theme/AppThemeProvider";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const CreateIdentity: React.FC = () => {
    const { colors } = useAppTheme();
    const COLORS = colors;
    const styles = useMemo(() => createStyles(COLORS), [COLORS]);

    const navigation =
        useNavigation<NativeStackNavigationProp<RootStackParamList>>();

    const [identityName, setIdentityName] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const handleSubmit = async () => {
        if (!identityName.trim()) {
            Alert.alert("Error", "Please enter an identity name.");
            return;
        }

        if (!password || password.length < 6) {
            Alert.alert("Error", "Password must be at least 6 characters.");
            return;
        }

        if (password !== confirm) {
            Alert.alert("Error", "Passwords do not match.");
            return;
        }

        try {
            const resp = await fetch(`${BASE_URL}/wallets`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: identityName.trim(),
                    passphrase: password,
                }),
            });

            const json = await resp.json();
            if (!resp.ok || !json.ok) {
                Alert.alert(
                    "Error",
                    json.error || "Could not create wallet on server."
                );
                return;
            }

            Alert.alert("Success", `Wallet "${json.profile}" created.`);
            await saveLastWallet(json.profile, password);

            navigation.reset({
                index: 0,
                routes: [{ name: "Wallet", params: { profileName: json.profile } }],
            });
        } catch (e) {
            console.error(e);
            Alert.alert(
                "Error",
                "Network error while creating wallet. Is the server running?"
            );
        }
    };

    const TOP_PAD = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 12;

    return (
        <SafeAreaView
            style={[styles.container, { paddingTop: TOP_PAD }]}
            edges={["top", "left", "right"]}
        >
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.topBar}>
                    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.topLeft}>
                        <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                    </Pressable>

                    <Text style={styles.topTitle}>Create new identity</Text>

                    <View style={styles.topRight} />
                </View>

                <Text style={styles.subtitle}>
                    It will be stored encrypted on this device
                </Text>

                <View style={styles.card}>
                    <View style={styles.field}>
                        <Text style={styles.label}>Identity name</Text>
                        <TextInput
                            value={identityName}
                            onChangeText={setIdentityName}
                            placeholder="Citizen"
                            style={styles.input}
                            placeholderTextColor={COLORS.subtle}
                            {...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {})}
                        />
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>Wallet password</Text>
                        <View style={styles.inputWithIcon}>
                            <TextInput
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry={!showPassword}
                                style={styles.inputInner}
                                placeholder="••••••••"
                                placeholderTextColor={COLORS.subtle}
                                {...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {})}
                            />
                            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                                <MaterialIcons
                                    name={showPassword ? "visibility-off" : "visibility"}
                                    size={22}
                                    color={COLORS.subtle}
                                />
                            </Pressable>
                        </View>
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>Confirm password</Text>
                        <View style={styles.inputWithIcon}>
                            <TextInput
                                value={confirm}
                                onChangeText={setConfirm}
                                secureTextEntry={!showConfirm}
                                style={styles.inputInner}
                                placeholder="••••••••"
                                placeholderTextColor={COLORS.subtle}
                                {...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {})}
                            />
                            <Pressable onPress={() => setShowConfirm((v) => !v)} hitSlop={8}>
                                <MaterialIcons
                                    name={showConfirm ? "visibility-off" : "visibility"}
                                    size={22}
                                    color={COLORS.subtle}
                                />
                            </Pressable>
                        </View>
                    </View>
                </View>

                <Pressable style={styles.primaryButton} onPress={handleSubmit}>
                    <Text style={styles.primaryButtonText}>Create identity</Text>
                </Pressable>

                <Text style={styles.footerText}>
                    If you forget this password, you may lose access to your wallet.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
};

export default CreateIdentity;

const createStyles = (COLORS: AppColors) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: COLORS.bg,
        },
        content: {
            paddingHorizontal: 16,
            paddingBottom: 24,
        },

        topBar: {
            height: 48,
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 8,
        },
        topLeft: {
            position: "absolute",
            left: 0,
            padding: 4,
        },
        topRight: {
            position: "absolute",
            right: 0,
            width: 28,
            height: 28,
        },
        topTitle: {
            flexShrink: 1,
            textAlign: "center",
            fontSize: 18,
            fontWeight: "600",
            color: COLORS.text,
        },

        subtitle: {
            fontSize: 12,
            color: COLORS.subtle,
            marginBottom: 14,
        },

        card: {
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
            marginBottom: 18,
            gap: 14,
        },

        field: {},
        label: {
            fontSize: 12,
            color: COLORS.muted,
            marginBottom: 6,
        },

        input: {
            backgroundColor: COLORS.inputBg,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 11,
            fontSize: 14,
            color: COLORS.text,
            borderWidth: 1,
            borderColor: COLORS.border,
        },

        inputWithIcon: {
            backgroundColor: COLORS.inputBg,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderWidth: 1,
            borderColor: COLORS.border,
        },
        inputInner: {
            flex: 1,
            fontSize: 14,
            paddingVertical: 4,
            paddingRight: 8,
            color: COLORS.text,
        },

        primaryButton: {
            backgroundColor: COLORS.accentBg,
            borderRadius: 14,
            paddingVertical: 13,
            alignItems: "center",
            marginBottom: 8,
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
        },
        primaryButtonText: {
            fontSize: 15,
            fontWeight: "600",
            color: COLORS.accentText,
        },

        footerText: {
            fontSize: 11,
            color: COLORS.subtle,
            textAlign: "center",
        },
    });