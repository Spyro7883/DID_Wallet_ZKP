import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import Welcome from "./screens/welcome";
import CreateIdentity from "./screens/createIdentity";
import WalletScreen from "./screens/walletScreen";

import type { RootStackParamList } from "./src/navigation/types";
import { loadLastWallet } from "./src/storage/walletSession";

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
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Welcome" component={Welcome} />
        <Stack.Screen name="CreateIdentity" component={CreateIdentity} />
        <Stack.Screen
          name="Wallet"
          component={WalletScreen}
          initialParams={initialWalletParams}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
