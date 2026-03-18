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

const INDEX_KEY = "zk:index:v1";

function legacyKey(kind: SecretKind, commit: string) {
  const safeCommit = String(commit).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `zk_${kind}_${safeCommit}`;
}

function currentKey(kind: SecretKind, commit: string) {
  return `zk:${kind}:${String(commit)}`;
}

async function getStored(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
}

async function setStored(key: string, value: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStored(key: string) {
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function emptyIndex(): ZkSecretsIndex {
  return { age: [], cit: [], income: [] };
}

async function loadIndex(): Promise<ZkSecretsIndex> {
  const raw = await getStored(INDEX_KEY);
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
  const c = String(commit);
  const index = await loadIndex();
  const arr = index[kind];

  if (!arr.includes(c)) {
    index[kind] = [...arr, c];
    await saveIndex(index);
  }
}

async function removeCommitFromIndex(kind: SecretKind, commit: string) {
  const c = String(commit);
  const index = await loadIndex();
  index[kind] = index[kind].filter((x) => x !== c);
  await saveIndex(index);
}

export async function saveSecretByCommit(
  kind: SecretKind,
  commit: string,
  payload: any,
) {
  const raw = JSON.stringify(payload);
  await setStored(currentKey(kind, commit), raw);
  await addCommitToIndex(kind, commit);
}

async function loadSecretByCommit(
  kind: SecretKind,
  commit: string,
): Promise<any | null> {
  const newKey = currentKey(kind, commit);
  const oldKey = legacyKey(kind, commit);

  let raw = await getStored(newKey);

  if (!raw) {
    raw = await getStored(oldKey);

    if (raw) {
      await setStored(newKey, raw);
      await deleteStored(oldKey);
      await addCommitToIndex(kind, commit);
    }
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    await addCommitToIndex(kind, commit);
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteSecretByCommit(kind: SecretKind, commit: string) {
  await deleteStored(currentKey(kind, commit));
  await deleteStored(legacyKey(kind, commit));
  await removeCommitFromIndex(kind, commit);
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
  }

  for (const commit of index.cit) {
    await deleteStored(currentKey("cit", commit));
    await deleteStored(legacyKey("cit", commit));
  }

  for (const commit of index.income) {
    await deleteStored(currentKey("income", commit));
    await deleteStored(legacyKey("income", commit));
  }

  await deleteStored(INDEX_KEY);
}
