import * as FileSystem from "expo-file-system";

const FS: any = FileSystem;

// pe web, documentDirectory poate fi null
export const BACKUPS_DIR: string | null =
  FS.documentDirectory ?? FS.cacheDirectory
    ? `${FS.documentDirectory ?? FS.cacheDirectory}backups/`
    : null;

export async function ensureBackupsDir(): Promise<string | null> {
  if (!BACKUPS_DIR) return null;
  try {
    await FS.makeDirectoryAsync(BACKUPS_DIR, { intermediates: true });
  } catch {
    // exista deja
  }
  return BACKUPS_DIR;
}

export async function listLocalBackups(): Promise<string[]> {
  const dir = await ensureBackupsDir();
  if (!dir) return [];
  try {
    const files = await (FS.readDirectoryAsync(dir) as Promise<string[]>);
    return files
      .filter((f) => f.toLowerCase().endsWith(".wallet.json"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
