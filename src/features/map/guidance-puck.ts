import type { SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ColorScheme } from '../../theme/palette';
import type { PuckKind } from '../navigation/guidance-camera';

/**
 * Original puck artwork rendered by scripts/render-navigation-assets.mjs: a wedge with a live green
 * centre, a disc when the direction is unknown, and a subdued hollow ring for a retained position.
 */
export const GUIDANCE_IMAGES: Record<string, number> = {
  'puck-wedge-light': require('../../../assets/navigation/puck-wedge-light.png'),
  'puck-wedge-dark': require('../../../assets/navigation/puck-wedge-dark.png'),
  'puck-dot-light': require('../../../assets/navigation/puck-dot-light.png'),
  'puck-dot-dark': require('../../../assets/navigation/puck-dot-dark.png'),
  'puck-retained-light': require('../../../assets/navigation/puck-retained-light.png'),
  'puck-retained-dark': require('../../../assets/navigation/puck-retained-dark.png'),
};

export const puckImage = (kind: PuckKind, scheme: ColorScheme) => `puck-${kind}-${scheme}`;

/** Map-aligned heading; the icon faces the viewer so it stays legible under pitch. */
export function puckLayout(image: string, heading: number): NonNullable<SymbolLayerSpecification['layout']> {
  return {
    'icon-image': image, 'icon-rotate': heading, 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'viewport',
    'icon-allow-overlap': true, 'icon-ignore-placement': true,
  };
}
