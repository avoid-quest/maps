import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'data' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('components use semantic colour classes and the brand Text, never literal colours or dark: variants', () => {
  const literal = /\b(?:bg|text|border|ring|fill|stroke|divide|placeholder)-(?:\[#|\[rgb|(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b)/;
  const problems: string[] = [];
  for (const file of [join(root, 'App.tsx'), ...sources(join(root, 'src'))]) {
    const text = readFileSync(file, 'utf8');
    const name = relative(root, file);
    text.split('\n').forEach((line, index) => {
      if (literal.test(line)) problems.push(`${name}:${index + 1} literal colour class`);
      if (/["'`\s]dark:[a-z]/.test(line)) problems.push(`${name}:${index + 1} dark: variant`);
      if (/theme\/tokens/.test(line)) problems.push(`${name}:${index + 1} legacy tokens import`);
      if (/<StatusBar\b/.test(line) && !name.endsWith('ThemeProvider.tsx')) problems.push(`${name}:${index + 1} StatusBar outside ThemeProvider`);
      if (/import \{[^}]*\bText\b[^}]*\} from ['"]react-native['"]/.test(line) && !name.endsWith('ui/Text.tsx')) problems.push(`${name}:${index + 1} Text without the brand face (use src/ui/Text)`);
    });
  }
  assert.deepEqual(problems, []);
});
