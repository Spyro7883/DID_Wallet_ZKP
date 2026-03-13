import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

type SecretKind = "age" | "cit" | "income";

function makeKey(kind: SecretKind, commit: string) {
  return `zk:${kind}:${String(commit)}`;
}

async function setRaw(key: string, value: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
}

export async function saveSecretByCommit(
  kind: SecretKind,
  commit: string,
  payload: any,
) {
  await setRaw(makeKey(kind, commit), JSON.stringify(payload));
}

export async function loadSecretByCommit(
  kind: SecretKind,
  commit: string,
): Promise<any | null> {
  const raw = await getRaw(makeKey(kind, commit));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadAgeSecret(commit: string) {
  return loadSecretByCommit("age", commit);
}

export async function loadCitizenshipSecret(commit: string) {
  return loadSecretByCommit("cit", commit);
}

export async function loadIncomeSecret(commit: string) {
  return loadSecretByCommit("income", commit);
}
