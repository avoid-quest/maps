import "./global.css";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProviders } from "./src/features/app/AppProviders";
import { AppShell } from "./src/features/app/AppShell";
import { ThemeProvider } from "./src/theme";
import * as SplashScreen from "expo-splash-screen";
import { registerBrandFonts } from "./src/theme/fonts";

registerBrandFonts();
// ThemeProvider hides the splash once the stored appearance is known, so a saved Chiaro/Scuro
// choice never flashes the system palette on cold start.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppProviders>
            <AppShell />
          </AppProviders>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
