import React, { useEffect, useMemo, useState } from "react";
import {
    SafeAreaView,
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
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as FileSystem from "expo-file-system";


import * as Sharing from "expo-sharing";

import { loadLastWallet } from "../src/storage/walletSession";

type Summary = {
    activeDid: string | null;
    stats: { dids: number; vcs: number; vps: number };
};

const BASE_URL =
    Platform.OS === "android"
        ? "http://IP_LAPTOP_LAN:5501"
        : "http://localhost:5501";

const CARD_BG = "#F9FAFB";
const ACCENT_BG = "#F3E8FF";

function shortDid(did: string, left = 12, right = 6) {
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

    return (
        <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.sheetOverlay} onPress={onClose} />
            <View style={styles.sheetWrap}>
                <View style={styles.sheet}>
                    <View style={styles.sheetHandle} />
                    <Text style={styles.sheetTitle}>Backup created</Text>
                    <Text style={styles.sheetSub}>{filename}</Text>

                    <View style={{ height: 14 }} />

                    <Pressable
                        style={[styles.sheetBtn, !canShare && { opacity: 0.5 }]}
                        onPress={onShare}
                        disabled={!canShare}
                    >
                        <MaterialIcons name="share" size={18} color="#111827" />
                        <Text style={styles.sheetBtnText}>Share</Text>
                    </Pressable>

                    <Pressable style={[styles.sheetBtn, { marginTop: 10 }]} onPress={onClose}>
                        <MaterialIcons name="check" size={18} color="#111827" />
                        <Text style={styles.sheetBtnText}>Done</Text>
                    </Pressable>
                </View>
            </View>
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

            const FS: any = FileSystem;

            const baseDir: string | null = FS.documentDirectory ?? FS.cacheDirectory;
            if (!baseDir) throw new Error("no_writable_directory");

            const backupsDir = `${baseDir}backups/`;
            await FS.makeDirectoryAsync(backupsDir, { intermediates: true }).catch(() => { });

            const outUri = `${backupsDir}${filename}`;

            await FS.writeAsStringAsync(outUri, contentB64, { encoding: "base64" });

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

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.content}>
                {/* Header */}
                <View style={styles.headerRow}>
                    <Pressable hitSlop={10} onPress={() => navigation.goBack()}>
                        <MaterialIcons name="arrow-back" size={22} color="#111827" />
                    </Pressable>

                    <Text style={styles.headerTitle}>Backup wallet</Text>

                    {/* right placeholder to keep title centered */}
                    <View style={{ width: 22 }} />
                </View>

                <Text style={styles.subtitle}>Backup will be encrypted and saved on this device</Text>

                {loading ? (
                    <View style={{ paddingVertical: 20 }}>
                        <ActivityIndicator />
                    </View>
                ) : (
                    <>
                        {/* Identity card */}
                        <View style={styles.identityCard}>
                            <Text style={styles.identityName}>{profileName}</Text>
                            <Text style={styles.identityLabel}>Active identity</Text>
                            <Text style={styles.identityDid}>
                                {summary.activeDid ? shortDid(summary.activeDid) : "No DID yet"}
                            </Text>

                            <View style={styles.identityStatsRow}>
                                <Text style={styles.identityStat}>DIDs: {summary.stats.dids}</Text>
                                <Text style={styles.identityStat}>VCs: {summary.stats.vcs}</Text>
                                <Text style={styles.identityStat}>VPs: {summary.stats.vps}</Text>
                            </View>
                        </View>

                        {/* Encryption */}
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
                                color={useWalletPassword ? "#6D28D9" : "#111827"}
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
                                color={!useWalletPassword ? "#6D28D9" : "#111827"}
                            />
                            <Text style={styles.radioText}>Use different backup password</Text>
                        </Pressable>

                        {/* Conditional password fields */}
                        {!useWalletPassword && (
                            <View style={{ marginTop: 10 }}>
                                <View style={styles.inputWrap}>
                                    <Text style={styles.inputLabel}>Backup password</Text>
                                    <View style={styles.inputRow}>
                                        <TextInput
                                            value={backupPass}
                                            onChangeText={(t) => setBackupPass(t)}
                                            placeholder="Enter backup password"
                                            secureTextEntry={!showPass1}
                                            autoCapitalize="none"
                                            style={styles.input}
                                        />
                                        <Pressable hitSlop={10} onPress={() => setShowPass1((v) => !v)}>
                                            <MaterialIcons name={showPass1 ? "visibility-off" : "visibility"} size={20} color="#6B7280" />
                                        </Pressable>
                                    </View>
                                </View>

                                <View style={[styles.inputWrap, { marginTop: 10 }]}>
                                    <Text style={styles.inputLabel}>Confirm backup password</Text>
                                    <View style={styles.inputRow}>
                                        <TextInput
                                            value={backupPass2}
                                            onChangeText={(t) => setBackupPass2(t)}
                                            onBlur={() => setTouchedConfirm(true)}
                                            placeholder="Confirm backup password"
                                            secureTextEntry={!showPass2}
                                            autoCapitalize="none"
                                            style={styles.input}
                                        />
                                        <Pressable hitSlop={10} onPress={() => setShowPass2((v) => !v)}>
                                            <MaterialIcons name={showPass2 ? "visibility-off" : "visibility"} size={20} color="#6B7280" />
                                        </Pressable>
                                    </View>
                                </View>

                                {showMismatch && <Text style={styles.errorText}>Passwords don&apos;t match</Text>}
                            </View>
                        )}

                        {/* CTA */}
                        <Pressable
                            style={[
                                styles.primaryButton,
                                (!canCreate || creating) && { opacity: 0.55 },
                            ]}
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
    container: { flex: 1, backgroundColor: "#FFFFFF" },
    content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },

    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
    },
    headerTitle: { fontSize: 18, fontWeight: "600", color: "#111827" },
    subtitle: { fontSize: 12, color: "#6B7280", marginBottom: 14 },

    identityCard: {
        backgroundColor: CARD_BG,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        marginBottom: 16,
    },
    identityName: { fontSize: 16, fontWeight: "600", marginBottom: 4, color: "#111827" },
    identityLabel: { fontSize: 12, color: "#6B7280" },
    identityDid: { fontSize: 12, color: "#4B5563", marginTop: 2, marginBottom: 8 },
    identityStatsRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 4,
    },
    identityStat: { fontSize: 12, color: "#4B5563" },

    sectionTitle: { fontSize: 14, fontWeight: "600", color: "#111827", marginBottom: 10 },

    radioRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
    },
    radioText: { fontSize: 13, color: "#111827" },

    inputWrap: {
        backgroundColor: "#F3F4F6",
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },
    inputLabel: { fontSize: 11, color: "#6B7280", marginBottom: 6 },
    inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    input: { flex: 1, fontSize: 13, color: "#111827", paddingVertical: 2 },

    errorText: { marginTop: 8, fontSize: 12, color: "#B00020" },

    primaryButton: {
        marginTop: 18,
        backgroundColor: ACCENT_BG,
        borderRadius: 999,
        paddingVertical: 12,
        alignItems: "center",
    },
    primaryButtonText: { fontSize: 15, fontWeight: "500", color: "#111827" },

    footerNote: { marginTop: 10, fontSize: 11, color: "#6B7280", textAlign: "center" },

    sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
    sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
    sheet: {
        backgroundColor: "#FFFFFF",
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 18,
    },
    sheetHandle: {
        alignSelf: "center",
        width: 56,
        height: 5,
        borderRadius: 999,
        backgroundColor: "#111827",
        opacity: 0.25,
        marginBottom: 12,
    },
    sheetTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
    sheetSub: { marginTop: 4, fontSize: 12, color: "#6B7280" },
    sheetBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: ACCENT_BG,
        borderRadius: 999,
        paddingVertical: 12,
    },
    sheetBtnText: { fontSize: 14, fontWeight: "600", color: "#111827" },
});
