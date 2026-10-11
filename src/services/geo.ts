import type { Coordinate } from '../domain/types';
export const TURIN_CENTER: Coordinate = { latitude: 45.0937, longitude: 7.6828 };
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180; const p1 = a.latitude * rad; const p2 = b.latitude * rad;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function validCoordinate(value: Coordinate): boolean {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}
export function normalize(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function decodePolyline(encoded: string): Coordinate[] {
  const result: Coordinate[] = []; let index = 0; let latitude = 0; let longitude = 0;
  const component = () => {
    let value = 0; let shift = 0; let byte: number;
    do { if (index >= encoded.length || shift > 30) throw new Error('Invalid route geometry'); byte = encoded.charCodeAt(index++) - 63; value |= (byte & 31) << shift; shift += 5; } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  while (index < encoded.length) { latitude += component(); longitude += component(); result.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 }); }
  return result;
}
