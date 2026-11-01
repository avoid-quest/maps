import { Pressable, View } from "react-native";
import { Text } from "./Text";

/** A heading for a group of rows, with an optional quiet action such as Aggiorna. */
export function SectionHeader({ title, action, onAction, actionLabel }: {
  title: string; action?: string; onAction?: () => void; actionLabel?: string;
}) {
  return (
    <View className="min-h-12 flex-row items-center gap-3 px-4 pt-2">
      <Text accessibilityRole="header" className="flex-1 text-base font-semibold text-primary">{title}</Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} className="min-h-12 justify-center px-1">
          <Text className="text-sm font-semibold text-action">{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
