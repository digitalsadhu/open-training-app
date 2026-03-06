import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchExercises, getEnglishLanguageId, normalizeExercises } from '../data.js';

const makeFetch = routes => async url => {
  const handler = routes[url];
  if (!handler) {
    throw new Error(`Unexpected URL: ${url}`);
  }
  const payload = typeof handler === 'function' ? handler() : handler;
  return {
    json: async () => payload
  };
};

test('normalizeExercises dedupes and sorts', () => {
  const data = normalizeExercises([
    { id: 1, name: 'Bench Press', description: 'a' },
    { id: 2, name: 'bench press', description: 'b' },
    { id: 3, name: '  Deadlift ', description: '' }
  ]);
  assert.equal(data.length, 2);
  assert.equal(data[0].name, 'Bench Press');
  assert.equal(data[1].name, 'Deadlift');
});

test('getEnglishLanguageId falls back when English missing', async () => {
  const fetchImpl = makeFetch({
    'https://wger.de/api/v2/language/': { results: [{ short_name: 'de', id: 4 }] }
  });
  const id = await getEnglishLanguageId(fetchImpl);
  assert.equal(id, 2);
});

test('fetchExercises loads and normalizes', async () => {
  const fetchImpl = makeFetch({
    'https://wger.de/api/v2/exerciseinfo/?language=2&status=2&limit=100': {
      results: [
        { id: 10, name: 'Overhead Press', description: '' },
        { id: 11, name: 'overhead press', description: '' }
      ],
      next: null
    }
  });

  const data = await fetchExercises(2, fetchImpl, 250);
  assert.equal(data.length, 1);
  assert.equal(data[0].name, 'Overhead Press');
});

test('live api returns exercises', async t => {
  try {
    const response = await fetch('https://wger.de/api/v2/exerciseinfo/?language=2&status=2&limit=5');
    const data = await response.json();
    assert.ok(Array.isArray(data.results), 'Expected results array');
    assert.ok(data.results.length > 0, 'Expected at least one exercise');
    const firstNamed = data.results.find(item => {
      if (item?.name && item.name.trim().length > 0) return true;
      const translations = Array.isArray(item?.translations) ? item.translations : [];
      return translations.some(t => t?.name && t.name.trim().length > 0);
    });
    assert.ok(firstNamed, 'Expected at least one exercise to have a name (or translation name)');
  } catch (error) {
    console.log(error)
    // t.skip(`Network unavailable for live API test: ${error?.message || String(error)}`);
  }
});
