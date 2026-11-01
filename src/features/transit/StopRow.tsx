import { View } from "react-native";
import type { Stop } from "../../domain/types";
import { useThemeColors } from "../../theme";
import { Icon, ListRow, TransitLineBadge, transitModeFromLineName } from "../../ui";
import { distanceFrom, type DistanceReference } from "../map/distance-reference";

/** A GTT stop in a list; `line` leads with that line's badge when the row answers a line search. */
export function StopRow({ stop, line, reference, onPress }: { stop: Stop; line?: string; reference: DistanceReference; onPress: () => void }) {
  const colors = useThemeColors();
  const distance = distanceFrom(reference, stop.coordinate);
  const lines = stop.lines.slice(0, 6).join(", ") || "GTT";
  return (
    <ListRow
      title={stop.name}
      subtitle={`Fermata ${stop.code} · ${lines}`}
      meta={distance.value}
      metaNote={distance.note ?? undefined}
      accessibilityLabel={`${line ? `Linea ${line}, ` : ""}${stop.name}, fermata ${stop.code}, linee ${lines}, ${distance.spoken}`}
      leading={line
        ? <View className="w-11 items-center"><TransitLineBadge line={line} mode={transitModeFromLineName(line)} /></View>
        : <View className="w-7 items-center"><Icon name="bus-outline" size={20} color={colors.textSecondary} /></View>}
      onPress={onPress}
    />
  );
}
