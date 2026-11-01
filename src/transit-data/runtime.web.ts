import { Asset } from 'expo-asset';
import bundledAsset from '../data/gtt-timetable.gttpkg';
import { bundledManifest } from './bundled';
import { checkManifestMatchesPackage, PackageError, validateManifest, validatePackage } from './package-format';
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
  if (!response.ok) throw new PackageError(`Pacchetto orari incluso non disponibile (HTTP ${response.status}).`, 'network');
  const manifest = validateManifest(bundledManifest);
  // Verified like the native import: exact bytes and SHA-256 of the asset, then its own metadata.
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (bytes.length !== manifest.package_bytes || digest !== manifest.package_hash) throw new PackageError('Il pacchetto orari incluso non corrisponde al suo hash.', 'hash');
  const pkg = validatePackage(JSON.parse(new TextDecoder().decode(bytes)));
  checkManifestMatchesPackage(manifest, pkg);
  const meta = datasetMeta(pkg, manifest, 'bundled');
  return { meta, reader: createMemoryReader(pkg, meta) };
});

/** Web preview: GTT does not allow cross-origin reads, so no remap. */
export const remapService = createRemapService({ store: createMemoryRemapStore(), url: GTT_STATIC_ZIP });
