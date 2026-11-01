import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PackageFiles } from '../package-store';

export const sha256 = async (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** node:fs staging files; `served` maps URLs to bodies, recording every requested URL. */
export function createTestFiles(directory: string, served: Map<string, string>, options: { freeBytes?: number } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const requested: string[] = [];
  const files: PackageFiles & { requested: string[]; freeBytes(): Promise<number | undefined>; setFree(bytes: number | undefined): void } = {
    requested,
    async download(url, name) {
      requested.push(url);
      const body = served.get(url);
      if (body === undefined) throw new Error('UnableToDownload: HTTP 404');
      fs.writeFileSync(path.join(directory, name), body);
    },
    async read(name) { return fs.readFileSync(path.join(directory, name), 'utf8'); },
    async remove(name) { fs.rmSync(path.join(directory, name), { force: true }); },
    async list() { return fs.readdirSync(directory); },
    async freeBytes() { return options.freeBytes; },
    setFree(bytes) { options.freeBytes = bytes; },
  };
  return files;
}
