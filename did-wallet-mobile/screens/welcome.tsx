import React from "react";
import {
    View,
    Text,
    StyleSheet,
    Pressable,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context"
import { useNavigation } from "@react-navigation/native";

const Welcome: React.FC = () => {
    const navigation = useNavigation<any>();

    return (
        <SafeAreaProvider style={styles.container}>
            <View style={styles.content}>
                <View style={styles.header}>
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

                    <Pressable style={styles.button} onPress={() => {
                        console.log("Import identity");
                    }}>
                        <Text style={styles.buttonText}>Import existing identity</Text>
                    </Pressable>
                </View>
            </View>
        </SafeAreaProvider>
    );
};

export default Welcome;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#FFFFFF",
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
        paddingVertical: 24,
    },
    header: {
        marginTop: 40,
        alignItems: "center",
    },
    title: {
        fontSize: 20,
        fontWeight: "600",
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14,
        color: "#6B7280",
        textAlign: "center",
    },
    buttons: {
        gap: 12,
        marginBottom: 40,
    },
    button: {
        backgroundColor: "#F3E8FF",
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: "center",
    },
    buttonText: {
        fontSize: 15,
        fontWeight: "500",
    },
});
