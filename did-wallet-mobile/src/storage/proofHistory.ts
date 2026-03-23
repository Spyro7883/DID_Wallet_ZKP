import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "didwallet_proof_history_v1";
const MAX_ITEMS = 100;

export type ProofHistoryItem = {
  localId: string;
  proofRequestId: string;
  policy: string;
  holderDid: string;
  createdAt: string;
  result: "accepted" | "rejected";
  error?: string | null;
  vpHash?: string | null;
  eventId?: string | null;
  eventTitle?: string | null;
  accessCode?: string | null;
  checkoutUrl?: string | null;
  expiresAt?: string | null;
};

export type SaveProofHistoryInput = {
  proofRequestId: string;
  policy: string;
  holderDid: string;
  result: "accepted" | "rejected";
  error?: string | null;
  vpHash?: string | null;
  eventId?: string | null;
  eventTitle?: string | null;
  accessCode?: string | null;
  checkoutUrl?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
};

function makeLocalId() {
  return `proof_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sortDesc(items: ProofHistoryItem[]) {
  return [...items].sort(
    (a, b) =>
      Date.parse(String(b.createdAt || "")) -
      Date.parse(String(a.createdAt || "")),
  );
}

function normalizeItem(x: any): ProofHistoryItem | null {
  if (!x || typeof x !== "object") return null;
  if (!x.proofRequestId || !x.policy || !x.holderDid || !x.result) return null;

  return {
    localId: String(x.localId || makeLocalId()),
    proofRequestId: String(x.proofRequestId),
    policy: String(x.policy),
    holderDid: String(x.holderDid),
    createdAt: String(x.createdAt || new Date().toISOString()),
    result: x.result === "rejected" ? "rejected" : "accepted",
    error: x.error ? String(x.error) : null,
    vpHash: x.vpHash ? String(x.vpHash) : null,
    eventId: x.eventId ? String(x.eventId) : null,
    eventTitle: x.eventTitle ? String(x.eventTitle) : null,
    accessCode: x.accessCode ? String(x.accessCode) : null,
    checkoutUrl: x.checkoutUrl ? String(x.checkoutUrl) : null,
    expiresAt: x.expiresAt ? String(x.expiresAt) : null,
  };
}

async function readRaw(): Promise<ProofHistoryItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeItem).filter((x): x is ProofHistoryItem => !!x);
  } catch {
    return [];
  }
}

async function writeRaw(items: ProofHistoryItem[]) {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(sortDesc(items).slice(0, MAX_ITEMS)),
  );
}

export async function listProofHistory(): Promise<ProofHistoryItem[]> {
  return sortDesc(await readRaw());
}

export async function saveProofHistoryItem(
  input: SaveProofHistoryInput,
): Promise<ProofHistoryItem> {
  const current = await readRaw();

  const item: ProofHistoryItem = {
    localId: makeLocalId(),
    proofRequestId: String(input.proofRequestId),
    policy: String(input.policy),
    holderDid: String(input.holderDid),
    createdAt: String(input.createdAt || new Date().toISOString()),
    result: input.result,
    error: input.error ? String(input.error) : null,
    vpHash: input.vpHash ? String(input.vpHash) : null,
    eventId: input.eventId ? String(input.eventId) : null,
    eventTitle: input.eventTitle ? String(input.eventTitle) : null,
    accessCode: input.accessCode ? String(input.accessCode) : null,
    checkoutUrl: input.checkoutUrl ? String(input.checkoutUrl) : null,
    expiresAt: input.expiresAt ? String(input.expiresAt) : null,
  };

  const withoutSameRequest = current.filter(
    (x) => String(x.proofRequestId) !== String(item.proofRequestId),
  );

  const next = [item, ...withoutSameRequest];
  await writeRaw(next);

  return item;
}

export async function removeProofHistoryItem(localId: string) {
  const current = await readRaw();
  const next = current.filter((x) => x.localId !== String(localId));
  await writeRaw(next);
}

export async function clearProofHistory() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
