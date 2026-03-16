import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

type SecretKind = "age" | "cit" | "income";

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

export async function saveSecretByCommit(
  kind: SecretKind,
  commit: string,
  payload: any,
) {
  const raw = JSON.stringify(payload);
  await setStored(currentKey(kind, commit), raw);
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
    }
  }

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
