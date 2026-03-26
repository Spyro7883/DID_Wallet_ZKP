import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Modal,
    View,
    Text,
    Pressable,
    StyleSheet,
    Animated,
    Easing,
    ActivityIndicator,
    Alert,
    Platform,
} from "react-native";
import { loadLastWallet, saveHolderSession } from "../src/storage/walletSession";
import { type AppColors } from "../src/theme/colors";
import { useAppTheme } from "../src/theme/AppThemeProvider";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

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

export default function ConnectIssuerSheet({
    visible,
    onClose,
    onPaired,
}: {
    visible: boolean;
    onClose: () => void;
    onPaired?: () => void;
}) {
    const { colors, resolvedMode } = useAppTheme();
    const COLORS = colors;
    const styles = useMemo(() => createStyles(COLORS), [COLORS]);

    const translateY = useRef(new Animated.Value(420)).current;
    const [mounted, setMounted] = useState(visible);
    const [loading, setLoading] = useState(false);

    const theme = useMemo(() => {
        const isDark = resolvedMode === "dark";
        return {
            overlay: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
            handle: isDark ? "rgba(255,255,255,0.35)" : "rgba(17,24,39,0.25)",
        };
    }, [resolvedMode]);

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
            }).start(({ finished }) => finished && setMounted(false));
        }
    }, [visible, mounted, translateY]);

    if (!mounted) return null;

    const onPair = async () => {
        if (!BASE_URL) {
            notify("Error", "Missing EXPO_PUBLIC_API_BASE_URL");
            return;
        }

        setLoading(true);
        try {
            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                notify("Auth", "Missing wallet session.");
                onClose();
                return;
            }

            const sumResp = await fetch(`${BASE_URL}/wallets/summary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    limit: 1,
                }),
            });
            const sumJson = await sumResp.json();
            if (!sumResp.ok || !sumJson.ok || !sumJson.activeDid) {
                throw new Error("Could not read active DID");
            }

            const holderDid = String(sumJson.activeDid);

            const chResp = await fetch(`${BASE_URL}/connect/challenge`);
            const chJson = await chResp.json();
            if (!chResp.ok || !chJson?.id || !chJson?.challenge) {
                throw new Error("challenge_failed");
            }

            const payload = { id: chJson.id, challenge: chJson.challenge, ts: Date.now() };
            const { sig, alg } = await signPayload(holderDid, payload);

            const cfResp = await fetch(`${BASE_URL}/connect/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: chJson.id, holderDid, payload, sig, alg }),
            });
            const cfJson = await cfResp.json();
            if (!cfResp.ok || !cfJson.ok || !cfJson.token) {
                throw new Error(cfJson.error || "pair_failed");
            }

            await saveHolderSession(sess.profileName, {
                holderToken: String(cfJson.token),
                holderDid: String(cfJson.holderDid || holderDid),
                issuerDid: String(cfJson.issuerDid || ""),
            });

            notify("Paired", "Holder token saved.");
            onPaired?.();
            onClose();
        } catch (e: any) {
            console.error("[pair] error", e);
            notify("Error", e?.message || "pair_failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose}>
            <Pressable
                style={[styles.overlay, { backgroundColor: theme.overlay }]}
                onPress={!loading ? onClose : undefined}
            />

            <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
                <View style={[styles.handle, { backgroundColor: theme.handle }]} />

                <Text style={styles.title}>Connect issuer</Text>
                <Text style={styles.sub}>
                    Pair this wallet with an issuer to obtain a holder token. You will sign a short challenge using your active DID.
                </Text>

                <Pressable
                    style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
                    onPress={onPair}
                    disabled={loading}
                >
                    {loading ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <ActivityIndicator />
                            <Text style={styles.primaryText}>Pairing…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryText}>Pair now</Text>
                    )}
                </Pressable>

                <Pressable
                    style={[styles.secondaryBtn, loading && { opacity: 0.6 }]}
                    onPress={onClose}
                    disabled={loading}
                >
                    <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
            </Animated.View>
        </Modal>
    );
}

const createStyles = (COLORS: AppColors) =>
    StyleSheet.create({
        overlay: {
            ...StyleSheet.absoluteFillObject,
        },

        sheet: {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: COLORS.bg,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 10,
            paddingHorizontal: 16,
            paddingBottom: 18,
            borderWidth: 1,
            borderColor: COLORS.border,
        },
        handle: {
            alignSelf: "center",
            width: 56,
            height: 5,
            borderRadius: 999,
            marginBottom: 12,
        },

        title: {
            fontSize: 18,
            fontWeight: "600",
            color: COLORS.text,
            marginBottom: 6,
        },
        sub: {
            fontSize: 12,
            color: COLORS.muted,
            lineHeight: 16,
        },

        primaryBtn: {
            marginTop: 14,
            backgroundColor: COLORS.accentBg,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
        },
        primaryText: {
            color: COLORS.accentText,
            fontWeight: "600",
            fontSize: 14,
        },

        secondaryBtn: {
            marginTop: 10,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
        },
        secondaryText: {
            color: COLORS.text,
            fontWeight: "600",
        },
    });