import "./global.css";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProviders } from "./src/features/app/AppProviders";
import { AppShell } from "./src/features/app/AppShell";
import { ThemeProvider } from "./src/theme";
import { registerBrandFonts } from "./src/theme/fonts";

registerBrandFonts();

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
