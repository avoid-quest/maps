import { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { Text } from "../../ui/Text";
import { useThemeColors } from "../../theme";
import { Disclosure, EmptyState, Loading, Notice, Num, SectionHeader, SheetFlatList } from "../../ui";
import { formatDistance } from "../../ui/format";
import { useDistanceReference } from "../map/useDistanceReference";
import { PlaceRow } from "../places/PlaceRow";
import { usePlacesContext } from "../places/usePlaces";
import { StopRow } from "../transit/StopRow";
import { useTransitContext } from "../transit/useTransit";
import { searchRowCount, searchRows } from "./search-rows";
import { useSearchContext } from "./useSearch";

/** Results with their count, limits, coverage and sources: places, addresses, and GTT stops and lines. */
export function SearchResults() {
  const colors = useThemeColors();
  const { result, transit, searching, error, policy, retry } = useSearchContext();
  const { isSaved, openPlace } = usePlacesContext();
  const { openStop } = useTransitContext();
  const reference = useDistanceReference();
  // Stops and lines come from the bundled catalog, so they appear in either search policy.
  const rows = useMemo(() => searchRows(result.places, transit), [result.places, transit]);
  const count = searchRowCount(rows);
  const header = (<>
    <View className="h-9 flex-row items-center gap-2 px-4">
      <View className="w-4">{searching ? <ActivityIndicator size="small" color={colors.textPrimary} /> : null}</View>
      <Text numberOfLines={1} accessibilityLiveRegion="polite" className="flex-1 text-sm text-secondary">{searching ? "Aggiorno i risultati…" : <><Num className="text-sm text-primary">{count}</Num> {count === 1 ? "risultato" : "risultati"}{result.truncated ? <> · primi <Num className="text-sm text-secondary">{result.resultLimit}</Num> luoghi</> : null}{policy === "local-only" ? " · solo locali" : ""}</>}</Text>
    </View>
    {error && count ? <View className="px-4 pb-2"><Notice tone="danger" text={error} action="Riprova" onAction={retry} /></View> : null}
  </>);
  const empty = searching ? <Loading label="Cerco nell’area…" />
    : error ? <View className="m-4"><Notice tone="danger" text={error} action="Riprova" onAction={retry} /></View>
      : <EmptyState
        icon="search-outline"
        title={result.coverage.extent === "outside" ? "Fuori dal pacchetto locale" : "Nessuna corrispondenza"}
        description={result.coverage.extent === "outside" ? "Dati locali non disponibili qui. Sposta la mappa." : policy === "local-only" ? "Prova un altro nome o attiva la ricerca online nelle impostazioni." : "Prova un altro nome. I dati possono essere incompleti."}
      />;
  const footer = (
    <View className="px-4 pb-6">
      <Disclosure title="Copertura e fonti">
        <Text className="text-sm leading-5 text-secondary">{result.coverage.radiusMeters !== null
          ? `Raggio ${formatDistance(result.coverage.radiusMeters)} · ${result.coverage.extent === "outside" ? "fuori dal pacchetto locale" : result.coverage.extent === "partial" ? "copertura locale parziale" : "nel pacchetto locale"}`
          : `Nomi nel pacchetto locale${result.coverage.centerInside ? "" : " · centro fuori copertura"}${policy === "local-and-online" ? "; Photon online" : ""}`}</Text>
        {result.warnings.map((warning, index) => <Notice key={index} tone="caution" text={warning} />)}
        <Text className="text-sm leading-5 text-secondary">Luoghi da OpenStreetMap e Overture; quartieri approssimati da OpenStreetMap. Fermate e linee dagli orari GTT inclusi nell’app. Le informazioni possono essere incomplete.</Text>
      </Disclosure>
    </View>
  );
  return (
    <SheetFlatList
      data={rows}
      keyExtractor={row => row.key}
      renderItem={({ item }) => item.kind === "section" ? <SectionHeader title={item.title} />
        : item.kind === "stop" ? <StopRow stop={item.stop} line={item.line} reference={reference} onPress={() => openStop(item.stop)} />
          : <PlaceRow place={item.place} saved={isSaved(item.place.id)} reference={reference} onPress={() => openPlace(item.place)} />}
      extraData={reference}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
    />
  );
}
