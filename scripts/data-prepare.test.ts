import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('offline place package generation, validation, and transit isolation', () => {
  const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_place_package.py'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
