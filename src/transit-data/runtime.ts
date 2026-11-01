import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { bundledManifest } from './bundled';
import { checkManifestMatchesPackage, PackageError, validateManifest, validatePackage } from './package-format';
import { createMemoryReader, datasetMeta } from './reader';
import { createMemoryRemapStore, createRemapService } from './remap';
import { createStaticTimetableService } from './service';
import { GTT_STATIC_ZIP } from './config';

/**
 * Test runtime (Bun/Node): the bundled package file through the in-memory reader. Android uses
 * runtime.native.ts (expo-sqlite store with verified downloads); the web build uses runtime.web.ts.
 */
export const timetableService = createStaticTimetableService(async () => {
  // The same integrity checks as the device runtimes, so a bundle/manifest mismatch fails `bun test`.
  const bytes = fs.readFileSync(path.join(__dirname, '../data/gtt-timetable.gttpkg'));
  const manifest = validateManifest(bundledManifest);
  if (bytes.length !== manifest.package_bytes || createHash('sha256').update(bytes).digest('hex') !== manifest.package_hash) {
    throw new PackageError('Il pacchetto orari incluso non corrisponde al suo hash.', 'hash');
  }
  const pkg = validatePackage(JSON.parse(bytes.toString('utf8')));
  checkManifestMatchesPackage(manifest, pkg);
  const meta = datasetMeta(pkg, manifest, 'bundled');
  return { meta, reader: createMemoryReader(pkg, meta) };
});

/** Tests: no transport; remap flows are exercised with fixtures. */
export const remapService = createRemapService({ store: createMemoryRemapStore(), url: GTT_STATIC_ZIP });
