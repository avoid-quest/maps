import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDiagnostic, providerLocationError } from './location-provider-status';

test('enabled GPS without a network provider is distinguished from disabled device location', () => {
  const gpsOnly = { locationEnabled: true, gpsEnabled: true, networkEnabled: false, otherEnabled: false };
  assert.equal(providerDiagnostic(gpsOnly), 'providers-gps');
  assert.equal(providerLocationError(gpsOnly, false), null, 'Enabled GPS must get an acquisition attempt');
  assert.equal(providerLocationError(gpsOnly, true)?.code, 'timeout');
  assert.match(providerLocationError(gpsOnly, true)!.message, /GPS attivo/);
  const disabled = { ...gpsOnly, locationEnabled: false };
  assert.equal(providerDiagnostic(disabled), 'services-disabled');
  assert.equal(providerLocationError(disabled, false)?.code, 'unavailable');
  assert.match(providerLocationError(disabled, false)!.message, /impostazioni Android/);
});

test('network enabled is not advertised as a working fix and missing native capability does not block acquisition', () => {
  const network = { locationEnabled: true, gpsEnabled: false, networkEnabled: true, otherEnabled: false };
  assert.equal(providerDiagnostic(network), 'providers-network');
  assert.equal(providerLocationError(network, false), null);
  assert.equal(providerLocationError(network, true)?.code, 'timeout');
  assert.equal(providerLocationError(null, false), null);
  assert.equal(providerLocationError(null, true)?.code, 'timeout');
  assert.equal(providerDiagnostic({ ...network, gpsEnabled: true }), 'providers-gps-network');
  const noProviders = { ...network, networkEnabled: false };
  assert.equal(providerDiagnostic(noProviders), 'providers-none');
  assert.equal(providerLocationError(noProviders, false)?.code, 'unavailable');
});


test('another active platform provider can supply browse fixes without GPS or network', () => {
  const fusedOnly = { locationEnabled: true, gpsEnabled: false, networkEnabled: false, otherEnabled: true };
  assert.equal(providerDiagnostic(fusedOnly), 'providers-other');
  assert.equal(providerLocationError(fusedOnly, false), null);
  assert.equal(providerLocationError(fusedOnly, true)?.code, 'timeout');
});
