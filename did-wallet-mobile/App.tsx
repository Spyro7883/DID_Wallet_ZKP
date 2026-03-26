import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppThemeProvider } from "./src/theme/AppThemeProvider";

import Welcome from "./screens/welcome";
import CreateIdentity from "./screens/createIdentity";
import WalletScreen from "./screens/walletScreen";
import WalletItems from "./screens/walletItems";
import BackupScreen from "./screens/createBackup";
import ImportBackupScreen from "./screens/importBackup";
import type { RootStackParamList } from "./src/navigation/types";
import { loadLastWallet } from "./src/storage/walletSession";
import CreateDid from "./screens/createDid";
import CreateVC from "./screens/createVC";

import ProofRequestScreen from "./screens/proofRequestScreen";
import ProofHistoryScreen from "./screens/proofHistory";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [ready, setReady] = React.useState(false);
  const [initialRoute, setInitialRoute] =
    React.useState<keyof RootStackParamList>("Welcome");
  const [initialWalletParams, setInitialWalletParams] =
    React.useState<RootStackParamList["Wallet"] | undefined>(undefined);

  React.useEffect(() => {
    (async () => {
      const sess = await loadLastWallet();
      if (sess) {
        setInitialRoute("Wallet");
        setInitialWalletParams({ profileName: sess.profileName });
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <NavigationContainer>
          <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Welcome" component={Welcome} />
            <Stack.Screen name="CreateIdentity" component={CreateIdentity} />
            <Stack.Screen
              name="Wallet"
              component={WalletScreen}
              initialParams={initialWalletParams}
            />
            <Stack.Screen name="WalletItems" component={WalletItems} />
            <Stack.Screen name="Backup" component={BackupScreen} />
            <Stack.Screen name="ImportBackup" component={ImportBackupScreen} />
            <Stack.Screen name="CreateDid" component={CreateDid} />
            <Stack.Screen name="CreateCredential" component={CreateVC} />
            <Stack.Screen name="ProofRequest" component={ProofRequestScreen} />
            <Stack.Screen name="ProofHistory" component={ProofHistoryScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}