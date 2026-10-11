import type { Departure } from "../domain/types";

export function displayedDepartureStatus(
  departure: Departure,
  feedUpdatedAt: number | undefined,
  now: number,
): Departure["status"] {
  if (departure.status !== "live") return departure.status;
  const timestamp = Math.min(
    departure.sourceUpdatedAt ?? Infinity,
    feedUpdatedAt ?? Infinity,
  );
  return !Number.isFinite(timestamp) || now - timestamp > 120_000
    ? "stale"
    : "live";
}
