export const DEFAULT_LANGUAGE_FALLBACK_ID = 2;

export const normalizeExercises = results => {
  const unique = new Map();
  results.forEach(item => {
    if (!item?.name) return;
    const name = item.name.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, {
        id: String(item.id ?? name),
        name,
        description: item.description || ''
      });
    }
  });

  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export const getEnglishLanguageId = async (fetchImpl = fetch) => {
  const response = await fetchImpl('https://wger.de/api/v2/language/');
  const data = await response.json();
  const english = data.results?.find(item => item.short_name === 'en');
  return english?.id || DEFAULT_LANGUAGE_FALLBACK_ID;
};

const pickTranslationName = (item, languageId) => {
  const translations = Array.isArray(item?.translations) ? item.translations : [];
  const exact = translations.find(t => Number(t.language) === Number(languageId));
  const fallback = translations.find(t => t?.name) || translations[0];
  return (exact?.name || fallback?.name || '').trim();
};

const fetchPaged = async (startUrl, fetchImpl, maxResults, mapper) => {
  let url = startUrl;
  const results = [];

  while (url && results.length < maxResults) {
    const response = await fetchImpl(url);
    const data = await response.json();
    (data.results || []).forEach(item => {
      const mapped = mapper(item);
      if (mapped) results.push(mapped);
    });
    url = data.next;
  }

  return results;
};

export const fetchExercises = async (languageId, fetchImpl = fetch, maxResults = 250) => {
  const query = `language=${languageId}&status=2&limit=100`;
  const exerciseInfoUrl = `https://wger.de/api/v2/exerciseinfo/?${query}`;
  const exerciseUrl = `https://wger.de/api/v2/exercise/?${query}`;

  const mappedInfo = await fetchPaged(
    exerciseInfoUrl,
    fetchImpl,
    maxResults,
    item => {
      const name = (item?.name || pickTranslationName(item, languageId)).trim();
      if (!name) return null;
      return {
        id: String(item.id ?? item.exercise_base ?? item.name),
        name,
        description: item.description || ''
      };
    }
  );

  const normalizedInfo = normalizeExercises(mappedInfo);
  if (normalizedInfo.length > 0) {
    return normalizedInfo;
  }

  const mappedExercises = await fetchPaged(
    exerciseUrl,
    fetchImpl,
    maxResults,
    item => {
      const name = (item?.name || '').trim();
      if (!name) return null;
      return {
        id: String(item.id ?? item.name),
        name,
        description: item.description || ''
      };
    }
  );

  return normalizeExercises(mappedExercises);
};
