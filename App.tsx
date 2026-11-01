import "./global.css";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProviders } from "./src/features/app/AppProviders";
import { AppShell } from "./src/features/app/AppShell";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <AppShell />
      </AppProviders>
    </SafeAreaProvider>
  );
}
