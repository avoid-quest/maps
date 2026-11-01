import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "../../ui/Text";
import { DATA_LICENSES, PROVIDER_NOTICES } from "../../services";
import Constants from "expo-constants";
import { FONT_NOTICES, MAP_STYLE_NOTICES, ThemePreferenceControl, useThemeColors } from "../../theme";
import { Button, Disclosure, Icon, ListRow, useHairlines, Wordmark, type IconName } from "../../ui";
import { useFeedback } from "../app/feedback";
import { useMapContext } from "../map/useMapModel";
import { NavigationNotices } from "../navigation/NavigationNotices";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { DiscoverySettings } from "./DiscoverySettings";

const PROVIDER_ICONS: IconName[] = ["map-outline", "location-outline", "search-outline", "navigate-outline", "bus-outline", "train-outline"];

/** A licence or notice whose full text expands in place and stays readable offline. */
function LicenceText({ id, title, text, expanded, onToggle }: { id: string; title: string; text: string; expanded: boolean; onToggle: (id: string) => void }) {
  const colors = useThemeColors();
  const hairlines = useHairlines();
  return (
    <View style={hairlines.bottom} className="pb-2">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => onToggle(id)} className="min-h-12 flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-base font-medium text-primary">{title}</Text>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
      </Pressable>
      {expanded ? <Text selectable className="text-sm leading-5 text-secondary">{text}</Text> : null}
    </View>
  );
}

/** Privacy e fonti: appearance, local data, discovery, diagnostics and attribution. */
export function SettingsSheet() {
  const { openLink } = useFeedback();
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded(current => current === id ? null : id);
  const { camera } = useMapContext();
  const [viewForgotten, setViewForgotten] = useState<boolean | null>(null);
  return (
    <View className="gap-4 px-4 py-2">
      <View className="gap-1">
        <Wordmark version={Constants.expoConfig?.version} />
        <Text className="text-sm leading-5 text-secondary">Mappe e trasporti di Torino, senza account. Parte di avoid.quest.</Text>
      </View>
      <ThemePreferenceControl />
      <Text className="text-sm text-secondary">Salvataggi sul dispositivo. Nessun account o telemetria.</Text>
      <Disclosure title="Posizione e privacy">
        <Text className="text-sm leading-5 text-secondary">La mappa usa la posizione se autorizzata. La navigazione richiede un fix preciso e mantiene attivi GPS e voce fino a Stop o arrivo, anche a schermo spento se Android lo consente.</Text>
        <Text className="text-sm leading-5 text-secondary">L’ultima vista della mappa (circa 100 m di precisione) resta su questo dispositivo per riaprire l’app nello stesso punto; non è la tua posizione e non viene inviata.</Text>
        <Button variant="secondary" icon="trash-outline" onPress={() => { void camera.forgetLastView().then(setViewForgotten); }}>Dimentica l’ultima vista</Button>
        {viewForgotten !== null ? <Text accessibilityLiveRegion="polite" className={`text-sm ${viewForgotten ? "text-success" : "text-danger"}`}>{viewForgotten ? "Vista dimenticata. Senza posizione l’app si aprirà su Torino." : "Cancellazione non riuscita. Riprova."}</Text> : null}
        <Text className="text-sm leading-5 text-secondary">Mappe e percorsi inviano area, partenza o destinazione ai fornitori, che ricevono anche l’indirizzo IP. La guida usa una voce italiana offline; le sessioni interrotte richiedono Riprendi.</Text>
      </Disclosure>
      <DiscoverySettings />
      <Disclosure title="Diagnostica locale"><DiagnosticsPanel /></Disclosure>
      <Disclosure title="Fonti e licenze">
        <View className="-mx-4">
          {PROVIDER_NOTICES.map((notice, index) => (
            <ListRow key={notice.name} kind="external" divider={false} icon={PROVIDER_ICONS[index] ?? "information-circle-outline"} title={notice.name} subtitle={notice.text} subtitleLines={0} onPress={() => openLink(notice.url)} accessibilityHint="Apre la pagina della fonte" />
          ))}
        </View>
        <NavigationNotices onLink={openLink} />
        <Text accessibilityRole="header" className="mt-2 text-lg font-semibold text-primary">Stili della mappa</Text>
        <Text className="text-sm leading-5 text-secondary">Stili OpenFreeMap inclusi nell’app; il tema scuro ne modifica i colori. Testi completi leggibili senza connessione.</Text>
        {MAP_STYLE_NOTICES.map(notice => <LicenceText key={notice.id} id={`map:${notice.id}`} title={notice.title} text={notice.text} expanded={expanded === `map:${notice.id}`} onToggle={toggle} />)}
        <Text accessibilityRole="header" className="mt-2 text-lg font-semibold text-primary">Caratteri</Text>
        <Text className="text-sm leading-5 text-secondary">Geist Sans, Geist Mono e Mona Sans sono inclusi nell’app con la SIL Open Font License 1.1.</Text>
        {FONT_NOTICES.map(notice => <LicenceText key={notice.id} id={`font:${notice.id}`} title={notice.title} text={notice.text} expanded={expanded === `font:${notice.id}`} onToggle={toggle} />)}
        <Text accessibilityRole="header" className="mt-2 text-lg font-semibold text-primary">Licenze dei dati</Text>
        {DATA_LICENSES.map(license => <LicenceText key={license.id} id={license.id} title={license.id} text={license.text} expanded={expanded === license.id} onToggle={toggle} />)}
      </Disclosure>
    </View>
  );
}
