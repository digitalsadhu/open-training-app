import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const isBareSpecifier = spec =>
  !spec.startsWith('http://') &&
  !spec.startsWith('https://') &&
  !spec.startsWith('/') &&
  !spec.startsWith('./') &&
  !spec.startsWith('../');

const extractImports = source => {
  const results = [];
  const importRegex = /import\s+(?:[^'"\n]+from\s+)?["']([^"']+)["']/g;
  const dynamicRegex = /import\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = importRegex.exec(source))) {
    results.push(match[1]);
  }
  while ((match = dynamicRegex.exec(source))) {
    results.push(match[1]);
  }
  return results;
};

const extractLinks = source => {
  const results = [];
  const linkRegex = /(?:href|src)=["']([^"']+)["']/g;
  let match;
  while ((match = linkRegex.exec(source))) {
    results.push(match[1]);
  }
  return results;
};

test('bundle URLs resolve and imports are not bare', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf-8'),
    readFile(new URL('../app.js', import.meta.url), 'utf-8')
  ]);

  const imports = extractImports(app);
  const bare = imports.filter(isBareSpecifier);
  assert.equal(bare.length, 0, `Bare specifiers found: ${bare.join(', ')}`);

  const links = extractLinks(html);
  const webawesomeCss = links.filter(link => link.includes('@awesome.me/webawesome'));
  assert.ok(webawesomeCss.length > 0, 'Expected Web Awesome CSS links in index.html');
  webawesomeCss.forEach(link => {
    assert.ok(
      link.startsWith('https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/'),
      `Expected pinned jsDelivr path for Web Awesome CSS: ${link}`
    );
    assert.ok(!link.includes('@latest'), `Expected pinned version, found @latest: ${link}`);
  });

  const webawesomeImports = imports.filter(link => link.includes('@awesome.me/webawesome'));
  webawesomeImports.forEach(link => {
    assert.ok(
      link.startsWith('https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/'),
      `Expected pinned jsDelivr path for Web Awesome JS: ${link}`
    );
    assert.ok(!link.includes('@latest'), `Expected pinned version, found @latest: ${link}`);
  });

  const externalLinks = links.filter(link => link.startsWith('http://') || link.startsWith('https://'));
  const externalImports = imports.filter(link => link.startsWith('http://') || link.startsWith('https://'));

  externalLinks.forEach(link => {
    assert.ok(link.startsWith('https://'), `Expected HTTPS link: ${link}`);
    assert.ok(!link.includes('@latest'), `Expected pinned version, found @latest: ${link}`);
  });
  externalImports.forEach(link => {
    assert.ok(link.startsWith('https://'), `Expected HTTPS import: ${link}`);
    assert.ok(!link.includes('@latest'), `Expected pinned version, found @latest: ${link}`);
  });
});
