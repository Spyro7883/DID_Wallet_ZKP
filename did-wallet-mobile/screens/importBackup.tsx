import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    TextInput,
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useNavigation } from "@react-navigation/native";

import { saveLastWallet } from "../src/storage/walletSession";
import { BACKUPS_DIR, listLocalBackups } from "../src/storage/backups";
import { importZkSecrets } from "../src/zk/secrets";
import { type AppColors } from "../src/theme/colors";
import { useAppTheme } from "../src/theme/AppThemeProvider";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

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
    colors,
    styles,
}: {
    label: string;
    checked: boolean;
    onPress: () => void;
    colors: AppColors;
    styles: ReturnType<typeof createStyles>;
}) {
    return (
        <Pressable style={styles.radioRow} onPress={onPress}>
            <View style={[styles.radioOuter, checked && { borderColor: colors.accentBorder }]}>
                {checked ? <View style={[styles.radioInner, { backgroundColor: colors.accentBorder }]} /> : null}
            </View>
            <Text style={styles.radioLabel}>{label}</Text>
        </Pressable>
    );
}

function CheckRow({
    label,
    checked,
    onPress,
    colors,
    styles,
}: {
    label: string;
    checked: boolean;
    onPress: () => void;
    colors: AppColors;
    styles: ReturnType<typeof createStyles>;
}) {
    return (
        <Pressable style={styles.checkRow} onPress={onPress}>
            <View
                style={[
                    styles.checkBox,
                    checked && {
                        borderColor: colors.accentBorder,
                        backgroundColor: colors.accentBg,
                    },
                ]}
            >
                {checked ? <MaterialIcons name="check" size={16} color={colors.accentText} /> : null}
            </View>
            <Text style={styles.checkLabel}>{label}</Text>
        </Pressable>
    );
}

export default function ImportBackupScreen() {
    const { colors } = useAppTheme();
    const COLORS = colors;
    const styles = useMemo(() => createStyles(COLORS), [COLORS]);

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

    const [conflict, setConflict] = useState(false);
    const [mode, setMode] = useState<"rename" | "overwrite">("rename");
    const [overwriteConfirm, setOverwriteConfirm] = useState(false);

    const [busy, setBusy] = useState(false);
    const [inlineError, setInlineError] = useState("");

    const effectiveWalletPass = walletSameAsBackup ? backupPassword : walletPassword;

    useEffect(() => {
        if (container?.profile && !walletName) {
            setWalletName(container.profile);
        }
    }, [container, walletName]);

    const refreshDeviceBackups = useCallback(async () => {
        const files = await listLocalBackups();
        setDeviceBackups(files);
    }, []);

    useEffect(() => {
        refreshDeviceBackups();
    }, [refreshDeviceBackups]);

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
                backupPassword,
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

            if (j.zkSecrets) {
                await importZkSecrets(j.zkSecrets);
            }

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

                    <Text style={styles.topTitle}>Import backup</Text>

                    <View style={styles.topRight} />
                </View>

                <Text style={styles.subtitle}>
                    Restore identities, credentials and presentations on this device
                </Text>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Backups on this device</Text>
                    <Text style={styles.cardSub}>Choose a local backup or refresh the list.</Text>

                    <View style={styles.cardTopRow}>
                        <View />
                        <Pressable onPress={refreshDeviceBackups} hitSlop={10}>
                            <MaterialIcons name="refresh" size={18} color={COLORS.text} />
                        </Pressable>
                    </View>

                    {!deviceBackups.length ? (
                        <Text style={styles.mutedText}>No local backups yet.</Text>
                    ) : (
                        <View style={{ gap: 8, marginTop: 10 }}>
                            {deviceBackups.slice(0, 4).map((fn) => (
                                <Pressable
                                    key={fn}
                                    style={styles.localRow}
                                    onPress={() => BACKUPS_DIR && loadBackupFromUri(`${BACKUPS_DIR}${fn}`, fn)}
                                >
                                    <MaterialIcons name="description" size={18} color={COLORS.accentText} />
                                    <Text style={styles.localRowText} numberOfLines={1}>
                                        {fn}
                                    </Text>
                                </Pressable>
                            ))}
                            {deviceBackups.length > 4 ? (
                                <Text style={styles.helperText}>Showing latest 4 backups.</Text>
                            ) : null}
                        </View>
                    )}
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Select backup file</Text>
                    <Text style={styles.cardSub}>
                        {picked ? picked.name : "Choose a .wallet.json backup file"}
                    </Text>

                    <Pressable style={styles.primaryBtn} onPress={pickFile} disabled={picking}>
                        {picking ? (
                            <ActivityIndicator />
                        ) : (
                            <Text style={styles.primaryBtnText}>{picked ? "Change file" : "Choose file"}</Text>
                        )}
                    </Pressable>
                </View>

                {!!container && (
                    <>
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>Backup password</Text>
                            <Text style={styles.cardSub}>Password used when the backup was created.</Text>

                            <View style={[styles.inputRow, { marginTop: 10 }]}>
                                <TextInput
                                    style={styles.input}
                                    value={backupPassword}
                                    onChangeText={(t) => {
                                        setBackupPassword(t);
                                        setInlineError("");
                                    }}
                                    secureTextEntry={!showBackupPw}
                                    placeholder="Enter backup password"
                                    placeholderTextColor={COLORS.subtle}
                                    autoCapitalize="none"
                                    {...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {})}
                                />
                                <Pressable onPress={() => setShowBackupPw((v) => !v)} hitSlop={8}>
                                    <MaterialIcons
                                        name={showBackupPw ? "visibility" : "visibility-off"}
                                        size={18}
                                        color={COLORS.subtle}
                                    />
                                </Pressable>
                            </View>
                        </View>

                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>Wallet password</Text>
                            <Text style={styles.cardSub}>Choose how the restored wallet will be protected locally.</Text>

                            <View style={{ marginTop: 8 }}>
                                <CheckRow
                                    label="Wallet password is the same as backup password"
                                    checked={walletSameAsBackup}
                                    onPress={() => setWalletSameAsBackup((v) => !v)}
                                    colors={COLORS}
                                    styles={styles}
                                />
                            </View>

                            {!walletSameAsBackup ? (
                                <View style={[styles.inputRow, { marginTop: 10 }]}>
                                    <TextInput
                                        style={styles.input}
                                        value={walletPassword}
                                        onChangeText={setWalletPassword}
                                        secureTextEntry={!showWalletPw}
                                        placeholder="Enter wallet password"
                                        placeholderTextColor={COLORS.subtle}
                                        autoCapitalize="none"
                                        {...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {})}
                                    />
                                    <Pressable onPress={() => setShowWalletPw((v) => !v)} hitSlop={8}>
                                        <MaterialIcons
                                            name={showWalletPw ? "visibility" : "visibility-off"}
                                            size={18}
                                            color={COLORS.subtle}
                                        />
                                    </Pressable>
                                </View>
                            ) : null}
                        </View>

                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>Wallet name</Text>
                            <Text style={styles.cardSub}>This will be the local wallet name on this device.</Text>

                            <View style={[styles.inputRow, { marginTop: 10 }]}>
                                <TextInput
                                    style={styles.input}
                                    value={walletName}
                                    onChangeText={(t) => {
                                        setWalletName(t);
                                        setConflict(false);
                                        setOverwriteConfirm(false);
                                        setMode("rename");
                                    }}
                                    placeholder="e.g. Citizen"
                                    placeholderTextColor={COLORS.subtle}
                                    autoCapitalize="none"
                                    {...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {})}
                                />
                            </View>

                            {conflict ? (
                                <View style={styles.conflictBox}>
                                    <View style={styles.conflictHeader}>
                                        <MaterialIcons name="warning-amber" size={18} color="#B45309" />
                                        <Text style={styles.conflictTitle}>
                                            A wallet with this name already exists.
                                        </Text>
                                    </View>

                                    <RadioRow
                                        label="Restore as a different name"
                                        checked={mode === "rename"}
                                        onPress={() => {
                                            setMode("rename");
                                            setOverwriteConfirm(false);
                                        }}
                                        colors={COLORS}
                                        styles={styles}
                                    />

                                    <RadioRow
                                        label="Overwrite existing wallet"
                                        checked={mode === "overwrite"}
                                        onPress={() => setMode("overwrite")}
                                        colors={COLORS}
                                        styles={styles}
                                    />

                                    {mode === "overwrite" ? (
                                        <CheckRow
                                            label="I understand this will replace local data"
                                            checked={overwriteConfirm}
                                            onPress={() => setOverwriteConfirm((v) => !v)}
                                            colors={COLORS}
                                            styles={styles}
                                        />
                                    ) : null}
                                </View>
                            ) : null}
                        </View>
                    </>
                )}

                {!!inlineError ? <Text style={styles.errorText}>{inlineError}</Text> : null}

                <Pressable
                    style={[styles.primaryBtn, (!canImport || busy) && { opacity: 0.55 }]}
                    onPress={doImport}
                    disabled={!canImport || busy}
                >
                    {busy ? (
                        <View style={styles.btnRow}>
                            <ActivityIndicator />
                            <Text style={styles.primaryBtnText}>Importing…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryBtnText}>Import backup</Text>
                    )}
                </Pressable>

                <Text style={styles.footerText}>
                    Keep this backup safe. If you forget the password, it can&apos;t be recovered.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}

const createStyles = (COLORS: AppColors) =>
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: COLORS.bg,
        },
        content: {
            paddingHorizontal: 16,
            paddingBottom: 28,
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
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.card,
            paddingHorizontal: 16,
            paddingVertical: 14,
            marginBottom: 12,
        },
        cardTopRow: {
            position: "absolute",
            right: 14,
            top: 14,
        },
        cardTitle: {
            fontSize: 14,
            fontWeight: "600",
            color: COLORS.text,
        },
        cardSub: {
            marginTop: 4,
            fontSize: 12,
            color: COLORS.muted,
        },

        mutedText: {
            marginTop: 10,
            fontSize: 12,
            color: COLORS.subtle,
        },
        helperText: {
            fontSize: 11,
            color: COLORS.subtle,
        },

        localRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: COLORS.border,
            borderRadius: 12,
            paddingHorizontal: 10,
            paddingVertical: 10,
            backgroundColor: COLORS.inputBg,
        },
        localRowText: {
            fontSize: 12,
            color: COLORS.text,
            flex: 1,
        },

        inputRow: {
            backgroundColor: COLORS.inputBg,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.border,
            paddingHorizontal: 12,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        input: {
            flex: 1,
            fontSize: 13,
            color: COLORS.text,
        },

        radioRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 8,
        },
        radioOuter: {
            width: 18,
            height: 18,
            borderRadius: 9,
            borderWidth: 1,
            borderColor: COLORS.subtle,
            alignItems: "center",
            justifyContent: "center",
        },
        radioInner: {
            width: 10,
            height: 10,
            borderRadius: 5,
        },
        radioLabel: {
            fontSize: 12,
            color: COLORS.text,
        },

        checkRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 8,
        },
        checkBox: {
            width: 18,
            height: 18,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: COLORS.subtle,
            alignItems: "center",
            justifyContent: "center",
        },
        checkLabel: {
            fontSize: 12,
            color: COLORS.text,
            flex: 1,
        },

        conflictBox: {
            marginTop: 12,
            backgroundColor: "#FFFBEB",
            borderWidth: 1,
            borderColor: "#FDE68A",
            borderRadius: 12,
            padding: 12,
        },
        conflictHeader: {
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            marginBottom: 6,
        },
        conflictTitle: {
            fontSize: 12,
            fontWeight: "600",
            color: "#92400E",
            flex: 1,
        },

        errorText: {
            color: "#F87171",
            fontSize: 12,
            marginTop: 4,
            marginBottom: 8,
        },

        primaryBtn: {
            marginTop: 8,
            backgroundColor: COLORS.accentBg,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            borderWidth: 1,
            borderColor: COLORS.accentBorder,
        },
        primaryBtnText: {
            fontSize: 14,
            fontWeight: "600",
            color: COLORS.accentText,
        },

        footerText: {
            marginTop: 10,
            fontSize: 11,
            color: COLORS.subtle,
            textAlign: "center",
        },

        btnRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
    });