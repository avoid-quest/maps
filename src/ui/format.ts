/** Italian distance label; empty when unknown. */
export const formatDistance = (meters?: number) =>
  meters == null
    ? ""
    : meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
/** Rounds once to whole minutes, so 59.5 minutes reads as 1 h 0 min rather than 60 min. */
export const formatDuration = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};
