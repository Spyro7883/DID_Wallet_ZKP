import React from "react";
import { SafeAreaView, View, Text, Pressable, Platform, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { loadLastWallet, saveHolderSession } from "../src/storage/walletSession";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export default function ConnectIssuer() {
    const navigation = useNavigation<any>();
    const [loading, setLoading] = React.useState(false);

    function notify(title: string, msg: string) {
        if (Platform.OS === "web") {
            window.alert(`${title}\n\n${msg}`);
        } else {
            Alert.alert(title, msg);
        }
    }

    async function signPayload(holderDid: string, payload: any): Promise<{ sig: string; alg: string }> {
        const sess = await loadLastWallet();
        if (!sess?.profileName || !sess?.passphrase) throw new Error("missing_wallet_session");
        if (!BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

        const resp = await fetch(`${BASE_URL}/wallets/sign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                profile: sess.profileName,
                passphrase: sess.passphrase,
                did: holderDid,
                payload,
            }),
        });

        const json = await resp.json();
        if (!resp.ok || !json.ok) throw new Error(json.error || json.message || "sign_failed");

        return { sig: String(json.sig), alg: String(json.alg || "") };
    }

    const onPair = async () => {
        console.log("[pair] start", { BASE_URL });

        if (!BASE_URL) {
            notify("Error", "Missing EXPO_PUBLIC_API_BASE_URL");
            return;
        }

        setLoading(true);
        try {
            const sess = await loadLastWallet();
            console.log("[pair] session", sess);

            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const sumResp = await fetch(`${BASE_URL}/wallets/summary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profile: sess.profileName, passphrase: sess.passphrase, limit: 1 }),
            });
            const sumJson = await sumResp.json();
            console.log("[pair] summary", sumJson);

            if (!sumResp.ok || !sumJson.ok || !sumJson.activeDid) throw new Error("Could not read active DID");
            const holderDid = String(sumJson.activeDid);

            const chResp = await fetch(`${BASE_URL}/connect/challenge`);
            const chJson = await chResp.json();
            console.log("[pair] challenge", chJson);

            if (!chResp.ok || !chJson?.id || !chJson?.challenge) throw new Error("challenge_failed");

            const payload = { id: chJson.id, challenge: chJson.challenge, ts: Date.now() };

            const { sig, alg } = await signPayload(holderDid, payload);
            console.log("[pair] signed", { alg, sigLen: sig.length });

            const cfResp = await fetch(`${BASE_URL}/connect/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: chJson.id, holderDid, payload, sig, alg }),
            });
            const cfJson = await cfResp.json();
            console.log("[pair] confirm", cfJson);

            if (!cfResp.ok || !cfJson.ok || !cfJson.token) throw new Error(cfJson.error || "pair_failed");

            await saveHolderSession(sess.profileName, {
                holderToken: String(cfJson.token),
                holderDid: String(cfJson.holderDid || holderDid),
                issuerDid: String(cfJson.issuerDid || ""),
            });

            notify("Paired", "Holder token saved.");
            navigation.goBack();
        } catch (e: any) {
            console.error("[pair] error", e);
            notify("Error", e?.message || "pair_failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <Text style={styles.title}>Connect to issuer</Text>
            <Pressable style={[styles.btn, loading && { opacity: 0.6 }]} onPress={onPair} disabled={loading}>
                {loading ? <ActivityIndicator /> : <Text style={styles.btnText}>Pair now</Text>}
            </Pressable>

            <Pressable style={styles.link} onPress={() => navigation.goBack()} disabled={loading}>
                <Text style={styles.linkText}>Back</Text>
            </Pressable>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 24, backgroundColor: "#0B0F14", justifyContent: "center" },
    title: { color: "white", fontSize: 18, fontWeight: "800", marginBottom: 14 },
    btn: { backgroundColor: "#F3E8FF", paddingVertical: 12, borderRadius: 14, alignItems: "center" },
    btnText: { color: "#111827", fontWeight: "800" },
    link: { marginTop: 12, alignItems: "center" },
    linkText: { color: "white", fontWeight: "700" },
});