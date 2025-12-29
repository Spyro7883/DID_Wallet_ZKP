import React, { useEffect, useMemo, useState } from "react";
import {
    SafeAreaView,
    View,
    Text,
    StyleSheet,
    Pressable,
    TextInput,
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useNavigation } from "@react-navigation/native";
import { saveLastWallet } from "../src/storage/walletSession";

import { BACKUPS_DIR, listLocalBackups } from "../src/storage/backups";

const BASE_URL =
    Platform.OS === "android" ? "http://IP_LAPTOP_LAN:5501" : "http://localhost:5501";

type BackupContainer = {
    format: "did-wallet-backup";
    version: 1;
    profile: string;
    kdf: { name: "scrypt"; saltHex: string; N: number; r: number; p: number; dkLen: number };
    enc: "aes-256-gcm";
    ivHex: string;
    tagHex: string;
    ciphertextB64: string;
};

function isBackupContainer(x: any): x is BackupContainer {
    return (
        x &&
        typeof x === "object" &&
        x.format === "did-wallet-backup" &&
        x.version === 1 &&
        x.kdf?.saltHex &&
        x.ivHex &&
        x.tagHex &&
        x.ciphertextB64
    );
}

async function readTextFromUri(uri: string): Promise<string> {
    try {
        return await (FileSystem as any).readAsStringAsync(uri, { encoding: "utf8" });
    } catch {
        const r = await fetch(uri);
        return await r.text();
    }
}

function RadioRow({
    label,
    checked,
    onPress,
}: {
    label: string;
    checked: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable style={styles.radioRow} onPress={onPress}>
            <View style={[styles.radioOuter, checked && styles.radioOuterOn]}>
                {checked ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.radioLabel}>{label}</Text>
        </Pressable>
    );
}

function CheckRow({
    label,
    checked,
    onPress,
}: {
    label: string;
    checked: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable style={styles.checkRow} onPress={onPress}>
            <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
                {checked ? <MaterialIcons name="check" size={16} color="#111827" /> : null}
            </View>
            <Text style={styles.checkLabel}>{label}</Text>
        </Pressable>
    );
}

export default function ImportBackupScreen() {
    const navigation = useNavigation<any>();

    const [picking, setPicking] = useState(false);

    const [deviceBackups, setDeviceBackups] = useState<string[]>([]);
    const [picked, setPicked] = useState<{ name: string; uri: string } | null>(null);
    const [container, setContainer] = useState<BackupContainer | null>(null);

    const [backupPassword, setBackupPassword] = useState("");
    const [walletPassword, setWalletPassword] = useState("");
    const [walletSameAsBackup, setWalletSameAsBackup] = useState(true);

    const [walletName, setWalletName] = useState("");

    const [showBackupPw, setShowBackupPw] = useState(false);
    const [showWalletPw, setShowWalletPw] = useState(false);

    // Conflict handling fără /wallets/profiles:
    const [conflict, setConflict] = useState(false);
    const [mode, setMode] = useState<"rename" | "overwrite">("rename");
    const [overwriteConfirm, setOverwriteConfirm] = useState(false);

    const [busy, setBusy] = useState(false);
    const [inlineError, setInlineError] = useState<string>("");

    const effectiveWalletPass = walletSameAsBackup ? backupPassword : walletPassword;

    // Prefill walletName din container.profile
    useEffect(() => {
        if (container?.profile && !walletName) setWalletName(container.profile);
    }, [container, walletName]);

    async function refreshDeviceBackups() {
        const files = await listLocalBackups();
        setDeviceBackups(files);
    }

    useEffect(() => {
        refreshDeviceBackups();
    }, []);

    async function loadBackupFromUri(uri: string, name: string) {
        setInlineError("");
        setConflict(false);
        setOverwriteConfirm(false);
        setMode("rename");

        const txt = await readTextFromUri(uri);

        let parsed: any;
        try {
            parsed = JSON.parse(txt);
        } catch {
            setInlineError("Invalid JSON file.");
            return;
        }

        if (!isBackupContainer(parsed)) {
            setInlineError("Invalid backup format.");
            return;
        }

        setPicked({ name, uri });
        setContainer(parsed);
    }

    async function pickFile() {
        try {
            setInlineError("");
            setPicking(true);

            const res = await DocumentPicker.getDocumentAsync({
                type: ["application/json", "text/json", "application/*"],
                multiple: false,
                copyToCacheDirectory: true,
            });

            if (res.canceled) return;

            const asset = res.assets?.[0];
            if (!asset?.uri) return;

            const name = String(asset.name || "backup.wallet.json");
            if (!name.toLowerCase().endsWith(".wallet.json") && !name.toLowerCase().endsWith(".wallet")) {
                setInlineError("Unsupported file. Please select a .wallet.json backup.");
                return;
            }

            await loadBackupFromUri(asset.uri, name);
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Could not pick file");
        } finally {
            setPicking(false);
        }
    }

    const canImport =
        !!container &&
        !!walletName.trim() &&
        !!backupPassword &&
        !!effectiveWalletPass &&
        (!conflict || mode === "rename" || (mode === "overwrite" && overwriteConfirm));

    async function doImport() {
        if (!container) return;

        setInlineError("");
        setBusy(true);

        try {
            const payload = {
                backup: container,
                backupPassword: backupPassword,
                walletPassphrase: effectiveWalletPass,
                targetProfile: walletName.trim(),
                overwrite: mode === "overwrite" && overwriteConfirm,
            };

            const r = await fetch(`${BASE_URL}/wallets/restore`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });

            const j = await r.json().catch(() => ({}));

            if (!r.ok || !j?.ok) {
                if (r.status === 409) {
                    setConflict(true);
                    setInlineError("Wallet name already exists. Choose another name or enable overwrite.");
                } else if (r.status === 401) {
                    setInlineError("Wrong password or corrupted backup.");
                } else {
                    setInlineError(String(j?.error || j?.message || "restore_failed"));
                }
                return;
            }

            const restoredProfile = String(j.profile || walletName.trim());
            await saveLastWallet(restoredProfile, effectiveWalletPass);

            navigation.reset({
                index: 0,
                routes: [{ name: "Wallet", params: { profileName: restoredProfile } }],
            });
        } catch (e: any) {
            setInlineError(e?.message || "restore_failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.headerRow}>
                    <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
                        <MaterialIcons name="arrow-back" size={22} color="#111827" />
                    </Pressable>
                    <Text style={styles.headerTitle}>Import backup</Text>
                    <View style={{ width: 22 }} />
                </View>

                <View style={styles.infoCard}>
                    <Text style={styles.infoText}>
                        This will restore identities, credentials and{" "}
                        <Text style={{ fontWeight: "700" }}>presentations</Text> on this device.
                    </Text>
                    <Text style={styles.infoSub}>If you don’t know the password, it can’t be recovered.</Text>
                </View>

                {/* Local backups (app sandbox) */}
                <View style={styles.fileCard}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={styles.fileTitle}>Backups on this device</Text>
                        <Pressable onPress={refreshDeviceBackups} hitSlop={10}>
                            <MaterialIcons name="refresh" size={18} color="#111827" />
                        </Pressable>
                    </View>

                    {!deviceBackups.length ? (
                        <Text style={styles.fileSub}>No local backups yet.</Text>
                    ) : (
                        <View style={{ gap: 8 }}>
                            {deviceBackups.slice(0, 4).map((fn) => (
                                <Pressable
                                    key={fn}
                                    style={styles.localRow}
                                    onPress={() => BACKUPS_DIR && loadBackupFromUri(`${BACKUPS_DIR}${fn}`, fn)}
                                >
                                    <MaterialIcons name="description" size={18} color="#111827" />
                                    <Text style={styles.localRowText} numberOfLines={1}>{fn}</Text>
                                </Pressable>
                            ))}
                            {deviceBackups.length > 4 ? (
                                <Text style={styles.fileSub}>Showing latest 4 backups.</Text>
                            ) : null}
                        </View>
                    )}
                </View>

                {/* External file picker */}
                <View style={styles.fileCard}>
                    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                        <MaterialIcons name="attach-file" size={18} color="#111827" />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.fileTitle}>Select backup file</Text>
                            <Text style={styles.fileSub}>{picked ? picked.name : ".wallet.json"}</Text>
                        </View>
                    </View>

                    <Pressable style={styles.fileBtn} onPress={pickFile} disabled={picking}>
                        {picking ? <ActivityIndicator /> : <Text style={styles.fileBtnText}>{picked ? "Change File" : "Choose File"}</Text>}
                    </Pressable>
                </View>

                {!!container && (
                    <>
                        <View style={styles.section}>
                            <Text style={styles.label}>Backup password</Text>
                            <View style={styles.inputRow}>
                                <TextInput
                                    style={styles.input}
                                    value={backupPassword}
                                    onChangeText={(t) => {
                                        setBackupPassword(t);
                                        setInlineError("");
                                    }}
                                    secureTextEntry={!showBackupPw}
                                    placeholder="Enter backup password"
                                    autoCapitalize="none"
                                />
                                <Pressable onPress={() => setShowBackupPw((v) => !v)} hitSlop={8}>
                                    <MaterialIcons name={showBackupPw ? "visibility" : "visibility-off"} size={18} color="#111827" />
                                </Pressable>
                            </View>
                            <Text style={styles.helper}>Password used when the backup was created.</Text>
                        </View>

                        <View style={styles.section}>
                            <CheckRow
                                label="Wallet password is the same as backup password"
                                checked={walletSameAsBackup}
                                onPress={() => setWalletSameAsBackup((v) => !v)}
                            />

                            {!walletSameAsBackup && (
                                <>
                                    <Text style={[styles.label, { marginTop: 10 }]}>Wallet password</Text>
                                    <View style={styles.inputRow}>
                                        <TextInput
                                            style={styles.input}
                                            value={walletPassword}
                                            onChangeText={setWalletPassword}
                                            secureTextEntry={!showWalletPw}
                                            placeholder="Enter wallet password"
                                            autoCapitalize="none"
                                        />
                                        <Pressable onPress={() => setShowWalletPw((v) => !v)} hitSlop={8}>
                                            <MaterialIcons name={showWalletPw ? "visibility" : "visibility-off"} size={18} color="#111827" />
                                        </Pressable>
                                    </View>
                                </>
                            )}
                        </View>

                        <View style={styles.section}>
                            <Text style={styles.label}>Wallet name</Text>
                            <View style={styles.inputRow}>
                                <TextInput
                                    style={styles.input}
                                    value={walletName}
                                    onChangeText={(t) => {
                                        setWalletName(t);
                                        setConflict(false);
                                        setOverwriteConfirm(false);
                                        setMode("rename");
                                    }}
                                    placeholder="e.g., Citizen"
                                    autoCapitalize="none"
                                />
                            </View>
                            <Text style={styles.helper}>This will be the local wallet name on this device.</Text>

                            {conflict && (
                                <View style={styles.conflictBox}>
                                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                                        <MaterialIcons name="warning-amber" size={18} color="#B45309" />
                                        <Text style={styles.conflictTitle}>A wallet with this name already exists.</Text>
                                    </View>

                                    <RadioRow
                                        label="Restore as a different name"
                                        checked={mode === "rename"}
                                        onPress={() => {
                                            setMode("rename");
                                            setOverwriteConfirm(false);
                                        }}
                                    />
                                    <RadioRow
                                        label="Overwrite existing wallet"
                                        checked={mode === "overwrite"}
                                        onPress={() => setMode("overwrite")}
                                    />

                                    {mode === "overwrite" && (
                                        <CheckRow
                                            label="I understand this will replace local data"
                                            checked={overwriteConfirm}
                                            onPress={() => setOverwriteConfirm((v) => !v)}
                                        />
                                    )}
                                </View>
                            )}
                        </View>
                    </>
                )}

                {!!inlineError && <Text style={styles.errorText}>{inlineError}</Text>}

                <Pressable
                    style={[styles.primaryBtn, (!canImport || busy) && styles.primaryBtnDisabled]}
                    onPress={doImport}
                    disabled={!canImport || busy}
                >
                    {busy ? <ActivityIndicator /> : <Text style={styles.primaryBtnText}>Import backup</Text>}
                </Pressable>

                <Text style={styles.footerText}>
                    Keep this backup safe.{"\n"}If you forget the password, it can’t be recovered.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}

const CARD_BG = "#F9FAFB";
const ACCENT_BG = "#F3E8FF";

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#FFFFFF" },
    content: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28 },

    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
    },
    headerTitle: { fontSize: 16, fontWeight: "600", color: "#111827" },

    infoCard: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        padding: 12,
        marginBottom: 12,
    },
    infoText: { fontSize: 12, color: "#111827", lineHeight: 16 },
    infoSub: { marginTop: 6, fontSize: 11, color: "#6B7280", lineHeight: 15 },

    fileCard: {
        backgroundColor: CARD_BG,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        padding: 14,
        marginBottom: 14,
        gap: 12,
    },
    fileTitle: { fontSize: 12, fontWeight: "600", color: "#111827" },
    fileSub: { marginTop: 2, fontSize: 11, color: "#6B7280" },
    fileBtn: {
        alignSelf: "center",
        backgroundColor: "#6D28D9",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 22,
    },
    fileBtnText: { color: "#FFFFFF", fontWeight: "600", fontSize: 12 },

    localRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 10,
        backgroundColor: "#FFFFFF",
    },
    localRowText: { fontSize: 11, color: "#111827", flex: 1 },

    section: { marginBottom: 12 },
    label: { fontSize: 11, fontWeight: "600", color: "#111827", marginBottom: 6 },
    helper: { fontSize: 10, color: "#6B7280", marginTop: 6 },

    inputRow: {
        backgroundColor: CARD_BG,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    input: { flex: 1, fontSize: 12, color: "#111827" },

    radioRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    radioOuter: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: "#9CA3AF",
        alignItems: "center",
        justifyContent: "center",
    },
    radioOuterOn: { borderColor: "#6D28D9" },
    radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#6D28D9" },
    radioLabel: { fontSize: 11, color: "#111827" },

    checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    checkBox: {
        width: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: "#9CA3AF",
        alignItems: "center",
        justifyContent: "center",
    },
    checkBoxOn: { borderColor: "#6D28D9", backgroundColor: ACCENT_BG },
    checkLabel: { fontSize: 11, color: "#111827", flex: 1 },

    conflictBox: {
        marginTop: 10,
        backgroundColor: "#FFFBEB",
        borderWidth: 1,
        borderColor: "#FDE68A",
        borderRadius: 12,
        padding: 10,
    },
    conflictTitle: { fontSize: 11, fontWeight: "600", color: "#92400E" },

    errorText: { color: "#B91C1C", fontSize: 11, marginTop: 6, marginBottom: 8 },

    primaryBtn: {
        marginTop: 8,
        backgroundColor: ACCENT_BG,
        borderRadius: 999,
        paddingVertical: 12,
        alignItems: "center",
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: { fontSize: 13, fontWeight: "600", color: "#111827" },

    footerText: { marginTop: 10, fontSize: 10, color: "#6B7280", textAlign: "center" },
});
