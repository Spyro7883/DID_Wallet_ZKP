import React, { useState } from "react";
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Pressable,
    Alert,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context"
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../src/navigation/types"; // IMPORTANT
import { saveLastWallet } from "../src/storage/walletSession";

const BASE_URL = "http://localhost:5501";

const CreateIdentity: React.FC = () => {
    const navigation =
        useNavigation<NativeStackNavigationProp<RootStackParamList>>();

    const [identityName, setIdentityName] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const handleSubmit = async () => {
        if (!identityName) {
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
                    profile: identityName,
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

    return (
        <SafeAreaProvider style={styles.container}>
            <View style={styles.headerRow}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
                    <MaterialIcons name="arrow-back" size={24} />
                </Pressable>
                <Text style={styles.headerTitle}>Create new identity</Text>
                <View style={{ width: 24 }} />
            </View>

            <Text style={styles.subtitle}>
                It will be stored encrypted on this device
            </Text>

            <View style={styles.form}>
                <View style={styles.field}>
                    <Text style={styles.label}>Identity name</Text>
                    <TextInput
                        value={identityName}
                        onChangeText={setIdentityName}
                        placeholder="Citizen"
                        style={styles.input}
                        placeholderTextColor="#6B7280"
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
                            placeholderTextColor="#6B7280"
                        />
                        <Pressable onPress={() => setShowPassword((v) => !v)}>
                            <MaterialIcons
                                name={showPassword ? "visibility-off" : "visibility"}
                                size={22}
                                color="#6B7280"
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
                            placeholderTextColor="#6B7280"
                        />
                        <Pressable onPress={() => setShowConfirm((v) => !v)}>
                            <MaterialIcons
                                name={showConfirm ? "visibility-off" : "visibility"}
                                size={22}
                                color="#6B7280"
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
        </SafeAreaProvider>
    );
};

export default CreateIdentity;

const INPUT_BG = "#F3E8FF";

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#FFFFFF",
        paddingHorizontal: 24,
        paddingTop: 12,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 8,
    },
    headerTitle: {
        flex: 1,
        textAlign: "center",
        fontSize: 20,
        fontWeight: "600",
    },
    subtitle: {
        fontSize: 13,
        color: "#6B7280",
        marginTop: 4,
        marginBottom: 24,
    },
    form: {
        gap: 16,
        marginBottom: 32,
    },
    field: {},
    label: {
        fontSize: 12,
        color: "#4B5563",
        marginBottom: 4,
    },
    input: {
        backgroundColor: INPUT_BG,
        borderRadius: 4,
        paddingHorizontal: 10,
        paddingVertical: 10,
        fontSize: 14,
    },
    inputWithIcon: {
        backgroundColor: INPUT_BG,
        borderRadius: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    inputInner: {
        flex: 1,
        fontSize: 14,
        paddingVertical: 4,
        paddingRight: 8,
    },
    primaryButton: {
        backgroundColor: INPUT_BG,
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: "center",
        marginBottom: 8,
    },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: "500",
    },
    footerText: {
        fontSize: 11,
        color: "#6B7280",
    },
});
