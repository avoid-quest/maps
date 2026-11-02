import { ActivityIndicator, View } from 'react-native';
import { TRANSITOUS_PRIVACY_URL, TRANSITOUS_SOURCES_URL } from '../../services/transitous';
import { useThemeColors } from '../../theme';
import { Button, EmptyState, IconButton, Notice, Num, Text, TransitLineBadge, useHairlines } from '../../ui';
import { journeyTime } from '../planner/journey-presentation';
import { providerRowView, type ProviderTone } from './provider-board';
import type { ProviderBoardState } from './useProviderBoard';

const TONE: Record<ProviderTone, string> = {
  declared: 'text-primary', scheduled: 'text-scheduled', caution: 'text-caution', disruption: 'text-cancelled font-semibold',
};

/** Shown before the first Transitous request: what is sent, to whom, and for how long it is kept. */
export function TransitousDisclosure({ text, onAccept, onCancel, onLink }: { text: string; onAccept: () => void; onCancel?: () => void; onLink: (url: string) => void }) {
  const hairlines = useHairlines();
  return <View testID="transitous-disclosure" style={hairlines.box} className="gap-3 rounded-2xl p-4">
    <Text accessibilityRole="header" className="text-base font-semibold text-primary">Richiesta a Transitous</Text>
    <Text className="text-sm leading-5 text-primary">{text}</Text>
    <View className="flex-row flex-wrap gap-2">
      <Button icon="cloud-download-outline" onPress={onAccept}>Continua</Button>
      {onCancel ? <Button variant="secondary" onPress={onCancel}>Annulla</Button> : null}
    </View>
    <View className="self-start"><Button variant="quiet" role="link" icon="open-outline" onPress={() => onLink(TRANSITOUS_PRIVACY_URL)}>Privacy di Transitous</Button></View>
  </View>;
}

/**
 * A Transitous board: its own source line, rows with written realtime state and platform, warnings,
 * attribution and the sources link. Rows are never combined with GTT rows.
 */
export function ProviderBoardView({ state, now, onLink, emptyTitle }: { state: ProviderBoardState; now: number; onLink: (url: string) => void; emptyTitle: string }) {
  const colors = useThemeColors();
  const { board, loading, error, refresh } = state;
  const fresh = board ? now < board.nextRefreshAt : false;
  return <View className="gap-3">
    <View className="flex-row items-center gap-2 px-4">
      <Text className="min-w-0 flex-1 text-sm leading-5 text-secondary">
        Fonte online: Transitous{board ? <> · consultato alle <Num className="text-sm text-secondary">{journeyTime(board.retrievedAt)}</Num></> : null}
        {board && now - board.retrievedAt > 120_000 ? ' · da aggiornare' : ''}
      </Text>
      <IconButton icon="refresh-outline" label={fresh ? 'Aggiorna (dati appena consultati)' : 'Aggiorna da Transitous'} busy={loading} disabled={loading} onPress={refresh} />
    </View>
    {loading && !board ? <View accessibilityLiveRegion="polite" className="flex-row items-center gap-3 px-4 py-2"><ActivityIndicator color={colors.action} /><Text className="text-sm text-secondary">Chiedo gli orari a Transitous…</Text></View> : null}
    {error ? <View className="px-4"><Notice tone="danger" text={`${error}${board ? ' Restano visibili gli orari consultati prima.' : ''}`} action="Riprova" onAction={refresh} /></View> : null}
    {board ? <>
      {board.warnings.map((warning, index) => <View key={index} className="px-4"><Notice tone="caution" text={warning} /></View>)}
      {board.rows.length ? <View>{board.rows.map(row => <ProviderRow key={row.id} row={providerRowView(row)} />)}</View>
        : <EmptyState icon="time-outline" title={emptyTitle} description="Transitous non ha restituito corse da mostrare." />}
      <View className="gap-1 px-4">
        {board.attributions.map(attribution => <Text key={attribution} className="text-sm leading-5 text-secondary">{attribution}</Text>)}
        <View className="self-start"><Button variant="quiet" role="link" icon="open-outline" onPress={() => onLink(board.sourcesUrl ?? TRANSITOUS_SOURCES_URL)}>Fonti dei dati Transitous</Button></View>
      </View>
    </> : null}
  </View>;
}

function ProviderRow({ row }: { row: ReturnType<typeof providerRowView> }) {
  const hairlines = useHairlines();
  return <View accessible accessibilityLabel={row.accessibilityLabel} style={hairlines.bottom} className="min-h-16 flex-row items-center gap-3 px-4 py-3">
    {row.line ? <TransitLineBadge line={row.line} mode={row.mode} /> : <View style={{ minWidth: 44 }} />}
    <View className="min-w-0 flex-1">
      <Text numberOfLines={2} className="text-base font-medium leading-5 text-primary">{row.headsign}</Text>
      <Text className={`mt-0.5 text-sm ${TONE[row.tone]}`}>{row.status}</Text>
      {row.platform || row.operator ? <Text className="mt-0.5 text-sm text-secondary">{[row.platform, row.operator].filter(Boolean).join(' · ')}</Text> : null}
    </View>
    <View className="min-w-14 items-end">
      <Num style={row.tone === 'disruption' ? { textDecorationLine: 'line-through' } : undefined} className={`text-xl ${TONE[row.tone]}`}>{row.time}</Num>
      {row.scheduled ? <Num style={{ textDecorationLine: 'line-through' }} className="text-sm text-secondary">{row.scheduled}</Num> : null}
    </View>
  </View>;
}
