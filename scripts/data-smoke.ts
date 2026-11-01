/** Opt-in live smoke test. Sends the documented public Docks Dora/Porta Susa coordinates. */
import { searchPlaces } from '../src/services/search';
import { planRoute } from '../src/services/routing';
import { getNearbyStops, getStopBoard, getTransitAlerts } from '../src/services/transit';
import { TURIN_CENTER } from '../src/services/geo';
async function main() {
  const search = await searchPlaces('Docks Dora', { center: TURIN_CENTER });
  console.log('Search', { count: search.places.length, sources: [...new Set(search.places.map(p => p.source))], warnings: search.warnings });
  for (const mode of ['walk', 'bicycle', 'car', 'transit'] as const) {
    try {
      const to = mode === 'transit' ? { latitude: 45.0729, longitude: 7.6664 } : { latitude: 45.090592, longitude: 7.684977 };
      const route = await planRoute({ from: TURIN_CENTER, to, mode });
      console.log('Route', { mode, distance: route.distanceMeters, duration: route.durationSeconds, points: route.geometry.length, legs: route.legs.map(l => ({ mode: l.mode, line: l.line, live: l.realTime })) });
    } catch (error) { console.log('Route error', mode, String(error)); process.exitCode = 1; }
  }
  const stops = getNearbyStops(TURIN_CENTER, { limit: 3 });
  for (const stop of stops) {
    const board = await getStopBoard(stop.id);
    console.log('Board', { stop: stop.name, code: stop.code, rows: board.rows.length, realtime: board.realtime, states: board.rows.map(row => row.gtt.realtime), notices: board.notices.map(notice => notice.code) });
  }
  console.log('Alerts', (await getTransitAlerts(stops[0]?.id)).alerts.length);
}
void main().catch(error => { console.error(String(error)); process.exitCode = 1; });
