import { TextInput, View } from "react-native";
import { colors } from "../../theme/tokens";
import { Icon, IconButton } from "../../ui/Controls";
import { useShellActions } from "../app/useShellActions";
import { useTaskState } from "../app/useTaskModel";
import { useSearchContext } from "./useSearch";

export function SearchField() {
  const search = useSearchContext();
  const tasks = useTaskState();
  const { closeTask } = useShellActions();
  return (
    <View className="min-h-12 min-w-0 flex-1 flex-row items-center rounded-2xl bg-white pl-1 pr-1 border border-[#E2E8F0]">
      {tasks.root.kind === "search" ? <IconButton icon="arrow-back" label="Chiudi ricerca" onPress={closeTask} /> : <View className="h-12 w-12 items-center justify-center"><Icon name="search-outline" color={colors.muted} size={21} /></View>}
      <TextInput
        ref={search.inputRef}
        onFocus={search.focus}
        accessibilityLabel="Cerca luoghi, indirizzi o attività"
        className="min-h-12 min-w-0 flex-1 px-3 text-base text-[#17243C]"
        placeholder="Cerca un luogo o indirizzo"
        placeholderTextColor={colors.muted}
        value={search.query}
        returnKeyType="search"
        autoCorrect={false}
        onChangeText={search.changeQuery}
        onSubmitEditing={search.submit}
      />
      {search.query ? (
        <IconButton
          icon="close"
          label="Cancella ricerca"
          onPress={closeTask}
        />
      ) : null}
    </View>
  );
}
