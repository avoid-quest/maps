import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import notices from '../../modules/avoid-navigation/android/src/main/assets/third-party/navigation-notices.json';
import { Button, Icon } from './Controls';

const groups = [
  { id: 'ferrostar', label: 'Ferrostar' },
  { id: 'jna', label: 'JNA e libffi' },
  { id: 'jvm', label: 'Librerie Android' },
  { id: 'rust', label: 'Librerie Rust' },
  { id: 'desugar', label: 'Compatibilità Java' },
] as const;
type Group = typeof groups[number]['id'];

/** The same original notice texts are bundled as native assets and readable offline here. */
export function NavigationNotices({ onLink }: { onLink: (url: string) => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  return <View className="gap-3">
    <Text accessibilityRole="header" className="text-lg font-semibold text-[#17243C]">Licenze dei componenti di navigazione</Text>
    <Text className="text-sm leading-6 text-[#59667A]">I testi originali sono inclusi nell’app e leggibili senza connessione. I collegamenti al codice sorgente richiedono Internet. Queste licenze sono separate da quelle dei dati.</Text>
    <View className="flex-row flex-wrap gap-2">
      {groups.map(item => <Button key={item.id} secondary onPress={() => {
        setGroup(group === item.id ? null : item.id); setExpanded(null);
      }}>{group === item.id ? `Chiudi ${item.label}` : item.label}</Button>)}
    </View>
    {notices.components.filter(component => component.group === group).map(component => <View key={component.id} className="border-b border-[#E2E8F0] pb-3">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === component.id }}
        onPress={() => setExpanded(expanded === component.id ? null : component.id)}
        className="min-h-12 flex-row items-center gap-2 py-2">
        <View className="flex-1 gap-1">
          <Text className="font-semibold text-[#17243C]">{component.name} {component.version}</Text>
          <Text className="text-xs leading-5 text-[#59667A]">{component.license}</Text>
        </View>
        <Icon name={expanded === component.id ? 'chevron-up' : 'chevron-down'} size={18} />
      </Pressable>
      {expanded === component.id ? <View className="gap-3">
        {component.sources.map(url => <Button key={url} secondary icon="open-outline" onPress={() => onLink(url)}>Apri codice o fonte originale</Button>)}
        {component.noticeIds.map(id => {
          const notice = notices.notices.find(item => item.id === id);
          return notice ? <Text key={id} selectable className="text-xs leading-5 text-[#59667A]">{notice.text}</Text> : null;
        })}
      </View> : null}
    </View>)}
  </View>;
}
