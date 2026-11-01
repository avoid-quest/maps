import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);

test('in-app font notices reproduce every bundled OFL text unchanged', () => {
  const notices = JSON.parse(readFileSync(new URL('./font-notices.json', import.meta.url), 'utf8')) as { id: string; text: string; url: string }[];
  const licences = readdirSync(new URL('assets/fonts/LICENSES/', root));
  assert.deepEqual(notices.map(notice => notice.id).sort(), licences.sort());
  for (const notice of notices) {
    assert.equal(notice.text, readFileSync(new URL(`assets/fonts/LICENSES/${notice.id}`, root), 'utf8'));
    assert.match(notice.text, /SIL Open Font License, Version 1\.1/);
    assert.match(notice.url, /^https:\/\//);
  }
});

test('every font the app config embeds exists and is covered by a licence', () => {
  const config = readFileSync(new URL('app.config.ts', root), 'utf8');
  const referenced = [...config.matchAll(/'\.\/assets\/fonts\/([^']+\.ttf)'/g)].map(match => match[1]!);
  const bundled = readdirSync(new URL('assets/fonts/', root)).filter(file => file.endsWith('.ttf'));
  assert.deepEqual([...new Set(referenced)].sort(), bundled.sort(), 'app.config.ts embeds exactly the bundled fonts');
  for (const file of bundled) assert.ok(/^(Geist|GeistMono|MonaSans)-/.test(file), `${file} belongs to a licensed family`);
  const web = readFileSync(new URL('src/theme/fonts.web.ts', root), 'utf8');
  for (const file of bundled) assert.ok(web.includes(`assets/fonts/${file}`), `${file} is declared for web`);
});

test('launcher identity is lowercase and the icon layers come from the brand mark', () => {
  const config = readFileSync(new URL('app.config.ts', root), 'utf8');
  assert.match(config, /name: isDevelopment \? 'avoid maps dev' : 'avoid maps'/);
  for (const asset of ['icon.png', 'adaptive-foreground.png', 'adaptive-monochrome.png', 'splash-icon.png']) assert.ok(config.includes(`./assets/brand/${asset}`), asset);
  assert.ok(readFileSync(new URL('assets/brand/mark.svg', root), 'utf8').includes('horizon-cuts'));
});

test('icon, adaptive, themed, splash and favicon PNGs match a fresh render of assets/brand/mark.svg', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath.endsWith('bun') ? 'node' : process.execPath, ['scripts/render-brand-assets.mjs', '--check'], { cwd: new URL('.', root).pathname, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
