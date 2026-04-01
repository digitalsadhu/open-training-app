import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAB_ITEMS, pathFromTab, tabFromPath, titleFromTab } from '../routes.js';

test('tab configuration exposes the expected canonical routes', () => {
  const paths = TAB_ITEMS.map(item => item.path);
  assert.deepEqual(paths, ['/programs', '/train', '/progress', '/settings']);
});

test('tabFromPath maps known routes and redirects unknown routes', () => {
  assert.deepEqual(tabFromPath('/programs'), {
    tab: 'programs',
    normalizedPath: '/programs',
    requiresRedirect: false
  });
  assert.deepEqual(tabFromPath('/train'), {
    tab: 'train',
    normalizedPath: '/train',
    requiresRedirect: false
  });
  assert.deepEqual(tabFromPath('/'), {
    tab: 'programs',
    normalizedPath: '/programs',
    requiresRedirect: true
  });
  assert.deepEqual(tabFromPath('/index.html'), {
    tab: 'programs',
    normalizedPath: '/programs',
    requiresRedirect: true
  });
  assert.deepEqual(tabFromPath('/unknown'), {
    tab: 'programs',
    normalizedPath: '/programs',
    requiresRedirect: true
  });
});

test('pathFromTab and titleFromTab fall back safely', () => {
  assert.equal(pathFromTab('settings'), '/settings');
  assert.equal(pathFromTab('nope'), '/programs');
  assert.equal(titleFromTab('progress'), 'Open Training App · Progress');
  assert.equal(titleFromTab('nope'), 'Open Training App · Programs');
});
