import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import type { ThemeColors } from "../theme/palette";
import { Icon, type IconName } from "./Icon";

export type NoticeTone = "info" | "caution" | "danger" | "success";

const tones: Record<NoticeTone, { surface: string; icon: IconName; color: keyof ThemeColors; spoken: string }> = {
  info: { surface: "bg-surface-muted", icon: "information-circle-outline", color: "textSecondary", spoken: "Informazione" },
  caution: { surface: "bg-caution-subtle", icon: "warning-outline", color: "caution", spoken: "Attenzione" },
  danger: { surface: "bg-danger-subtle", icon: "alert-circle-outline", color: "danger", spoken: "Errore" },
  success: { surface: "bg-success-subtle", icon: "checkmark-circle-outline", color: "success", spoken: "Fatto" },
};

/**
 * Status beside the content it explains. Tone is carried by icon, wording and the spoken prefix,
 * never by colour alone. The optional action is a relevant next step such as Riprova.
 */
export function Notice({ text, tone = "info", title, action, onAction }: {
  text: string;
  tone?: NoticeTone;
  title?: string;
  action?: string;
  onAction?: () => void;
}) {
  const colors = useThemeColors();
  const style = tones[tone];
  return (
    <View className={`flex-row items-start gap-3 rounded-2xl px-4 py-3 ${style.surface}`}>
      <View className="pt-0.5"><Icon name={style.icon} size={20} color={colors[style.color]} /></View>
      <View className="flex-1">
        <View accessible accessibilityLabel={`${style.spoken}: ${title ? `${title}. ` : ""}${text}`} className="gap-0.5">
          {title ? <Text className="text-base font-semibold text-primary">{title}</Text> : null}
          <Text className="text-sm leading-5 text-primary">{text}</Text>
        </View>
        {action && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={4} className="min-h-12 justify-center self-start">
            <Text className="text-sm font-semibold text-action">{action}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
