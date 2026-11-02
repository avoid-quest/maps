import { useRef } from 'react';
import { View } from 'react-native';
import { Display, Text } from '../../ui';
import { MAX_FONT_SCALE, type BannerMetrics } from './guidance-layout';

type Row = 'firstRow' | 'street2' | 'streetAction' | 'message2' | 'thenRow';
/**
 * Android scales text non-linearly at large font sizes, so the banner's row reserves are measured
 * from the tallest content each row can hold, rendered invisibly with the same type styles. The
 * banner rows then have fixed heights: instruction, status or pause changes never resize it.
 */
export function BannerReserveProbe({ onMeasure }: { onMeasure: (metrics: Omit<BannerMetrics, 'glyph'>) => void }) {
  const rows = useRef<Partial<Record<Row, number>>>({});
  const measure = (row: Row) => (event: { nativeEvent: { layout: { height: number } } }) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (rows.current[row] === height) return;
    const next = { ...rows.current, [row]: height };
    rows.current = next;
    if (next.firstRow && next.street2 && next.streetAction && next.message2 && next.thenRow) {
      onMeasure({ firstRow: next.firstRow, lines: Math.max(next.street2, next.streetAction, next.message2), thenRow: Math.max(22, next.thenRow) });
    }
  };
  return <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={{ position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }}>
    <View onLayout={measure('firstRow')} className="self-start"><Display maxFontSizeMultiplier={MAX_FONT_SCALE} size={42}>0</Display></View>
    <View onLayout={measure('street2')} className="self-start">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-xl font-semibold leading-7">{'Ag\nAg'}</Text>
    </View>
    <View onLayout={measure('streetAction')} className="self-start">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-xl font-semibold leading-7">Ag</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-base leading-6">Ag</Text>
    </View>
    <View onLayout={measure('message2')} className="self-start">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-lg font-semibold leading-6">{'Ag\nAg'}</Text>
    </View>
    <View onLayout={measure('thenRow')} className="self-start">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-sm font-semibold">Poi</Text>
    </View>
  </View>;
}
