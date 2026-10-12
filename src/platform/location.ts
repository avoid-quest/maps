import { requireOptionalNativeModule } from 'expo';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { LocationManager } from '@maplibre/maplibre-react-native';
import { diagnostics } from '../services/diagnostics';
import { createLocationLookup, LocationError, waitForLocation } from './location-request';
import { providerDiagnostic, providerLocationError, type LocationProviderStatus } from './location-provider-status';
export { LocationError, type CurrentLocation } from './location-request';

const nativeStatus = Platform.OS === 'android' ? requireOptionalNativeModule<{ getLocationProviderStatus?: () => Promise<LocationProviderStatus> }>('AvoidNavigation') : null;
async function readProviderStatus(): Promise<LocationProviderStatus | null> {
  // Older APKs do not expose this read-only diagnostic yet; their acquisition remains usable.
  try {
    const status = await nativeStatus?.getLocationProviderStatus?.();
    if (!status) return null;
    diagnostics.record({ type: 'location', state: providerDiagnostic(status) });
    return status;
  } catch { return null; }
}

const lookup = createLocationLookup(async request => {
  if (Platform.OS === 'android') {
    const coarse = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
    const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const [hasCoarse, hasFine] = await Promise.all([PermissionsAndroid.check(coarse), PermissionsAndroid.check(fine)]);
    if (hasCoarse || hasFine) {
      diagnostics.record({ type: 'location', state: hasFine ? 'precise' : 'approximate' });
      return true;
    }
    if (!request) return false;
    const results = await PermissionsAndroid.requestMultiple([coarse, fine]);
    const precise = results[fine] === PermissionsAndroid.RESULTS.GRANTED;
    const authorized = precise || results[coarse] === PermissionsAndroid.RESULTS.GRANTED;
    if (authorized) diagnostics.record({ type: 'location', state: precise ? 'precise' : 'approximate' });
    return authorized;
  }
  // The MapLibre iOS API cannot check permission without potentially prompting.
  return request && await LocationManager.requestPermissions();
}, async () => {
  diagnostics.record({ type: 'location', state: 'requested' });
  try {
    const unavailable = providerLocationError(await readProviderStatus(), false);
    if (unavailable) throw unavailable;
    const position = await waitForLocation(LocationManager, inactive => {
      const subscription = AppState.addEventListener('change', state => { if (state !== 'active') inactive(); });
      if (AppState.currentState === 'background' || AppState.currentState === 'inactive') inactive();
      return () => subscription.remove();
    });
    diagnostics.record({ type: 'location', state: 'fix' });
    return position;
  } catch (error) {
    if (error instanceof LocationError && error.code === 'timeout') error = providerLocationError(await readProviderStatus(), true) ?? error;
    diagnostics.record({ type: 'location', state: error instanceof LocationError ? error.code : 'unavailable' });
    throw error;
  }
});

export const getAuthorizedLocation = lookup.getAuthorizedLocation;
export async function getCurrentLocation() {
  try { return await lookup.getCurrentLocation(); }
  catch (error) {
    if (error instanceof LocationError && error.code === 'denied') diagnostics.record({ type: 'location', state: 'denied' });
    throw error;
  }
}
