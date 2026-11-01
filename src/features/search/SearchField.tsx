import { TextInput, View } from "react-native";
import { useThemeColors } from "../../theme";
import { Icon, IconButton, useHairlines } from "../../ui";
import { useShellActions } from "../app/useShellActions";
import { useTaskState } from "../app/useTaskModel";
import { useSearchContext } from "./useSearch";

export function SearchField() {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  const search = useSearchContext();
  const tasks = useTaskState();
  const { closeTask } = useShellActions();
  return (
    <View style={hairlines.floating} className="min-h-12 min-w-0 flex-1 flex-row items-center rounded-full px-1">
      {tasks.root.kind === "search" ? <IconButton icon="arrow-back" label="Chiudi ricerca" onPress={closeTask} /> : <View className="h-12 w-12 items-center justify-center"><Icon name="search-outline" color={colors.textSecondary} size={21} /></View>}
      <TextInput
        ref={search.inputRef}
        onFocus={search.focus}
        accessibilityLabel="Cerca luoghi, indirizzi o attività"
        className="min-h-12 min-w-0 flex-1 px-2 font-sans text-base text-primary"
        placeholder="Cerca un luogo o indirizzo"
        placeholderTextColor={colors.textSecondary}
        selectionColor={colors.action}
        cursorColor={colors.action}
        value={search.query}
        returnKeyType="search"
        autoCorrect={false}
        onChangeText={search.changeQuery}
        onSubmitEditing={search.submit}
      />
      {search.query ? <IconButton icon="close" label="Cancella ricerca" onPress={closeTask} /> : null}
    </View>
  );
}
