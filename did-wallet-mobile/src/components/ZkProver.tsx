import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

import { bindAggregateProver, unbindAggregateProver } from "../zk/proverBridge";
import { PROVER_HTML } from "../zk/proverHtml";
import type { AggregateProofResult, AggregateZkInput } from "../zk/proverTypes";

type Props = {
    baseUrl: string;
    onReadyChange?: (ready: boolean) => void;
};

type PendingReq = {
    resolve: (value: AggregateProofResult) => void;
    reject: (reason?: any) => void;
    timeout: ReturnType<typeof setTimeout>;
};

function makeReqId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ZkProver({ baseUrl, onReadyChange }: Props) {
    const webRef = useRef<WebView>(null);
    const pendingRef = useRef<Map<string, PendingReq>>(new Map());
    const [ready, setReady] = useState(false);

    const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
    const wasmUrl = `${cleanBase}/zk/aggregate/aggregate_js/aggregate.wasm`;
    const zkeyUrl = `${cleanBase}/zk/aggregate/circuit_final.zkey`;

    useEffect(() => {
        onReadyChange?.(ready);
    }, [ready, onReadyChange]);

    useEffect(() => {
        bindAggregateProver(async (input: AggregateZkInput) => {
            if (!ready) {
                throw new Error("prover_not_ready");
            }

            return await new Promise<AggregateProofResult>((resolve, reject) => {
                const id = makeReqId();

                const timeout = setTimeout(() => {
                    pendingRef.current.delete(id);
                    reject(new Error("prover_timeout"));
                }, 120000);

                pendingRef.current.set(id, { resolve, reject, timeout });

                webRef.current?.postMessage(
                    JSON.stringify({
                        type: "PROVE",
                        id,
                        input,
                        wasmUrl,
                        zkeyUrl,
                    }),
                );
            });
        });

        return () => {
            unbindAggregateProver();

            for (const [, pending] of pendingRef.current.entries()) {
                clearTimeout(pending.timeout);
                pending.reject(new Error("prover_unmounted"));
            }
            pendingRef.current.clear();
        };
    }, [ready, wasmUrl, zkeyUrl]);

    function onMessage(event: WebViewMessageEvent) {
        try {
            const msg = JSON.parse(event.nativeEvent.data || "{}");

            if (msg.type === "READY") {
                setReady(true);
                return;
            }

            if (msg.type === "PROVED") {
                const id = String(msg.id || "");
                const pending = pendingRef.current.get(id);
                if (!pending) return;

                clearTimeout(pending.timeout);
                pendingRef.current.delete(id);
                pending.resolve({
                    proof: msg.proof,
                    publicSignals: msg.publicSignals || [],
                });
                return;
            }

            if (msg.type === "ERROR") {
                let handled = false;

                for (const [id, pending] of pendingRef.current.entries()) {
                    clearTimeout(pending.timeout);
                    pendingRef.current.delete(id);
                    pending.reject(new Error(String(msg.error || "prove_failed")));
                    handled = true;
                    break;
                }

                if (!handled) {
                    console.warn("ZkProver ERROR:", msg.error);
                }
            }
        } catch (e) {
            console.warn("ZkProver message parse failed:", e);
        }
    }

    return (
        <View style={styles.hidden}>
            <WebView
                ref={webRef}
                originWhitelist={["*"]}
                source={{ html: PROVER_HTML }}
                onMessage={onMessage}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                onError={() => setReady(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    hidden: {
        width: 1,
        height: 1,
        opacity: 0,
        position: "absolute",
        left: -9999,
        top: -9999,
    },
});