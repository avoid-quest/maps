import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { IconButton } from "./IconButton";

/**
 * Task title with one clear way out. Pass `onBack` to return to the task beneath and `onClose`
 * to return to the map; supply both only when they lead to different places.
 */
export function SheetHeader({ title, subtitle, onBack, onClose, backLabel = "Indietro", closeLabel = "Chiudi", actions }: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onClose?: () => void;
  backLabel?: string;
  closeLabel?: string;
  /** Task actions placed before the close control, such as save or expand. */
  actions?: ReactNode;
}) {
  return (
    <View className="min-h-14 flex-row items-center gap-1 px-2">
      {onBack ? <IconButton icon="arrow-back" label={backLabel} onPress={onBack} /> : <View className="w-2" />}
      <View className="min-w-0 flex-1 py-1">
        <Text accessibilityRole="header" numberOfLines={2} className="text-lg font-semibold leading-6 text-primary">{title}</Text>
        {subtitle ? <Text numberOfLines={1} className="text-sm text-secondary">{subtitle}</Text> : null}
      </View>
      {actions}
      {onClose ? <IconButton icon="close" label={closeLabel} onPress={onClose} /> : null}
    </View>
  );
}
