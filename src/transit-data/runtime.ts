import { bundledPackage } from './bundled';
import { validateManifest, validatePackage } from './package-format';
import { createMemoryReader, maxTripSeconds } from './reader';
import { createStaticTimetableService } from './service';

/**
 * Web and test runtime: the bundled package through the in-memory reader. Native builds use
 * runtime.native.ts (expo-sqlite store with verified downloads).
 */
export const timetableService = createStaticTimetableService(async () => {
  const pkg = validatePackage(bundledPackage.load());
  const manifest = validateManifest(bundledPackage.manifest);
  const meta = { packageHash: manifest.package_hash, feedVersion: pkg.feed.feed_version, validFrom: pkg.feed.valid_from, validTo: pkg.feed.valid_to, maxTripSeconds: maxTripSeconds(pkg), source: 'bundled' as const, manifest };
  return { meta, reader: createMemoryReader(pkg, meta) };
});
