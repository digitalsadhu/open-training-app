export const DEFAULT_LANGUAGE_FALLBACK_ID = 2;

const FREE_EXERCISE_DB_URLS = [
  'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json',
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
];

const normalizeNameKey = value =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const toDescription = value => {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean).join(' ');
  }
  return String(value || '').trim();
};

const toName = item =>
  String(item?.name || item?.exerciseName || item?.exercise_name || item?.title || '')
    .trim();

export const normalizeExercises = results => {
  const unique = new Map();

  results.forEach(item => {
    const name = toName(item);
    if (!name) return;

    const key = normalizeNameKey(name);
    if (!key) return;

    const description = toDescription(item.description || item.instructions);
    const source = item.source || 'unknown';

    if (!unique.has(key)) {
      unique.set(key, {
        id: String(item.id ?? `${source}:${name}`),
        name,
        description,
        source,
        sources: [source]
      });
      return;
    }

    const existing = unique.get(key);
    const mergedDescription = existing.description.length >= description.length
      ? existing.description
      : description;
    const mergedSources = Array.from(new Set([...(existing.sources || []), source]));

    unique.set(key, {
      ...existing,
      description: mergedDescription,
      sources: mergedSources
    });
  });

  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const readJson = async (url, fetchImpl) => {
  const response = await fetchImpl(url);
  if (Object.prototype.hasOwnProperty.call(response, 'ok') && !response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
};

export const getEnglishLanguageId = async (fetchImpl = fetch) => {
  const data = await readJson('https://wger.de/api/v2/language/', fetchImpl);
  const english = data.results?.find(item => item.short_name === 'en');
  return english?.id || DEFAULT_LANGUAGE_FALLBACK_ID;
};

const pickTranslationName = (item, languageId) => {
  const translations = Array.isArray(item?.translations) ? item.translations : [];
  const exact = translations.find(t => Number(t.language) === Number(languageId));
  const fallback = translations.find(t => t?.name) || translations[0];
  return String(exact?.name || fallback?.name || '').trim();
};

const fetchPaged = async (startUrl, fetchImpl, maxResults, mapper) => {
  let url = startUrl;
  const results = [];

  while (url && results.length < maxResults) {
    const data = await readJson(url, fetchImpl);
    (data.results || []).forEach(item => {
      const mapped = mapper(item);
      if (mapped) results.push(mapped);
    });
    url = data.next;
  }

  return results;
};

const fetchWgerExercises = async (languageId, fetchImpl, maxResults) => {
  const query = `language=${languageId}&status=2&limit=100`;
  const exerciseInfoUrl = `https://wger.de/api/v2/exerciseinfo/?${query}`;
  const exerciseUrl = `https://wger.de/api/v2/exercise/?${query}`;

  const mappedInfo = await fetchPaged(
    exerciseInfoUrl,
    fetchImpl,
    maxResults,
    item => {
      const name = String(item?.name || pickTranslationName(item, languageId)).trim();
      if (!name) return null;
      return {
        id: String(item.id ?? item.exercise_base ?? name),
        name,
        description: toDescription(item.description),
        source: 'wger'
      };
    }
  );

  if (mappedInfo.length > 0) return mappedInfo;

  return fetchPaged(
    exerciseUrl,
    fetchImpl,
    maxResults,
    item => {
      const name = String(item?.name || '').trim();
      if (!name) return null;
      return {
        id: String(item.id ?? name),
        name,
        description: toDescription(item.description),
        source: 'wger'
      };
    }
  );
};

const fetchFreeExerciseDb = async (fetchImpl, maxResults) => {
  let lastError;

  for (const url of FREE_EXERCISE_DB_URLS) {
    try {
      const data = await readJson(url, fetchImpl);
      const list = Array.isArray(data) ? data : data?.results || [];
      return list
        .slice(0, maxResults)
        .map(item => {
          const name = toName(item);
          if (!name) return null;
          return {
            id: String(item.id ?? item.exerciseId ?? `free:${name}`),
            name,
            description: toDescription(item.instructions || item.description),
            source: 'free-exercise-db'
          };
        })
        .filter(Boolean);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return [];
};

export const fetchExercises = async (languageId, fetchImpl = fetch, maxResults = 250) => {
  const [wger, freeDb] = await Promise.all([
    fetchWgerExercises(languageId, fetchImpl, maxResults).catch(() => []),
    fetchFreeExerciseDb(fetchImpl, maxResults).catch(() => [])
  ]);

  return normalizeExercises([...wger, ...freeDb]);
};
