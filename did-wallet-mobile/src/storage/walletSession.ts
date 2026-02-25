import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const LAST_PROFILE_KEY = "didwallet_last_profile";

const HOLDER_TOKEN_KEY = (profile: string) =>
  `didwallet_holder_token_${safeKey(profile)}`;
const HOLDER_DID_KEY = (profile: string) =>
  `didwallet_holder_did_${safeKey(profile)}`;
const ISSUER_DID_KEY = (profile: string) =>
  `didwallet_issuer_did_${safeKey(profile)}`;

const LAST_VC_REQUEST_ID_KEY = (profile: string) =>
  `didwallet_last_vc_request_${safeKey(profile)}`;

function safeKey(s: string) {
  const out = (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return out || "default";
}

const PASS_KEY = (profile: string) => `didwallet_pass_${safeKey(profile)}`;

async function setSecret(key: string, value: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getSecret(key: string) {
  if (Platform.OS === "web") {
    return await AsyncStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
}

async function deleteSecret(key: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export type WalletSession = {
  profileName: string;
  passphrase: string;

  holderToken?: string;
  holderDid?: string;
  issuerDid?: string;
};

export async function saveLastWallet(profileName: string, passphrase: string) {
  const p = safeKey(profileName);
  await AsyncStorage.setItem(LAST_PROFILE_KEY, p);
  await setSecret(PASS_KEY(p), passphrase);
}

export async function saveHolderSession(
  profileName: string,
  input: {
    holderToken: string;
    holderDid?: string;
    issuerDid?: string;
  },
) {
  const p = safeKey(profileName);
  await setSecret(HOLDER_TOKEN_KEY(p), input.holderToken);

  if (input.holderDid)
    await AsyncStorage.setItem(HOLDER_DID_KEY(p), input.holderDid);
  if (input.issuerDid)
    await AsyncStorage.setItem(ISSUER_DID_KEY(p), input.issuerDid);
}

export async function clearHolderSession(profileName: string) {
  const p = safeKey(profileName);
  await deleteSecret(HOLDER_TOKEN_KEY(p));
  await AsyncStorage.removeItem(HOLDER_DID_KEY(p));
  await AsyncStorage.removeItem(ISSUER_DID_KEY(p));
}

export async function loadLastWallet(): Promise<WalletSession | null> {
  const profileName = await AsyncStorage.getItem(LAST_PROFILE_KEY);
  if (!profileName) return null;

  const passphrase = await getSecret(PASS_KEY(profileName));
  if (!passphrase) return null;

  const holderToken =
    (await getSecret(HOLDER_TOKEN_KEY(profileName))) || undefined;
  const holderDid =
    (await AsyncStorage.getItem(HOLDER_DID_KEY(profileName))) || undefined;
  const issuerDid =
    (await AsyncStorage.getItem(ISSUER_DID_KEY(profileName))) || undefined;

  return { profileName, passphrase, holderToken, holderDid, issuerDid };
}

export async function clearLastWallet() {
  const profileName = await AsyncStorage.getItem(LAST_PROFILE_KEY);
  if (profileName) {
    await deleteSecret(PASS_KEY(profileName));
    await clearHolderSession(profileName);
  }
  await AsyncStorage.removeItem(LAST_PROFILE_KEY);
}

export async function saveLastVcRequest(
  profileName: string,
  requestId: number,
) {
  const p = safeKey(profileName);
  await AsyncStorage.setItem(LAST_VC_REQUEST_ID_KEY(p), String(requestId));
}

export async function loadLastVcRequest(
  profileName: string,
): Promise<number | null> {
  const p = safeKey(profileName);
  const v = await AsyncStorage.getItem(LAST_VC_REQUEST_ID_KEY(p));
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function clearLastVcRequest(profileName: string) {
  const p = safeKey(profileName);
  await AsyncStorage.removeItem(LAST_VC_REQUEST_ID_KEY(p));
}
