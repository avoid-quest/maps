import { Asset } from 'expo-asset';
import bundledAsset from '../data/gtt-timetable.gttpkg';
import { bundledManifest } from './bundled';
import { validateManifest, validatePackage } from './package-format';
import { createMemoryReader, datasetMeta } from './reader';
import { createMemoryRemapStore, createRemapService } from './remap';
import { createStaticTimetableService } from './service';
import { GTT_STATIC_ZIP } from './config';

/**
 * Web preview: no SQLite store or downloads; the bundled package asset is fetched from the app's
 * own origin and served by the in-memory reader.
 */
export const timetableService = createStaticTimetableService(async () => {
  const asset = Asset.fromModule(bundledAsset);
  const response = await fetch(asset.uri);
  const pkg = validatePackage(await response.json());
  const manifest = validateManifest(bundledManifest);
  const meta = datasetMeta(pkg, manifest, 'bundled');
  return { meta, reader: createMemoryReader(pkg, meta) };
});

/** Web preview: GTT does not allow cross-origin reads, so no remap. */
export const remapService = createRemapService({ store: createMemoryRemapStore(), url: GTT_STATIC_ZIP });
