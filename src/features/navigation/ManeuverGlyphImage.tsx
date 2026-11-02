import { Image, View } from 'react-native';
import { Text } from '../../ui/Text';
import type { GlyphName, ManeuverGlyph } from './maneuver-presentation';

/** Single-ink maneuver artwork (scripts/render-navigation-assets.mjs), tinted to the text colour. */
const GLYPHS: Record<GlyphName, number> = {
  straight: require('../../../assets/navigation/maneuver-straight.png'),
  'slight-left': require('../../../assets/navigation/maneuver-slight-left.png'),
  left: require('../../../assets/navigation/maneuver-left.png'),
  'sharp-left': require('../../../assets/navigation/maneuver-sharp-left.png'),
  'uturn-left': require('../../../assets/navigation/maneuver-uturn-left.png'),
  'fork-left': require('../../../assets/navigation/maneuver-fork-left.png'),
  'merge-left': require('../../../assets/navigation/maneuver-merge-left.png'),
  'ramp-left': require('../../../assets/navigation/maneuver-ramp-left.png'),
  'roundabout-right': require('../../../assets/navigation/maneuver-roundabout-right.png'),
  'roundabout-slight-right': require('../../../assets/navigation/maneuver-roundabout-slight-right.png'),
  'roundabout-straight': require('../../../assets/navigation/maneuver-roundabout-straight.png'),
  'roundabout-slight-left': require('../../../assets/navigation/maneuver-roundabout-slight-left.png'),
  'roundabout-left': require('../../../assets/navigation/maneuver-roundabout-left.png'),
  'roundabout-sharp-left': require('../../../assets/navigation/maneuver-roundabout-sharp-left.png'),
  'roundabout-uturn': require('../../../assets/navigation/maneuver-roundabout-uturn.png'),
  arrive: require('../../../assets/navigation/maneuver-arrive.png'),
  'arrive-left': require('../../../assets/navigation/maneuver-arrive-left.png'),
  unknown: require('../../../assets/navigation/maneuver-unknown.png'),
};

/** Decorative: the banner's accessibility label already says what the glyph shows. */
export function ManeuverGlyphImage({ glyph, size, color }: { glyph: ManeuverGlyph; size: number; color: string }) {
  return <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: size, height: size }}>
    <Image accessibilityIgnoresInvertColors source={GLYPHS[glyph.name]}
      style={{ width: size, height: size, tintColor: color, transform: glyph.mirror ? [{ scaleX: -1 }] : [] }} />
    {glyph.exit !== undefined ? (
      <Text numberOfLines={1} style={{ position: 'absolute', right: -Math.round(size * 0.12), bottom: -Math.round(size * 0.06), color }}
        className="font-display text-base font-extrabold">{glyph.exit}</Text>
    ) : null}
  </View>;
}
