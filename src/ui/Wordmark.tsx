import { View } from "react-native";
import { Num, Text } from "./Text";

/** The lowercase product wordmark in Geist Mono, as across the avoid.quest family. */
export function Wordmark({ version }: { version?: string }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={`maps.avoid.quest${version ? `, versione ${version}` : ""}`} className="gap-0.5">
      <Num className="text-lg text-primary">maps.avoid.quest</Num>
      {version ? <Text className="text-sm text-secondary">avoid maps · versione <Num className="text-sm text-secondary">{version}</Num></Text> : null}
    </View>
  );
}
