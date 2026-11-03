/// <reference types="node" />
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The app hides scroll indicators on every scroll view, on all platforms.
// This scans the source so a new list cannot bring a scroll bar back.
const SRC = dirname(fileURLToPath(import.meta.url));
const SCROLLERS = /<((?:Animated\.)?(?:ScrollView|FlatList|SectionList|FlashList|VirtualizedList))(?=\s)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

// Returns the props text of the JSX opening tag that starts at `start`.
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === '>' && depth === 0) return source.slice(start, index);
  }
  throw new Error('Unclosed JSX tag');
}

test('every scroll view hides its scroll indicator', () => {
  const missing: string[] = [];
  let found = 0;
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SCROLLERS)) {
      found += 1;
      const tag = openingTag(source, match.index);
      const horizontal = /\shorizontal(?:\s|=\{true\}|$)/.test(tag);
      const prop = horizontal ? 'showsHorizontalScrollIndicator' : 'showsVerticalScrollIndicator';
      if (!tag.includes(`${prop}={false}`)) {
        const line = source.slice(0, match.index).split('\n').length;
        missing.push(`${relative(SRC, file)}:${line} <${match[1]}> needs ${prop}={false}`);
      }
    }
  }
  assert.ok(found > 0, 'The scan found no scroll views');
  assert.deepEqual(missing, []);
});
