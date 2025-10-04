export const ISO_ALPHA2_TO_NUMERIC: Record<string, number> = {
  RO: 642,
  ES: 724,
  DE: 276,
  FR: 250,
  US: 840,
  GB: 826,
  IT: 380,
  PT: 620,
  NL: 528,
  BE: 56,
  SE: 752,
  NO: 578,
  DK: 208,
  FI: 246,
  PL: 616,
  CZ: 203,
  AT: 40,
  HU: 348,
};

export function alpha2ToNumeric(alpha2: string): bigint {
  const code = (alpha2 || "").toUpperCase().trim();
  const norm = code === "UK" ? "GB" : code;
  const num = ISO_ALPHA2_TO_NUMERIC[norm];
  if (num === undefined) throw new Error(`Unknown ISO alpha-2: ${alpha2}`);
  return BigInt(num);
}
