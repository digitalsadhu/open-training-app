import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('service worker caches and recognizes top-level app routes', async () => {
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf-8');
  assert.match(sw, /training-app-v6/);
  assert.match(sw, /'\/programs'/);
  assert.match(sw, /'\/train'/);
  assert.match(sw, /'\/progress'/);
  assert.match(sw, /'\/settings'/);
  assert.match(sw, /if \(isNavigate && !response\.ok\)/);
});
