/** Italian distance label; empty when unknown. */
export const formatDistance = (meters?: number) =>
  meters == null
    ? ""
    : meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
export const formatDuration = (seconds: number) =>
  seconds < 3600
    ? `${Math.max(1, Math.round(seconds / 60))} min`
    : `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
