export const DEFAULT_LANGUAGE_FALLBACK_ID = 2;
export const UNCATEGORIZED_GROUP = 'Uncategorized';
export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Arms',
  'Legs',
  'Glutes',
  'Core',
  'Cardio',
  'Full Body',
  UNCATEGORIZED_GROUP
];

const FREE_EXERCISE_DB_URLS = [
  'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json',
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
];

const normalizeNameKey = value =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeToken = value => normalizeNameKey(String(value || ''));

const GROUP_BY_TOKEN = {
  chest: 'Chest',
  pectoralis: 'Chest',
  pec: 'Chest',
  pecs: 'Chest',
  back: 'Back',
  lats: 'Back',
  latissimus: 'Back',
  trapezius: 'Back',
  traps: 'Back',
  rhomboids: 'Back',
  shoulders: 'Shoulders',
  deltoid: 'Shoulders',
  deltoids: 'Shoulders',
  rear_delt: 'Shoulders',
  side_delt: 'Shoulders',
  biceps: 'Arms',
  triceps: 'Arms',
  forearms: 'Arms',
  brachialis: 'Arms',
  arms: 'Arms',
  quads: 'Legs',
  quadriceps: 'Legs',
  hamstrings: 'Legs',
  calves: 'Legs',
  adductors: 'Legs',
  abductors: 'Legs',
  tibialis: 'Legs',
  legs: 'Legs',
  glute: 'Glutes',
  glutes: 'Glutes',
  gluteus: 'Glutes',
  abs: 'Core',
  abdominals: 'Core',
  abdominis: 'Core',
  core: 'Core',
  obliques: 'Core',
  serratus: 'Core',
  lower_back: 'Core',
  erector_spinae: 'Core',
  cardio: 'Cardio',
  conditioning: 'Cardio',
  hiit: 'Cardio',
  full_body: 'Full Body',
  fullbody: 'Full Body',
  olympic: 'Full Body',
  powerlifting: 'Full Body',
  strongman: 'Full Body'
};

const WGER_CATEGORY_GROUPS = {
  abs: 'Core',
  arms: 'Arms',
  back: 'Back',
  cardio: 'Cardio',
  chest: 'Chest',
  legs: 'Legs',
  shoulders: 'Shoulders',
  full_body: 'Full Body'
};

const listToStrings = value =>
  (Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean);

const normalizeAndExpandTokens = value => {
  const token = normalizeToken(value);
  if (!token) return [];
  return token
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)
    .concat([token]);
};

const mapTokenToGroup = token => {
  if (!token) return '';
  const direct = GROUP_BY_TOKEN[token];
  if (direct) return direct;

  if (token.includes('chest') || token.includes('pectoral')) return 'Chest';
  if (token.includes('back') || token.includes('lat') || token.includes('trap') || token.includes('rhomboid')) return 'Back';
  if (token.includes('shoulder') || token.includes('delt')) return 'Shoulders';
  if (token.includes('bicep') || token.includes('tricep') || token.includes('forearm') || token.includes('arm')) return 'Arms';
  if (token.includes('quad') || token.includes('hamstring') || token.includes('calf') || token.includes('leg')) return 'Legs';
  if (token.includes('glute')) return 'Glutes';
  if (token.includes('ab') || token.includes('core') || token.includes('oblique') || token.includes('serratus')) return 'Core';
  if (token.includes('cardio') || token.includes('aerobic')) return 'Cardio';
  if (token.includes('full body') || token.includes('fullbody') || token.includes('compound')) return 'Full Body';
  return '';
};

const uniq = values => Array.from(new Set((values || []).filter(Boolean)));

const groupOrder = group => {
  const index = MUSCLE_GROUPS.indexOf(group);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};

const sortGroups = groups => uniq(groups).sort((a, b) => groupOrder(a) - groupOrder(b) || a.localeCompare(b));

const mapMuscleGroups = (rawPrimary, rawSecondary, rawCategory) => {
  const groups = new Set();
  const allTokens = [
    ...rawPrimary.flatMap(normalizeAndExpandTokens),
    ...rawSecondary.flatMap(normalizeAndExpandTokens),
    ...normalizeAndExpandTokens(rawCategory)
  ];

  allTokens.forEach(token => {
    const group = mapTokenToGroup(token);
    if (group) groups.add(group);
  });

  const normalizedCategory = normalizeToken(rawCategory).replace(/\s+/g, '_');
  const categoryGroup = WGER_CATEGORY_GROUPS[normalizedCategory];
  if (categoryGroup) groups.add(categoryGroup);

  const sorted = sortGroups(Array.from(groups));
  return sorted.length > 0 ? sorted : [UNCATEGORIZED_GROUP];
};

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
    const sourceMuscles = {
      primary: uniq(listToStrings(item.sourceMuscles?.primary || item.primaryMuscles)),
      secondary: uniq(listToStrings(item.sourceMuscles?.secondary || item.secondaryMuscles))
    };
    const muscleGroups = sortGroups(
      mapMuscleGroups(sourceMuscles.primary, sourceMuscles.secondary, item.movementCategory || item.category)
    );

    if (!unique.has(key)) {
      unique.set(key, {
        id: String(item.id ?? `${source}:${name}`),
        name,
        description,
        source,
        sources: [source],
        muscleGroups,
        sourceMuscles
      });
      return;
    }

    const existing = unique.get(key);
    const mergedDescription = existing.description.length >= description.length
      ? existing.description
      : description;
    const mergedSources = Array.from(new Set([...(existing.sources || []), source]));
    const mergedMuscleGroups = sortGroups([...(existing.muscleGroups || []), ...muscleGroups]);
    const mergedSourceMuscles = {
      primary: uniq([...(existing.sourceMuscles?.primary || []), ...sourceMuscles.primary]),
      secondary: uniq([...(existing.sourceMuscles?.secondary || []), ...sourceMuscles.secondary])
    };

    unique.set(key, {
      ...existing,
      description: mergedDescription,
      sources: mergedSources,
      muscleGroups: mergedMuscleGroups.length > 0 ? mergedMuscleGroups : [UNCATEGORIZED_GROUP],
      sourceMuscles: mergedSourceMuscles
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
        source: 'wger',
        primaryMuscles: listToStrings((item.muscles || []).map(muscle => muscle.name_en || muscle.name)),
        secondaryMuscles: listToStrings((item.muscles_secondary || []).map(muscle => muscle.name_en || muscle.name)),
        category: String(item.category?.name || '')
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
        source: 'wger',
        primaryMuscles: listToStrings((item.muscles || []).map(muscle => muscle.name_en || muscle.name)),
        secondaryMuscles: listToStrings((item.muscles_secondary || []).map(muscle => muscle.name_en || muscle.name)),
        category: String(item.category?.name || '')
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
            source: 'free-exercise-db',
            primaryMuscles: listToStrings(item.primaryMuscles),
            secondaryMuscles: listToStrings(item.secondaryMuscles),
            category: String(item.category || '')
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
