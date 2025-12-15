export type WalletKind = "all" | "did" | "vc" | "vp";

export type RootStackParamList = {
  Welcome: undefined;
  CreateIdentity: undefined;

  Wallet: { profileName?: string } | undefined;

  WalletItems: { kind?: WalletKind } | undefined;
};
