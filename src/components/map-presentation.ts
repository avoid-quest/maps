/** Camera padding describes visible map space, never the height of a side sheet. */
export function mapCameraPadding({ width, height, sheetHeight, panelVisible, navigating, fontScale = 1 }: {
  width: number; height: number; sheetHeight: number; panelVisible: boolean; navigating: boolean; fontScale?: number;
}) {
  const top = navigating ? Math.min(height * 0.3, 104 * Math.min(fontScale, 1.5)) + 28 : 112;
  if (navigating && width >= 650 && height < 500) return { top, right: 352, bottom: 32, left: 32 };
  const bottom = navigating ? Math.min(height * 0.46, 176 * Math.min(fontScale, 1.5)) + 28
    : panelVisible && width < 850 ? sheetHeight + 24 : 96;
  return { top, right: 32, bottom: Math.max(32, Math.min(bottom, height - top - 120)), left: width >= 850 && panelVisible && !navigating ? 442 : 32 };
}

/** Consume a planning frame once. A pan also consumes a pending frame before its response arrives. */
export function createRouteFraming() {
  let consumed: string | undefined;
  return {
    userMoved(key: string | undefined) { consumed = key; },
    claim(key: string | undefined, hasGeometry: boolean) {
      if (!key) { consumed = undefined; return false; }
      if (!hasGeometry || consumed === key) return false;
      consumed = key;
      return true;
    },
  };
}
