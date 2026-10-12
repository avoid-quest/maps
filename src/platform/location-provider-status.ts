import { LocationError } from './location-request';

/** Enabled means Android exposes the provider, not that it can currently produce a fix. */
export interface LocationProviderStatus { locationEnabled: boolean; gpsEnabled: boolean; networkEnabled: boolean; otherEnabled: boolean }
export function providerDiagnostic(status: LocationProviderStatus) {
  if (!status.locationEnabled) return 'services-disabled' as const;
  if (status.gpsEnabled && status.networkEnabled) return 'providers-gps-network' as const;
  if (status.gpsEnabled) return 'providers-gps' as const;
  if (status.networkEnabled) return 'providers-network' as const;
  if (status.otherEnabled) return 'providers-other' as const;
  return 'providers-none' as const;
}
export function providerLocationError(status: LocationProviderStatus | null, timeout: boolean): LocationError | null {
  if (status && !status.locationEnabled) return new LocationError('unavailable', 'Posizione disattivata nelle impostazioni Android. Attivala e riprova.');
  if (status && !status.gpsEnabled && !status.networkEnabled && !status.otherEnabled) return new LocationError('unavailable', 'Nessun servizio di posizione attivo. Controlla le impostazioni di posizione Android.');
  if (!timeout) return null;
  if (status?.gpsEnabled && !status.networkEnabled && !status.otherEnabled) return new LocationError('timeout', 'GPS attivo, ma non è arrivata una posizione recente. Al chiuso il segnale può mancare: riprova all’aperto o scegli un punto sulla mappa.');
  return new LocationError('timeout', 'Non è arrivata una posizione recente. Al chiuso il segnale può mancare: riprova all’aperto o scegli un punto sulla mappa.');
}
