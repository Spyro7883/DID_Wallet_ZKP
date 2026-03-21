import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

type SecretKind = "age" | "cit" | "income";

type ZkSecretsIndex = {
  age: string[];
  cit: string[];
  income: string[];
};

export type ZkSecretsBackup = {
  version: 1;
  age: Record<string, any>;
  cit: Record<string, any>;
  income: Record<string, any>;
};

const INDEX_KEY = "zk_index_v1";
const OLD_INDEX_KEY = "zk:index:v1";

function isWeb() {
  return Platform.OS === "web";
}

function safePart(value: string) {
  const out = String(value ?? "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return out || "empty";
}

function legacyKey(kind: SecretKind, commit: string) {
  return `zk_${safePart(kind)}_${safePart(commit)}`;
}

function currentKey(kind: SecretKind, commit: string) {
  return `zk_v1_${safePart(kind)}_${safePart(commit)}`;
}

function oldBrokenCurrentKey(kind: SecretKind, commit: string) {
  return `zk:${String(kind)}:${String(commit)}`;
}

async function getStored(key: string): Promise<string | null> {
  if (isWeb()) {
    return localStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
}

async function setStored(key: string, value: string) {
  if (isWeb()) {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStored(key: string) {
  if (isWeb()) {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function emptyIndex(): ZkSecretsIndex {
  return { age: [], cit: [], income: [] };
}

async function loadIndex(): Promise<ZkSecretsIndex> {
  let raw = await getStored(INDEX_KEY);

  if (!raw && isWeb()) {
    raw = await getStored(OLD_INDEX_KEY);

    if (raw) {
      await setStored(INDEX_KEY, raw);
      await deleteStored(OLD_INDEX_KEY);
    }
  }

  if (!raw) return emptyIndex();

  try {
    const parsed = JSON.parse(raw);
    return {
      age: Array.isArray(parsed?.age) ? parsed.age.map(String) : [],
      cit: Array.isArray(parsed?.cit) ? parsed.cit.map(String) : [],
      income: Array.isArray(parsed?.income) ? parsed.income.map(String) : [],
    };
  } catch {
    return emptyIndex();
  }
}

async function saveIndex(index: ZkSecretsIndex) {
  await setStored(INDEX_KEY, JSON.stringify(index));
}

async function addCommitToIndex(kind: SecretKind, commit: string) {
  const c = String(commit ?? "");
  if (!c) return;

  const index = await loadIndex();
  const arr = index[kind];

  if (!arr.includes(c)) {
    index[kind] = [...arr, c];
    await saveIndex(index);
  }
}

async function removeCommitFromIndex(kind: SecretKind, commit: string) {
  const c = String(commit ?? "");
  if (!c) return;

  const index = await loadIndex();
  index[kind] = index[kind].filter((x) => x !== c);
  await saveIndex(index);
}

export async function saveSecretByCommit(
  kind: SecretKind,
  commit: string,
  payload: any,
) {
  const c = String(commit ?? "");
  if (!c) {
    throw new Error("empty_commit");
  }

  const raw = JSON.stringify(payload);
  await setStored(currentKey(kind, c), raw);
  await addCommitToIndex(kind, c);
}

async function loadSecretByCommit(
  kind: SecretKind,
  commit: string,
): Promise<any | null> {
  const c = String(commit ?? "");
  if (!c) return null;

  const newKey = currentKey(kind, c);
  const oldLegacyKey = legacyKey(kind, c);

  let raw = await getStored(newKey);

  if (!raw) {
    raw = await getStored(oldLegacyKey);

    if (raw) {
      await setStored(newKey, raw);
      await deleteStored(oldLegacyKey);
    }
  }

  if (!raw && isWeb()) {
    const oldColonKey = oldBrokenCurrentKey(kind, c);
    raw = await getStored(oldColonKey);

    if (raw) {
      await setStored(newKey, raw);
      await deleteStored(oldColonKey);
    }
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    await addCommitToIndex(kind, c);
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteSecretByCommit(kind: SecretKind, commit: string) {
  const c = String(commit ?? "");
  if (!c) return;

  await deleteStored(currentKey(kind, c));
  await deleteStored(legacyKey(kind, c));

  if (isWeb()) {
    await deleteStored(oldBrokenCurrentKey(kind, c));
  }

  await removeCommitFromIndex(kind, c);
}

export async function loadAgeSecret(ageCommit: string) {
  return await loadSecretByCommit("age", ageCommit);
}

export async function loadCitizenshipSecret(citizenshipCommit: string) {
  return await loadSecretByCommit("cit", citizenshipCommit);
}

export async function loadIncomeSecret(incomeCommit: string) {
  return await loadSecretByCommit("income", incomeCommit);
}

export async function saveAgeSecret(ageCommit: string, payload: any) {
  await saveSecretByCommit("age", ageCommit, payload);
}

export async function saveCitizenshipSecret(
  citizenshipCommit: string,
  payload: any,
) {
  await saveSecretByCommit("cit", citizenshipCommit, payload);
}

export async function saveIncomeSecret(incomeCommit: string, payload: any) {
  await saveSecretByCommit("income", incomeCommit, payload);
}

export async function exportZkSecrets(): Promise<ZkSecretsBackup> {
  const index = await loadIndex();

  const age: Record<string, any> = {};
  const cit: Record<string, any> = {};
  const income: Record<string, any> = {};

  for (const commit of index.age) {
    const secret = await loadSecretByCommit("age", commit);
    if (secret) age[commit] = secret;
  }

  for (const commit of index.cit) {
    const secret = await loadSecretByCommit("cit", commit);
    if (secret) cit[commit] = secret;
  }

  for (const commit of index.income) {
    const secret = await loadSecretByCommit("income", commit);
    if (secret) income[commit] = secret;
  }

  return {
    version: 1,
    age,
    cit,
    income,
  };
}

export async function importZkSecrets(data: any) {
  const age = data?.age && typeof data.age === "object" ? data.age : {};
  const cit = data?.cit && typeof data.cit === "object" ? data.cit : {};
  const income =
    data?.income && typeof data.income === "object" ? data.income : {};

  for (const [commit, payload] of Object.entries(age)) {
    await saveSecretByCommit("age", commit, payload);
  }

  for (const [commit, payload] of Object.entries(cit)) {
    await saveSecretByCommit("cit", commit, payload);
  }

  for (const [commit, payload] of Object.entries(income)) {
    await saveSecretByCommit("income", commit, payload);
  }
}

export async function clearAllZkSecrets() {
  const index = await loadIndex();

  for (const commit of index.age) {
    await deleteStored(currentKey("age", commit));
    await deleteStored(legacyKey("age", commit));

    if (isWeb()) {
      await deleteStored(oldBrokenCurrentKey("age", commit));
    }
  }

  for (const commit of index.cit) {
    await deleteStored(currentKey("cit", commit));
    await deleteStored(legacyKey("cit", commit));

    if (isWeb()) {
      await deleteStored(oldBrokenCurrentKey("cit", commit));
    }
  }

  for (const commit of index.income) {
    await deleteStored(currentKey("income", commit));
    await deleteStored(legacyKey("income", commit));

    if (isWeb()) {
      await deleteStored(oldBrokenCurrentKey("income", commit));
    }
  }

  await deleteStored(INDEX_KEY);

  if (isWeb()) {
    await deleteStored(OLD_INDEX_KEY);
  }
}
