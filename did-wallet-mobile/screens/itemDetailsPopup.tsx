import React, { useEffect, useMemo, useState } from "react";
import {
    Modal,
    View,
    Text,
    Pressable,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Platform,
    useColorScheme,
    TextInput,
    Alert,
} from "react-native";
import { COLORS } from "../src/theme/colors";

function safeJson(s: string) {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function pickVcOrVp(data: any) {
    if (!data) return null;
    return (
        data?.verifiableCredential ||
        data?.verifiablePresentation ||
        (typeof data?.verifiableCredential === "string" ? safeJson(data.verifiableCredential) : null) ||
        (typeof data?.verifiablePresentation === "string" ? safeJson(data.verifiablePresentation) : null) ||
        null
    );
}

async function copyText(text: string) {
    if (!text) return false;

    if (Platform.OS === "web") {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    try {
        const Clipboard = require("expo-clipboard");
        if (Clipboard?.setStringAsync) {
            await Clipboard.setStringAsync(text);
            return true;
        }
    } catch { }

    return false;
}

export function ItemDetailsPopup({
    visible,
    item,
    loading,
    error,
    data,
    onClose,
}: {
    visible: boolean;
    item: { kind: "did" | "vc" | "vp"; id: string; title: string } | null;
    loading: boolean;
    error: string;
    data: any;
    onClose: () => void;
}) {
    const parsed = pickVcOrVp(data);
    const [showRawVp, setShowRawVp] = useState(false);

    useEffect(() => {
        if (!visible) setShowRawVp(false);
    }, [visible, item?.id]);

    const rawVp = useMemo(() => {
        if (item?.kind !== "vp" || !parsed) return "";
        try {
            return JSON.stringify(parsed, null, 2);
        } catch {
            return String(parsed ?? "");
        }
    }, [item?.kind, parsed]);

    const scheme = useColorScheme();
    const isDark = scheme === "dark";

    const theme = useMemo(() => {
        return isDark
            ? {
                overlay: "rgba(0,0,0,0.55)",
                cardBg: COLORS.bg,
                cardBorder: COLORS.border,
                panelBg: COLORS.card,
                panelBorder: COLORS.border,
                title: COLORS.text,
                muted: COLORS.muted,
                subtle: COLORS.subtle,
                text: COLORS.text,
                btnBg: COLORS.accentBg,
                btnBorder: COLORS.accentBorder,
                btnText: COLORS.accentText,
                rawBg: "rgba(255,255,255,0.03)",
            }
            : {
                overlay: "rgba(0,0,0,0.35)",
                cardBg: "#FFFFFF",
                cardBorder: "rgba(17,24,39,0.08)",
                panelBg: COLORS.accentBg,
                panelBorder: "rgba(17,24,39,0.08)",
                title: "#111827",
                muted: "#4B5563",
                subtle: "#6B7280",
                text: "#111827",
                btnBg: COLORS.accentBg,
                btnBorder: COLORS.accentBorder,
                btnText: "#111827",
                rawBg: "rgba(17,24,39,0.03)",
            };
    }, [isDark]);

    return (
        <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
            <View style={[s.overlay, { backgroundColor: theme.overlay }]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

                <View style={[s.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                    <View style={s.header}>
                        <Text style={[s.title, { color: theme.title }]}>Item details</Text>
                    </View>

                    {!item ? (
                        <Text style={[s.muted, { color: theme.subtle }]}>No item selected.</Text>
                    ) : (
                        <>
                            <View style={[s.top, { backgroundColor: theme.panelBg, borderColor: theme.panelBorder }]}>
                                <View style={s.topRow}>
                                    <View style={s.badge}>
                                        <Text style={s.badgeText}>{item.kind.toUpperCase()}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[s.main, { color: theme.text }]} numberOfLines={2}>
                                            {item.title}
                                        </Text>
                                        <Text style={[s.sub, { color: theme.subtle }]} numberOfLines={1} ellipsizeMode="middle">
                                            {item.id}
                                        </Text>
                                    </View>
                                </View>
                            </View>

                            {loading ? (
                                <View style={{ paddingVertical: 14 }}>
                                    <ActivityIndicator />
                                </View>
                            ) : error ? (
                                <Text style={[s.error, { color: "#F87171" }]}>{error}</Text>
                            ) : (
                                <ScrollView style={{ maxHeight: 430 }} contentContainerStyle={{ paddingBottom: 6 }}>
                                    {item.kind === "vc" && parsed ? (
                                        <View style={[s.section, { backgroundColor: theme.panelBg, borderColor: theme.panelBorder }]}>
                                            <Text style={[s.sectionTitle, { color: theme.text }]}>Credential</Text>

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>Issuer</Text>
                                                <Text style={[s.v, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
                                                    {parsed?.issuer?.id ?? "-"}
                                                </Text>
                                            </View>

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>Subject</Text>
                                                <Text style={[s.v, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
                                                    {parsed?.credentialSubject?.id ?? "-"}
                                                </Text>
                                            </View>

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>Issued</Text>
                                                <Text style={[s.v, { color: theme.text }]}>
                                                    {String(parsed?.issuanceDate ?? "-").slice(0, 10)}
                                                </Text>
                                            </View>

                                            {!!parsed?.expirationDate ? (
                                                <View style={s.kvRow}>
                                                    <Text style={[s.k, { color: theme.muted }]}>Expires</Text>
                                                    <Text style={[s.v, { color: theme.text }]}>
                                                        {String(parsed.expirationDate).slice(0, 10)}
                                                    </Text>
                                                </View>
                                            ) : null}

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>Type</Text>
                                                <Text style={[s.v, { color: theme.text }]} numberOfLines={2} ellipsizeMode="tail">
                                                    {Array.isArray(parsed?.type) ? parsed.type.join(", ") : parsed?.type ?? "-"}
                                                </Text>
                                            </View>
                                        </View>
                                    ) : null}

                                    {item.kind === "vp" && parsed ? (
                                        <View style={[s.section, { backgroundColor: theme.panelBg, borderColor: theme.panelBorder }]}>
                                            <Text style={[s.sectionTitle, { color: theme.text }]}>Presentation</Text>

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>Holder</Text>
                                                <Text style={[s.v, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
                                                    {parsed?.holder ?? "-"}
                                                </Text>
                                            </View>

                                            <View style={s.actionsRow}>
                                                <Pressable
                                                    style={[s.actionBtn, { backgroundColor: theme.btnBg, borderColor: theme.btnBorder }]}
                                                    onPress={() => setShowRawVp((v) => !v)}
                                                >
                                                    <Text style={[s.actionBtnText, { color: theme.btnText }]}>
                                                        {showRawVp ? "Hide raw VP" : "View raw VP"}
                                                    </Text>
                                                </Pressable>

                                                <Pressable
                                                    style={[s.actionBtn, { backgroundColor: theme.btnBg, borderColor: theme.btnBorder }]}
                                                    onPress={async () => {
                                                        const ok = await copyText(rawVp);
                                                        if (ok) {
                                                            Alert.alert("Copied", "Raw VP copied.");
                                                        } else {
                                                            Alert.alert(
                                                                "Copy failed",
                                                                "Could not copy automatically. Open raw VP and copy manually."
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <Text style={[s.actionBtnText, { color: theme.btnText }]}>
                                                        Copy raw VP
                                                    </Text>
                                                </Pressable>
                                            </View>

                                            {showRawVp ? (
                                                <View
                                                    style={[
                                                        s.rawWrap,
                                                        {
                                                            backgroundColor: theme.rawBg,
                                                            borderColor: theme.panelBorder,
                                                        },
                                                    ]}
                                                >
                                                    <TextInput
                                                        value={rawVp}
                                                        editable={false}
                                                        multiline
                                                        scrollEnabled
                                                        selectTextOnFocus
                                                        autoCorrect={false}
                                                        autoCapitalize="none"
                                                        style={[s.rawInput, { color: theme.text }]}
                                                    />
                                                </View>
                                            ) : null}
                                        </View>
                                    ) : null}

                                    {item.kind === "did" && data ? (
                                        <View style={[s.section, { backgroundColor: theme.panelBg, borderColor: theme.panelBorder }]}>
                                            <Text style={[s.sectionTitle, { color: theme.text }]}>DID</Text>

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>DID</Text>
                                                <Text style={[s.v, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
                                                    {data?.did ?? item.id}
                                                </Text>
                                            </View>

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>Provider</Text>
                                                <Text style={[s.v, { color: theme.text }]} numberOfLines={1}>
                                                    {data?.provider ?? "-"}
                                                </Text>
                                            </View>

                                            <View style={s.kvRow}>
                                                <Text style={[s.k, { color: theme.muted }]}>Alias</Text>
                                                <Text style={[s.v, { color: theme.text }]} numberOfLines={1}>
                                                    {data?.alias ?? "-"}
                                                </Text>
                                            </View>
                                        </View>
                                    ) : null}
                                </ScrollView>
                            )}

                            <Pressable
                                style={[s.okBtn, { backgroundColor: theme.btnBg, borderColor: theme.btnBorder }]}
                                onPress={onClose}
                            >
                                <Text style={[s.okText, { color: theme.btnText }]}>Close</Text>
                            </Pressable>
                        </>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    overlay: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
    },

    card: {
        width: "100%",
        maxWidth: 520,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
    },

    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 16, fontWeight: "700" },

    top: {
        marginTop: 10,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
    },
    topRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },

    badge: {
        backgroundColor: COLORS.accentBg,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: COLORS.accentBorder,
    },
    badgeText: { fontSize: 11, fontWeight: "800", color: COLORS.accentText },

    main: { fontSize: 13, fontWeight: "800" },
    sub: { marginTop: 4, fontSize: 11 },

    section: {
        marginTop: 10,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
    },
    sectionTitle: { fontSize: 12, fontWeight: "800", marginBottom: 8 },

    kvRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        paddingVertical: 6,
    },
    k: { fontSize: 12, fontWeight: "800", paddingRight: 12 },
    v: {
        flex: 1,
        fontSize: 12,
        textAlign: "right",
        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },

    actionsRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
        marginTop: 10,
    },
    actionBtn: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderWidth: 1,
    },
    actionBtnText: {
        fontSize: 12,
        fontWeight: "800",
    },

    rawWrap: {
        marginTop: 10,
        borderRadius: 12,
        borderWidth: 1,
        padding: 10,
    },
    rawInput: {
        minHeight: 220,
        maxHeight: 320,
        fontSize: 12,
        textAlignVertical: "top",
        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },

    okBtn: {
        marginTop: 12,
        alignSelf: "flex-end",
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
    },
    okText: { fontSize: 12, fontWeight: "800" },

    muted: { marginTop: 10, fontSize: 12 },
    error: { marginTop: 10, fontSize: 12 },
});