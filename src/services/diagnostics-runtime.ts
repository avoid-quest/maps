import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import manifest from '../data/manifest.json';
import { createDiagnosticReport, diagnostics, observeUnexpectedErrors } from './diagnostics';

export function diagnosticReport(): string {
  return createDiagnosticReport(diagnostics.getSnapshot(), {
    version: Constants.expoConfig?.version,
    build: Constants.expoConfig?.android?.versionCode,
    revision: Constants.expoConfig?.extra?.diagnosticsRevision,
    platform: Platform.OS,
    // Android's API level is generic; do not collect model, build fingerprint or device ID.
    osVersion: typeof Platform.Version === 'number' ? Platform.Version : undefined,
    gttVersion: manifest.gtt.version,
    gttValidTo: manifest.gtt.validTo,
    placesRelease: manifest.places.release,
  });
}

let started = false;
export function startDiagnostics(): void {
  if (started) return;
  started = true;
  const hooks = (globalThis as typeof globalThis & { ErrorUtils?: Parameters<typeof observeUnexpectedErrors>[0] }).ErrorUtils;
  observeUnexpectedErrors(hooks);
  void diagnostics.initialize(AsyncStorage);
  // Keep a session boundary without writing every foreground/background transition.
  diagnostics.record({ type: 'app', state: 'launch' });
}
