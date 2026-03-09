import * as SecureStore from "expo-secure-store";

export async function saveSecretByCommit(
  kind: "age" | "cit" | "income",
  commit: string,
  payload: any,
) {
  await SecureStore.setItemAsync(
    `zk:${kind}:${commit}`,
    JSON.stringify(payload),
  );
}

export async function loadSecretByCommit(
  kind: "age" | "cit" | "income",
  commit: string,
): Promise<any | null> {
  const raw = await SecureStore.getItemAsync(`zk:${kind}:${commit}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
