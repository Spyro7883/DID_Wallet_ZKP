import * as Random from "expo-random";

export async function randomSalt31(): Promise<bigint> {
  const bytes = await Random.getRandomBytesAsync(31);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return BigInt("0x" + hex);
}
