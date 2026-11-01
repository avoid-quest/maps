import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { DATA_LICENSES, PROVIDER_NOTICES } from "../../services";
import { ActionRow } from "../../ui/ActionRow";
import { Disclosure, Icon, type IconName } from "../../ui/Controls";
import { useFeedback } from "../app/feedback";
import { NavigationNotices } from "../navigation/NavigationNotices";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { DiscoverySettings } from "./DiscoverySettings";

/** Privacy e fonti: local data, discovery, diagnostics and attribution. */
export function SettingsSheet() {
  const { openLink: onLink } = useFeedback();
  const [expanded, setExpanded] = useState<string | null>(null);
  const icons: IconName[] = [
    "map-outline",
    "location-outline",
    "search-outline",
    "navigate-outline",
    "bus-outline",
    "train-outline",
  ];
  return (
    <View className="gap-3 p-4">
      <Text className="text-sm text-[#59667A]">Salvataggi sul dispositivo. Nessun account o telemetria.</Text>
      <Disclosure title="Posizione e privacy">
        <Text className="text-sm leading-5 text-[#59667A]">La mappa usa la posizione se autorizzata. La navigazione richiede un fix preciso e mantiene attivi GPS e voce fino a Stop o arrivo, anche a schermo spento se Android lo consente.</Text>
        <Text className="text-sm leading-5 text-[#59667A]">Mappe e percorsi inviano area, partenza o destinazione ai fornitori, che ricevono anche l’indirizzo IP. La guida usa una voce italiana offline; le sessioni interrotte richiedono Riprendi.</Text>
      </Disclosure>
      <DiscoverySettings />
      <Disclosure title="Diagnostica locale"><DiagnosticsPanel /></Disclosure>
      <Disclosure title="Fonti e licenze">
      {PROVIDER_NOTICES.map((notice, index) => (
        <View key={notice.name}>
          <ActionRow
            icon={icons[index] ?? "information-circle-outline"}
            title={notice.name}
            subtitle="Informazioni sulla fonte"
            onPress={() => onLink(notice.url)}
          />
          <Text className="mt-2 text-sm leading-5 text-[#59667A]">
            {notice.text}
          </Text>
        </View>
      ))}

      <NavigationNotices onLink={onLink} />
      <Text className="mt-2 text-lg font-semibold text-[#17243C]">
        Licenze dei dati
      </Text>
      {DATA_LICENSES.map((license) => (
        <View key={license.id} className="border-b border-[#E2E8F0] pb-3">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: expanded === license.id }}
            onPress={() =>
              setExpanded(expanded === license.id ? null : license.id)
            }
            className="min-h-12 flex-row items-center justify-between"
          >
            <Text className="flex-1 font-semibold text-[#17243C]">
              {license.id}
            </Text>
            <Icon
              name={expanded === license.id ? "chevron-up" : "chevron-down"}
              size={18}
            />
          </Pressable>
          {expanded === license.id ? (
            <Text selectable className="text-xs leading-5 text-[#59667A]">
              {license.text}
            </Text>
          ) : null}
        </View>
      ))}
      </Disclosure>
    </View>
  );
}
