import type { Coordinate } from '../../domain/types';

/** The last map view, stored only on this device so the app reopens where the user left it. */
export interface StoredViewport { center: Coordinate; zoom: number }
export interface ViewportStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const VIEWPORT_KEY = 'avoid-maps.viewport.v1';
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

/**
 * Three decimals (about 100 m) are enough to restore a view and avoid keeping a precise point. The
 * zoom is capped so a restored view stays an area, not a building.
 */
export function serializeViewport(center: Coordinate, zoom: number): string | null {
  if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude) || !Number.isFinite(zoom)) return null;
  if (Math.abs(center.latitude) > 85 || Math.abs(center.longitude) > 180) return null;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return JSON.stringify({ version: 1, latitude: round(center.latitude), longitude: round(center.longitude), zoom: Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 10) / 10 });
}

/** Unreadable, out-of-range or future-version data is ignored rather than trusted. */
export function parseViewport(raw: string | null): StoredViewport | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { version?: unknown; latitude?: unknown; longitude?: unknown; zoom?: unknown };
    if (value.version !== 1) return null;
    const { latitude, longitude, zoom } = value;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof zoom !== 'number') return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(zoom)) return null;
    if (Math.abs(latitude) > 85 || Math.abs(longitude) > 180 || zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null;
    return { center: { latitude, longitude }, zoom };
  } catch {
    return null;
  }
}

export function createViewportStore(storage: ViewportStorage) {
  return {
    async load(): Promise<StoredViewport | null> {
      try { return parseViewport(await storage.getItem(VIEWPORT_KEY)); } catch { return null; }
    },
    async save(center: Coordinate, zoom: number): Promise<void> {
      const value = serializeViewport(center, zoom);
      if (value) await storage.setItem(VIEWPORT_KEY, value).catch(() => undefined);
    },
    async clear(): Promise<boolean> {
      try { await storage.removeItem(VIEWPORT_KEY); return true; } catch { return false; }
    },
  };
}

/**
 * Whether a passively settled camera (padding change, programmatic fit) may persist the viewport.
 * After "Dimentica l'ultima vista" only a new deliberate camera choice may save again, so closing a
 * sheet cannot silently recreate the forgotten view.
 */
export function mayPersistSettledView(state: { engaged: boolean; forgotten: boolean }): boolean {
  return state.engaged && !state.forgotten;
}
