import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const FS = FileSystem;

const baseDir: string | null =
  FS.documentDirectory ?? FS.cacheDirectory ?? null;

export const BACKUPS_DIR: string | null = baseDir ? `${baseDir}backups/` : null;

export async function ensureBackupsDir(): Promise<string | null> {
  if (!BACKUPS_DIR) return null;

  // Pe web expo-file-system e limitat; mai safe să nu încerci folder
  if (Platform.OS === "web") return null;

  const info = await FS.getInfoAsync(BACKUPS_DIR);
  if (!info.exists) {
    await FS.makeDirectoryAsync(BACKUPS_DIR, { intermediates: true });
  }
  return BACKUPS_DIR;
}

export async function listLocalBackups(): Promise<string[]> {
  const dir = await ensureBackupsDir();
  if (!dir) return [];
  const files = await FS.readDirectoryAsync(dir);
  return files
    .filter((f: string) => f.toLowerCase().endsWith(".wallet.json"))
    .sort()
    .reverse();
}
