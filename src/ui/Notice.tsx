import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useThemeColors } from "../theme/ThemeProvider";
import type { ThemeColors } from "../theme/palette";
import { useHairlines } from "./Divider";
import { Icon, type IconName } from "./Icon";

export type NoticeTone = "info" | "caution" | "danger" | "success";

const tones: Record<NoticeTone, { surface: string; icon: IconName; color: keyof ThemeColors; spoken: string }> = {
  info: { surface: "", icon: "information-circle-outline", color: "textSecondary", spoken: "Informazione" },
  caution: { surface: "bg-caution-subtle", icon: "warning-outline", color: "caution", spoken: "Attenzione" },
  danger: { surface: "bg-danger-subtle", icon: "alert-circle-outline", color: "danger", spoken: "Errore" },
  success: { surface: "bg-success-subtle", icon: "checkmark-circle-outline", color: "success", spoken: "Fatto" },
};

/**
 * Status beside the content it explains. Information is a hairline box; caution, danger and success
 * keep their tinted fill because their colour carries meaning. Tone is carried by icon, wording and the spoken prefix,
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
  const hairlines = useHairlines();
  const style = tones[tone];
  return (
    <View style={tone === "info" ? hairlines.box : undefined} className={`flex-row items-start gap-3 rounded-2xl px-4 py-3 ${style.surface}`}>
      <View className="pt-0.5"><Icon name={style.icon} size={20} color={colors[style.color]} /></View>
      <View className="flex-1">
        {/* A live region so TalkBack announces notices that appear or change after render. */}
        <View accessible accessibilityLiveRegion={tone === "danger" ? "assertive" : "polite"} accessibilityLabel={`${style.spoken}: ${title ? `${title}. ` : ""}${text}`} className="gap-0.5">
          {title ? <Text className="text-base font-semibold text-primary">{title}</Text> : null}
          <Text className="text-sm leading-5 text-primary">{text}</Text>
        </View>
        {action && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={4} className="min-h-12 justify-center self-start">
            <Text className="text-sm font-semibold text-primary underline">{action}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
