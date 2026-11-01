import { Pressable, ScrollView, Text } from "react-native";
import { colors } from "../../theme/tokens";
import { Icon } from "../../ui/Controls";
import { SEARCH_CATEGORIES } from "./categories";
import { useSearchContext } from "./useSearch";

/** The empty search's horizontal shortcut row. */
export function CategoryShortcuts() {
  const { chooseCategory } = useSearchContext();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
      {SEARCH_CATEGORIES.map(item => <Pressable key={item.query} accessibilityRole="button" onPress={() => chooseCategory(item.query)} className="min-h-12 flex-row items-center gap-2 rounded-full bg-[#F3F6FA] px-4">
        <Icon name={item.icon} size={18} color={colors.muted} />
        <Text className="text-sm text-[#17243C]">{item.label}</Text>
      </Pressable>)}
    </ScrollView>
  );
}
