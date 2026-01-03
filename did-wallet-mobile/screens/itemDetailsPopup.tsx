import { Modal, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

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
function safeJson(s: string) {
    try { return JSON.parse(s); } catch { return null; }
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
    const raw = data ? JSON.stringify(data, null, 2) : "";

    return (
        <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
            <View style={pstyles.overlay}>
                {/* click pe overlay inchide */}
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

                <View style={pstyles.card}>
                    <View style={pstyles.header}>
                        <Text style={pstyles.title}>Item details</Text>
                        <Pressable onPress={onClose} hitSlop={10}>
                            <MaterialIcons name="close" size={20} color="#111827" />
                        </Pressable>
                    </View>

                    {!item ? (
                        <Text style={pstyles.muted}>No item selected.</Text>
                    ) : (
                        <>
                            <View style={pstyles.top}>
                                <Text style={pstyles.kicker}>{item.kind.toUpperCase()}</Text>
                                <Text style={pstyles.main} numberOfLines={2}>{item.title}</Text>
                                <Text style={pstyles.muted} numberOfLines={1}>{item.id}</Text>
                            </View>

                            {loading ? (
                                <View style={{ paddingVertical: 14 }}>
                                    <ActivityIndicator />
                                </View>
                            ) : error ? (
                                <Text style={pstyles.error}>{error}</Text>
                            ) : (
                                <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 6 }}>
                                    {item.kind === "vc" && parsed ? (
                                        <View style={pstyles.section}>
                                            <Text style={pstyles.sectionTitle}>Credential</Text>
                                            <Text style={pstyles.row}><Text style={pstyles.bold}>Issuer:</Text> {parsed?.issuer?.id ?? "-"}</Text>
                                            <Text style={pstyles.row}><Text style={pstyles.bold}>Subject:</Text> {parsed?.credentialSubject?.id ?? "-"}</Text>
                                            <Text style={pstyles.row}><Text style={pstyles.bold}>Issued:</Text> {String(parsed?.issuanceDate ?? "-").slice(0, 10)}</Text>
                                            {!!parsed?.expirationDate && (
                                                <Text style={pstyles.row}><Text style={pstyles.bold}>Expires:</Text> {String(parsed.expirationDate).slice(0, 10)}</Text>
                                            )}
                                            <Text style={pstyles.row}>
                                                <Text style={pstyles.bold}>Type:</Text>{" "}
                                                {Array.isArray(parsed?.type) ? parsed.type.join(", ") : (parsed?.type ?? "-")}
                                            </Text>
                                        </View>
                                    ) : null}

                                    {item.kind === "vp" && parsed ? (
                                        <View style={pstyles.section}>
                                            <Text style={pstyles.sectionTitle}>Presentation</Text>

                                            <Text style={pstyles.row}>
                                                <Text style={pstyles.bold}>Holder:</Text> {parsed?.holder ?? "-"}
                                            </Text>

                                            {Array.isArray(parsed?.verifiableCredential) && parsed.verifiableCredential.length > 0 ? (
                                                <View style={{ marginTop: 10, gap: 10 }}>
                                                    {parsed.verifiableCredential.map((vc: any, idx: number) => {
                                                        const typeArr =
                                                            typeof vc === "object" && vc
                                                                ? Array.isArray(vc.type)
                                                                    ? vc.type
                                                                    : [vc.type].filter(Boolean)
                                                                : [];

                                                        const mainType =
                                                            typeArr.find((t: string) => t && t !== "VerifiableCredential") ||
                                                            (typeArr.length ? "VerifiableCredential" : "Credential");

                                                        return (
                                                            <View
                                                                key={idx}
                                                                style={{
                                                                    borderWidth: 1,
                                                                    borderColor: "#E5E7EB",
                                                                    borderRadius: 12,
                                                                    padding: 10,
                                                                }}
                                                            >
                                                                <Text style={{ fontSize: 12, fontWeight: "800", color: "#111827" }}>
                                                                    {mainType}
                                                                </Text>

                                                                {/* opțional: arată lista completă de type-uri dacă există */}
                                                                {typeArr.length > 1 ? (
                                                                    <Text style={{ marginTop: 4, fontSize: 11, color: "#6B7280" }}>
                                                                        {typeArr.join(", ")}
                                                                    </Text>
                                                                ) : null}
                                                            </View>
                                                        );
                                                    })}
                                                </View>
                                            ) : (
                                                <Text style={pstyles.row}>
                                                    <Text style={pstyles.bold}>VCs:</Text> 0
                                                </Text>
                                            )}
                                        </View>
                                    ) : null}


                                    {item.kind === "did" && data ? (
                                        <View style={pstyles.section}>
                                            <Text style={pstyles.sectionTitle}>DID</Text>
                                            <Text style={pstyles.row}><Text style={pstyles.bold}>DID:</Text> {data?.did ?? item.id}</Text>
                                            <Text style={pstyles.row}><Text style={pstyles.bold}>Provider:</Text> {data?.provider ?? "-"}</Text>
                                            <Text style={pstyles.row}><Text style={pstyles.bold}>Alias:</Text> {data?.alias ?? "-"}</Text>
                                        </View>
                                    ) : null}

                                    {/* fallback raw */}
                                    {/* <View style={pstyles.section}>
                                            <Text style={pstyles.sectionTitle}>Raw</Text>
                                            <Text style={pstyles.mono}>{raw || "-"}</Text>
                                        </View> */}
                                </ScrollView>
                            )}

                            <Pressable style={pstyles.okBtn} onPress={onClose}>
                                <Text style={pstyles.okText}>Close</Text>
                            </Pressable>
                        </>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const pstyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.35)",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
    },
    card: {
        width: "100%",
        maxWidth: 520,
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 16, fontWeight: "700", color: "#111827" },

    top: { marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB" },
    kicker: { fontSize: 11, color: "#6B7280", fontWeight: "800" },
    main: { marginTop: 4, fontSize: 13, color: "#111827", fontWeight: "800" },
    muted: { marginTop: 4, fontSize: 11, color: "#6B7280" },

    section: { marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB" },
    sectionTitle: { fontSize: 12, fontWeight: "800", color: "#111827", marginBottom: 6 },
    row: { fontSize: 12, color: "#111827", marginTop: 4 },
    bold: { fontWeight: "800" },
    mono: { fontSize: 11, color: "#111827" },

    okBtn: {
        marginTop: 12,
        alignSelf: "flex-end",
        backgroundColor: "#F3E8FF",
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: "#D8B4FE",
    },
    okText: { fontSize: 12, fontWeight: "700", color: "#111827" },
    error: { marginTop: 10, fontSize: 12, color: "#B91C1C" },
});
