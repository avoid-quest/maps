import manifest from '../data/gtt-timetable.manifest.json';
import type { PackageManifest } from './package-format';

/**
 * Manifest of the validated package shipped in the APK. The package bytes are a file asset
 * (`gtt-timetable.gttpkg`), loaded by the platform runtime only to import them, so they never
 * stay resident in the JavaScript heap.
 */
export const bundledManifest = manifest as PackageManifest;
