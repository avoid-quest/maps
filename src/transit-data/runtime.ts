import fs from 'node:fs';
import path from 'node:path';
import { bundledManifest } from './bundled';
import { validateManifest, validatePackage } from './package-format';
import { createMemoryReader, datasetMeta } from './reader';
import { createMemoryRemapStore, createRemapService } from './remap';
import { createStaticTimetableService } from './service';
import { GTT_STATIC_ZIP } from './config';

/**
 * Test runtime (Bun/Node): the bundled package file through the in-memory reader. Android uses
 * runtime.native.ts (expo-sqlite store with verified downloads); the web build uses runtime.web.ts.
 */
export const timetableService = createStaticTimetableService(async () => {
  const pkg = validatePackage(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/gtt-timetable.gttpkg'), 'utf8')));
  const manifest = validateManifest(bundledManifest);
  const meta = datasetMeta(pkg, manifest, 'bundled');
  return { meta, reader: createMemoryReader(pkg, meta) };
});

/** Tests: no transport; remap flows are exercised with fixtures. */
export const remapService = createRemapService({ store: createMemoryRemapStore(), url: GTT_STATIC_ZIP });
