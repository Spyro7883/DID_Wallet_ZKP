import React, { useEffect, useMemo, useState, useRef } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    TextInput,
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    StatusBar,
    Animated,
    Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { loadLastWallet } from "../src/storage/walletSession";
import { ensureBackupsDir } from "../src/storage/backups";
import { COLORS } from "../src/theme/colors";

type Summary = {
    activeDid: string | null;
    stats: { dids: number; vcs: number; vps: number };
};

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

function shortDid(did: string, left = 16, right = 10) {
    if (!did) return "";
    if (did.length <= left + right + 3) return did;
    return `${did.slice(0, left)}...${did.slice(-right)}`;
}

function SuccessSheet({
    visible,
    filename,
    fileUri,
    onClose,
}: {
    visible: boolean;
    filename: string;
    fileUri: string | null;
    onClose: () => void;
}) {
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

    const canShare = !!fileUri;

    const onShare = async () => {
        if (!fileUri) return;
        try {
            const available = await Sharing.isAvailableAsync();
            if (!available) {
                Alert.alert("Not available", "Sharing is not available on this device.");
                return;
            }
            await Sharing.shareAsync(fileUri, {
                mimeType: "application/json",
                dialogTitle: "Share backup",
                UTI: "public.json",
            });
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not share file");
        }
    };

    if (!mounted) return null;

    return (
        <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose}>
            <Pressable style={styles.sheetOverlay} onPress={onClose} />

            <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>Backup created</Text>
                <Text style={styles.sheetSub} numberOfLines={1} ellipsizeMode="middle">
                    {filename}
                </Text>

                <View style={{ height: 14 }} />

                <Pressable
                    style={[styles.sheetBtn, !canShare && { opacity: 0.5 }]}
                    onPress={onShare}
                    disabled={!canShare}
                >
                    <MaterialIcons name="share" size={18} color={COLORS.accentText} />
                    <Text style={styles.sheetBtnText}>Share</Text>
                </Pressable>

                <Pressable style={[styles.sheetBtn, { marginTop: 10 }]} onPress={onClose}>
                    <MaterialIcons name="check" size={18} color={COLORS.accentText} />
                    <Text style={styles.sheetBtnText}>Done</Text>
                </Pressable>
            </Animated.View>
        </Modal>
    );
}

export default function BackupScreen() {
    const navigation = useNavigation<any>();

    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    const [profileName, setProfileName] = useState("");
    const [summary, setSummary] = useState<Summary>({
        activeDid: null,
        stats: { dids: 0, vcs: 0, vps: 0 },
    });

    const [useWalletPassword, setUseWalletPassword] = useState(true);
    const [backupPass, setBackupPass] = useState("");
    const [backupPass2, setBackupPass2] = useState("");
    const [showPass1, setShowPass1] = useState(false);
    const [showPass2, setShowPass2] = useState(false);
    const [touchedConfirm, setTouchedConfirm] = useState(false);
    const [submitAttempted, setSubmitAttempted] = useState(false);

    const [successOpen, setSuccessOpen] = useState(false);
    const [createdFilename, setCreatedFilename] = useState("");
    const [createdFileUri, setCreatedFileUri] = useState<string | null>(null);

    const mismatch = useMemo(() => {
        if (useWalletPassword) return false;
        if (!backupPass || !backupPass2) return false;
        return backupPass !== backupPass2;
    }, [useWalletPassword, backupPass, backupPass2]);

    const canCreate = useMemo(() => {
        if (creating) return false;
        if (useWalletPassword) return true;
        if (!backupPass || !backupPass2) return false;
        if (backupPass !== backupPass2) return false;
        return true;
    }, [creating, useWalletPassword, backupPass, backupPass2]);

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                setLoading(true);
                const sess = await loadLastWallet();

                if (!sess?.profileName || !sess?.passphrase) {
                    navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                    return;
                }

                if (!alive) return;
                setProfileName(sess.profileName);

                const resp = await fetch(`${BASE_URL}/wallets/summary`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        profile: sess.profileName,
                        passphrase: sess.passphrase,
                        limit: 0,
                    }),
                });

                const json = await resp.json();
                if (!resp.ok || !json.ok) throw new Error(json.error || "summary_failed");

                if (!alive) return;
                setSummary({
                    activeDid: json.activeDid ?? null,
                    stats: json.stats ?? { dids: 0, vcs: 0, vps: 0 },
                });
            } catch (e: any) {
                Alert.alert("Error", e?.message || "Could not load backup info");
            } finally {
                if (alive) setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [navigation]);

    const createBackup = async () => {
        setSubmitAttempted(true);
        if (!canCreate) return;

        try {
            setCreating(true);

            const sess = await loadLastWallet();
            if (!sess?.profileName || !sess?.passphrase) {
                navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
                return;
            }

            const resp = await fetch(`${BASE_URL}/wallets/backup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    profile: sess.profileName,
                    passphrase: sess.passphrase,
                    backupPassword: useWalletPassword ? undefined : backupPass,
                }),
            });

            const json = await resp.json();
            if (!resp.ok || !json.ok) throw new Error(json.error || "backup_failed");

            const filename: string = json.filename || `backup_${sess.profileName}.wallet.json`;
            const contentB64: string = json.contentB64;
            if (!contentB64) throw new Error("backup_missing_content");

            if (Platform.OS === "web") {
                const bin = atob(contentB64);
                const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
                const blob = new Blob([bytes], { type: "application/json" });
                const url = URL.createObjectURL(blob);

                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);

                setCreatedFilename(filename);
                setCreatedFileUri(null);
                setSuccessOpen(true);
                return;
            }

            const backupsDir = await ensureBackupsDir();
            if (!backupsDir) throw new Error("backups_dir_unavailable");

            const safeFilename = filename.replace(/[\\/:*?"<>|]/g, "_");
            const outUri = `${backupsDir}${safeFilename}`;

            await FileSystem.writeAsStringAsync(outUri, contentB64, { encoding: "base64" });

            setCreatedFilename(filename);
            setCreatedFileUri(outUri);
            setSuccessOpen(true);
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not create backup");
        } finally {
            setCreating(false);
        }
    };

    const showMismatch = !useWalletPassword && (touchedConfirm || submitAttempted) && mismatch;

    const TOP_PAD = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 12 : 12;

    return (
        <SafeAreaView style={[styles.container, { paddingTop: TOP_PAD }]} edges={["top", "left", "right"]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.topBar}>
                    <Pressable hitSlop={10} onPress={() => navigation.goBack()} style={styles.topLeft}>
                        <MaterialIcons name="arrow-back" size={24} color={COLORS.text} />
                    </Pressable>

                    <Text style={styles.topTitle}>Backup wallet</Text>

                    <View style={styles.topRight} />
                </View>

                <Text style={styles.subtitle}>Backup will be encrypted and saved on this device</Text>

                {loading ? (
                    <View style={{ paddingVertical: 20 }}>
                        <ActivityIndicator />
                    </View>
                ) : (
                    <>
                        <View style={styles.identityCard}>
                            <Text style={styles.identityName}>{profileName}</Text>
                            <Text style={styles.identityLabel}>Active identity</Text>
                            <Text style={styles.identityDid} numberOfLines={2} ellipsizeMode="middle">
                                {summary.activeDid ? shortDid(summary.activeDid) : "No DID yet"}
                            </Text>

                            <View style={styles.identityStatsRow}>
                                <Text style={styles.identityStat}>DIDs: {summary.stats.dids}</Text>
                                <Text style={styles.identityStat}>VCs: {summary.stats.vcs}</Text>
                                <Text style={styles.identityStat}>VPs: {summary.stats.vps}</Text>
                            </View>
                        </View>

                        <Text style={styles.sectionTitle}>Encryption</Text>

                        <Pressable
                            style={styles.radioRow}
                            onPress={() => {
                                setUseWalletPassword(true);
                                setSubmitAttempted(false);
                                setTouchedConfirm(false);
                            }}
                        >
                            <MaterialIcons
                                name={useWalletPassword ? "radio-button-checked" : "radio-button-unchecked"}
                                size={20}
                                color={useWalletPassword ? COLORS.accentBorder : COLORS.muted}
                            />
                            <Text style={styles.radioText}>Use wallet password (recommended)</Text>
                        </Pressable>

                        <Pressable
                            style={styles.radioRow}
                            onPress={() => {
                                setUseWalletPassword(false);
                                setSubmitAttempted(false);
                                setTouchedConfirm(false);
                            }}
                        >
                            <MaterialIcons
                                name={!useWalletPassword ? "radio-button-checked" : "radio-button-unchecked"}
                                size={20}
                                color={!useWalletPassword ? COLORS.accentBorder : COLORS.muted}
                            />
                            <Text style={styles.radioText}>Use different backup password</Text>
                        </Pressable>

                        {!useWalletPassword && (
                            <View style={{ marginTop: 10 }}>
                                <View style={styles.inputWrap}>
                                    <Text style={styles.inputLabel}>Backup password</Text>
                                    <View style={styles.inputRow}>
                                        <TextInput
                                            value={backupPass}
                                            onChangeText={setBackupPass}
                                            placeholder="Enter backup password"
                                            placeholderTextColor={COLORS.subtle}
                                            secureTextEntry={!showPass1}
                                            autoCapitalize="none"
                                            style={styles.input}
                                        />
                                        <Pressable hitSlop={10} onPress={() => setShowPass1((v) => !v)}>
                                            <MaterialIcons
                                                name={showPass1 ? "visibility-off" : "visibility"}
                                                size={20}
                                                color={COLORS.subtle}
                                            />
                                        </Pressable>
                                    </View>
                                </View>

                                <View style={[styles.inputWrap, { marginTop: 10 }]}>
                                    <Text style={styles.inputLabel}>Confirm backup password</Text>
                                    <View style={styles.inputRow}>
                                        <TextInput
                                            value={backupPass2}
                                            onChangeText={setBackupPass2}
                                            onBlur={() => setTouchedConfirm(true)}
                                            placeholder="Confirm backup password"
                                            placeholderTextColor={COLORS.subtle}
                                            secureTextEntry={!showPass2}
                                            autoCapitalize="none"
                                            style={styles.input}
                                        />
                                        <Pressable hitSlop={10} onPress={() => setShowPass2((v) => !v)}>
                                            <MaterialIcons
                                                name={showPass2 ? "visibility-off" : "visibility"}
                                                size={20}
                                                color={COLORS.subtle}
                                            />
                                        </Pressable>
                                    </View>
                                </View>

                                {showMismatch ? <Text style={styles.errorText}>Passwords don&apos;t match</Text> : null}
                            </View>
                        )}

                        <Pressable
                            style={[styles.primaryButton, (!canCreate || creating) && { opacity: 0.55 }]}
                            onPress={createBackup}
                            disabled={!canCreate || creating}
                        >
                            {creating ? (
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                    <ActivityIndicator />
                                    <Text style={styles.primaryButtonText}>Creating…</Text>
                                </View>
                            ) : (
                                <Text style={styles.primaryButtonText}>Create backup</Text>
                            )}
                        </Pressable>

                        <Text style={styles.footerNote}>
                            Keep this backup safe. If you forget the password, it can&apos;t be recovered.
                        </Text>
                    </>
                )}
            </ScrollView>

            <SuccessSheet
                visible={successOpen}
                filename={createdFilename}
                fileUri={createdFileUri}
                onClose={() => setSuccessOpen(false)}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg },
    content: { paddingHorizontal: 16, paddingBottom: 24 },

    topBar: {
        height: 48,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 8,
    },
    topLeft: { position: "absolute", left: 0, padding: 4 },
    topRight: { position: "absolute", right: 0, width: 28, height: 28 },
    topTitle: { color: COLORS.text, fontSize: 18, fontWeight: "600" },

    subtitle: { fontSize: 12, color: COLORS.subtle, marginBottom: 14 },

    identityCard: {
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card,
        marginBottom: 16,
    },
    identityName: { fontSize: 16, fontWeight: "600", marginBottom: 4, color: COLORS.text },
    identityLabel: { fontSize: 12, color: COLORS.muted },
    identityDid: { fontSize: 12, color: COLORS.text, marginTop: 4, marginBottom: 10 },
    identityStatsRow: { flexDirection: "row", justifyContent: "space-between" },
    identityStat: { fontSize: 12, color: COLORS.muted },

    sectionTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 10 },

    radioRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    radioText: { fontSize: 13, color: COLORS.text },

    inputWrap: {
        backgroundColor: COLORS.inputBg,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    inputLabel: { fontSize: 11, color: COLORS.subtle, marginBottom: 6 },
    inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    input: { flex: 1, fontSize: 13, color: COLORS.text, paddingVertical: 2 },

    errorText: { marginTop: 8, fontSize: 12, color: "#F87171" },

    primaryButton: {
        marginTop: 18,
        backgroundColor: COLORS.accentBg,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
    },
    primaryButtonText: { fontSize: 14, fontWeight: "600", color: COLORS.accentText },

    footerNote: { marginTop: 10, fontSize: 11, color: COLORS.subtle, textAlign: "center" },

    sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
    sheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2,
        backgroundColor: COLORS.bg,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    sheetHandle: {
        alignSelf: "center",
        width: 56,
        height: 5,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.35)",
        marginBottom: 12,
    },
    sheetTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
    sheetSub: { marginTop: 4, fontSize: 12, color: COLORS.muted },

    sheetBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: COLORS.accentBg,
        borderRadius: 999,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
    },
    sheetBtnText: { fontSize: 14, fontWeight: "600", color: COLORS.accentText },
});