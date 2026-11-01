import { ScrollView } from "react-native";
import { Chip } from "../../ui";
import { SEARCH_CATEGORIES } from "./categories";
import { useSearchContext } from "./useSearch";

/** The empty search's horizontal shortcut row. */
export function CategoryShortcuts() {
  const { chooseCategory } = useSearchContext();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
      {SEARCH_CATEGORIES.map(item => <Chip key={item.query} label={item.label} icon={item.icon} onPress={() => chooseCategory(item.query)} />)}
    </ScrollView>
  );
}
