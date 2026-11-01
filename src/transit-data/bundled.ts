import manifest from '../data/gtt-timetable.manifest.json';
import type { PackageManifest, TimetablePackage } from './package-format';
import type { BundledPackage } from './package-store';

/** The validated package shipped in the APK, so first launch works offline. */
export const bundledManifest = manifest as PackageManifest;
export const bundledPackage: BundledPackage = {
  manifest: bundledManifest,
  // Required lazily: the large module is evaluated only for the first import (or on web).
  load: () => require('../data/gtt-timetable.json') as TimetablePackage,
};
