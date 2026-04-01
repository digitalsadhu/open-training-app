const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TOKEN_CACHE_PREFIX = 'training-app:google-ai-token:';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const OAUTH_SCOPES =
  'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever';
const PROGRAM_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['programName', 'notes', 'workouts'],
  properties: {
    programName: { type: 'STRING' },
    notes: { type: 'STRING' },
    workouts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name', 'exercises'],
        properties: {
          name: { type: 'STRING' },
          exercises: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['name', 'defaultSets', 'trainingPriority', 'muscleGroups'],
              properties: {
                name: { type: 'STRING' },
                defaultSets: { type: 'NUMBER' },
                trainingPriority: { type: 'STRING', enum: ['strength', 'hypertrophy'] },
                muscleGroups: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                }
              }
            }
          }
        }
      }
    }
  }
};

const extractTextFromResponse = payload => {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map(part => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return text;
};

const findLikelyJsonObject = value => {
  const text = String(value || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return '';
  return text.slice(start, end + 1);
};

const tryParseJson = value => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const parseJsonBlock = value => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  let parsed = tryParseJson(candidate);
  if (parsed) return parsed;

  const objectSlice = findLikelyJsonObject(candidate);
  if (objectSlice) {
    parsed = tryParseJson(objectSlice);
    if (parsed) return parsed;

    // Common model formatting issue: trailing commas.
    const withoutTrailingCommas = objectSlice.replace(/,\s*([}\]])/g, '$1');
    parsed = tryParseJson(withoutTrailingCommas);
    if (parsed) return parsed;
  }

  throw new Error('Unable to parse model output as JSON.');
};

const createGisTokenProvider = () => {
  let tokenClient = null;
  let activeToken = null;
  let expiresAt = 0;
  let scriptLoadPromise = null;

  const getCacheKey = (clientId, scopes = '') =>
    `${TOKEN_CACHE_PREFIX}${clientId}:${encodeURIComponent(String(scopes || ''))}`;

  const readStorage = (storage, key) => {
    try {
      return storage?.getItem(key);
    } catch {
      return '';
    }
  };

  const writeStorage = (storage, key, value) => {
    try {
      storage?.setItem(key, value);
    } catch {
      // Ignore storage failures.
    }
  };

  const removeStorage = (storage, key) => {
    try {
      storage?.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  };

  const loadCachedToken = (clientId, scopes) => {
    const key = getCacheKey(clientId, scopes);
    try {
      const raw = readStorage(globalThis.sessionStorage, key) || readStorage(globalThis.localStorage, key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = String(parsed.token || '');
      const expiry = Number(parsed.expiresAt) || 0;
      if (!token || Date.now() >= expiry - 30_000) {
        removeStorage(globalThis.sessionStorage, key);
        removeStorage(globalThis.localStorage, key);
        return null;
      }
      return { token, expiresAt: expiry };
    } catch {
      return null;
    }
  };

  const storeCachedToken = (clientId, scopes, token, expiry) => {
    const key = getCacheKey(clientId, scopes);
    try {
      const payload = JSON.stringify({ token, expiresAt: expiry });
      writeStorage(globalThis.sessionStorage, key, payload);
      writeStorage(globalThis.localStorage, key, payload);
    } catch {
      // Ignore storage failures.
    }
  };

  const loadScript = () => {
    if (scriptLoadPromise) return scriptLoadPromise;
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('Google Identity Services requires a browser environment'));
    }

    scriptLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services script')), {
          once: true
        });
        if (globalThis.google?.accounts?.oauth2) resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
      document.head.appendChild(script);
    });

    return scriptLoadPromise;
  };

  return async ({ clientId, scopes, forceConsent = false, forceRefresh = false }) => {
    if (!clientId) throw new Error('Google OAuth client id is required');

    const now = Date.now();
    if (!forceRefresh && activeToken && now < expiresAt - 30_000) {
      return activeToken;
    }

    const cached = !forceRefresh ? loadCachedToken(clientId, scopes) : null;
    if (!forceRefresh && cached) {
      activeToken = cached.token;
      expiresAt = cached.expiresAt;
      return activeToken;
    }

    await loadScript();
    const oauth2 = globalThis.google?.accounts?.oauth2;
    if (!oauth2?.initTokenClient) {
      throw new Error('Google Identity Services not available');
    }

    const requestToken = prompt =>
      new Promise((resolve, reject) => {
        tokenClient = oauth2.initTokenClient({
          client_id: clientId,
          scope: scopes,
          callback: response => {
            if (response?.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }
            resolve(response);
          }
        });
        tokenClient.requestAccessToken({ prompt });
      });

    let token;
    try {
      token = forceConsent ? await requestToken('consent') : await requestToken('');
    } catch {
      token = await requestToken('consent');
    }

    activeToken = token.access_token;
    const expirySeconds = Number(token.expires_in) || 3600;
    expiresAt = Date.now() + expirySeconds * 1000;
    storeCachedToken(clientId, scopes, activeToken, expiresAt);
    return activeToken;
  };
};

const parseErrorBody = async response => {
  try {
    const payload = await response.json();
    return payload?.error?.message || JSON.stringify(payload);
  } catch {
    return await response.text();
  }
};

const normalizeModel = value => {
  const model = String(value || DEFAULT_GEMINI_MODEL).trim();
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
};

const buildRepairPrompt = originalOutput => `
Convert the following content into valid JSON.

Rules:
- Return JSON only.
- No markdown code fences.
- No comments.
- No trailing commas.
- Keep the same meaning and fields.

Content to repair:
${String(originalOutput || '')}
`.trim();

const buildFreshStrictPrompt = originalPrompt => `
Return valid JSON only for this request, matching the schema exactly.
No markdown, no commentary.

Request:
${String(originalPrompt || '')}
`.trim();

export const createGoogleGeminiAdapter = ({ fetchImpl = globalThis.fetch, tokenProvider = createGisTokenProvider() } = {}) => ({
  id: 'google-gemini-oauth',

  validateConfig(config = {}) {
    const clientId = String(config.clientId || '').trim();
    const projectId = String(config.projectId || '').trim();
    const model = normalizeModel(config.model);
    if (!clientId) throw new Error('Google OAuth client id is required.');
    if (!projectId) throw new Error('Google Cloud project id is required.');
    if (!model) throw new Error('Gemini model is required.');
    return { clientId, projectId, model };
  },

  async connect(config, { forceConsent = false } = {}) {
    const normalized = this.validateConfig(config);
    const token = await tokenProvider({
      clientId: normalized.clientId,
      scopes: OAUTH_SCOPES,
      forceConsent
    });

    const response = await fetchImpl(`${GEMINI_API_BASE}/models?pageSize=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-goog-user-project': normalized.projectId
      }
    });
    if (!response.ok) {
      const details = await parseErrorBody(response);
      throw new Error(`Google Gemini OAuth connection failed: ${details || response.status}`);
    }
    return normalized;
  },

  async generateProgramPlan(config, { prompt }) {
    const normalized = this.validateConfig(config);
    const token = await tokenProvider({
      clientId: normalized.clientId,
      scopes: OAUTH_SCOPES
    });

    const endpoint = `${GEMINI_API_BASE}/models/${encodeURIComponent(normalized.model)}:generateContent`;
    const runGenerate = async (textPrompt, temperature = 0.4, useSchema = true) => {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-goog-user-project': normalized.projectId
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: String(textPrompt || '') }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            ...(useSchema ? { responseSchema: PROGRAM_RESPONSE_SCHEMA } : {}),
            temperature,
            maxOutputTokens: 1800
          }
        })
      });

      if (!response.ok) {
        const details = await parseErrorBody(response);
        throw new Error(`Gemini request failed: ${details || response.status}`);
      }
      const payload = await response.json();
      const text = extractTextFromResponse(payload);
      if (!text) throw new Error('Gemini returned an empty response.');
      return text;
    };

    const rawText = await runGenerate(prompt, 0.35);

    let parsed = null;
    try {
      parsed = parseJsonBlock(rawText);
    } catch {
      const repairedText = await runGenerate(buildRepairPrompt(rawText), 0, false);
      try {
        parsed = parseJsonBlock(repairedText);
      } catch {
        const strictRetryText = await runGenerate(buildFreshStrictPrompt(prompt), 0, true);
        try {
          parsed = parseJsonBlock(strictRetryText);
        } catch {
          throw new Error('Gemini did not return valid JSON.');
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Gemini response JSON was not an object.');
    }

    return parsed;
  }
});
