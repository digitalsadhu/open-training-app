import { SyncConflictError } from './errors.js';
import { SYNC_SCHEMA_VERSION } from './model.js';

const GOOGLE_SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const GOOGLE_DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

const defaultSheetName = '__training_sync';
const defaultDocId = 'default';
const TOKEN_CACHE_PREFIX = 'training-app:google-token:';

const EXPORT_SHEETS = {
  programs: ['id', 'name', 'notes', 'created_at', 'order', 'updated_at', 'deleted_at', 'source_device_id'],
  workouts: ['id', 'program_id', 'name', 'order', 'updated_at', 'deleted_at', 'source_device_id'],
  workout_exercises: [
    'id',
    'workout_id',
    'exercise_id',
    'name',
    'default_sets',
    'default_reps',
    'default_weight',
    'muscle_groups',
    'order',
    'updated_at',
    'deleted_at',
    'source_device_id'
  ],
  sessions: [
    'id',
    'program_id',
    'workout_id',
    'workout_name',
    'date',
    'saved_at',
    'notes',
    'entry_count',
    'updated_at',
    'deleted_at',
    'source_device_id'
  ],
  session_entries: [
    'session_id',
    'exercise_id',
    'name',
    'skipped',
    'set_count',
    'updated_at',
    'deleted_at',
    'source_device_id'
  ],
  session_sets: [
    'session_id',
    'exercise_id',
    'set_index',
    'reps',
    'weight',
    'logged',
    'target_reps',
    'target_weight'
  ]
};

const quoteSheetName = sheetName => `'${String(sheetName || '').replace(/'/g, "''")}'`;
const columnRange = (sheetName, start = 'A', end = 'Z') => `${quoteSheetName(sheetName)}!${start}:${end}`;
const encodeRange = range => encodeURIComponent(range);
const defaultTimestamp = () => new Date().toISOString();

const normalizeRecordValue = value => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const sortByUpdatedAndOrder = values =>
  values
    .slice()
    .sort((a, b) => {
      const byOrder = Number(a.order || 0) - Number(b.order || 0);
      if (byOrder !== 0) return byOrder;
      return Number(a.updatedAt || 0) - Number(b.updatedAt || 0);
    });
const serializeArrayField = value => JSON.stringify(Array.isArray(value) ? value : []);

const toTabularRows = syncDoc => {
  const records = syncDoc?.records || {};
  const programs = sortByUpdatedAndOrder(Object.values(records.program || {}));
  const workouts = sortByUpdatedAndOrder(Object.values(records.workout || {}));
  const workoutExercises = sortByUpdatedAndOrder(Object.values(records.workoutExercise || {}));
  const sessions = sortByUpdatedAndOrder(Object.values(records.session || {}));

  const sessionEntries = [];
  const sessionSets = [];

  sessions.forEach(session => {
    const entries = Array.isArray(session.entries) ? session.entries : [];
    entries.forEach(entry => {
      const sets = Array.isArray(entry.sets) ? entry.sets : [];
      sessionEntries.push({
        sessionId: session.id,
        exerciseId: entry.exerciseId,
        name: entry.name,
        skipped: entry.skipped ? 'true' : 'false',
        setCount: sets.length,
        updatedAt: entry.updatedAt || session.updatedAt || 0,
        deletedAt: entry.deletedAt || '',
        sourceDeviceId: entry.sourceDeviceId || session.sourceDeviceId || ''
      });

      sets.forEach((set, index) => {
        sessionSets.push({
          sessionId: session.id,
          exerciseId: entry.exerciseId,
          setIndex: index,
          reps: set.reps ?? '',
          weight: set.weight ?? '',
          logged: set.logged ? 'true' : 'false',
          targetReps: set.targetReps ?? '',
          targetWeight: set.targetWeight ?? ''
        });
      });
    });
  });

  return {
    programs: programs.map(item => [
      item.id,
      item.name,
      item.notes || '',
      item.createdAt || 0,
      item.order || 0,
      item.updatedAt || 0,
      item.deletedAt || '',
      item.sourceDeviceId || ''
    ]),
    workouts: workouts.map(item => [
      item.id,
      item.programId,
      item.name,
      item.order || 0,
      item.updatedAt || 0,
      item.deletedAt || '',
      item.sourceDeviceId || ''
    ]),
    workout_exercises: workoutExercises.map(item => [
      item.id,
      item.workoutId,
      item.exerciseId,
      item.name,
      item.defaultSets ?? '',
      item.defaultReps ?? '',
      item.defaultWeight ?? '',
      serializeArrayField(item.muscleGroups),
      item.order || 0,
      item.updatedAt || 0,
      item.deletedAt || '',
      item.sourceDeviceId || ''
    ]),
    sessions: sessions.map(item => [
      item.id,
      item.programId,
      item.workoutId,
      item.workoutName || '',
      item.date || '',
      item.savedAt || 0,
      item.notes || '',
      Array.isArray(item.entries) ? item.entries.length : 0,
      item.updatedAt || 0,
      item.deletedAt || '',
      item.sourceDeviceId || ''
    ]),
    session_entries: sessionEntries.map(item => [
      item.sessionId,
      item.exerciseId,
      item.name || '',
      item.skipped,
      item.setCount,
      item.updatedAt || 0,
      item.deletedAt || '',
      item.sourceDeviceId || ''
    ]),
    session_sets: sessionSets.map(item => [
      item.sessionId,
      item.exerciseId,
      item.setIndex,
      item.reps,
      item.weight,
      item.logged,
      item.targetReps,
      item.targetWeight
    ])
  };
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
      const raw =
        readStorage(globalThis.sessionStorage, key) ||
        readStorage(globalThis.localStorage, key);
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
      const payload = JSON.stringify({
        token,
        expiresAt: expiry
      });
      writeStorage(globalThis.sessionStorage, key, payload);
      writeStorage(globalThis.localStorage, key, payload);
    } catch {
      // Ignore storage failures (private mode/quota), in-memory token still works.
    }
  };

  const loadScript = () => {
    if (scriptLoadPromise) return scriptLoadPromise;
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('Google Identity Services requires a browser environment'));
    }

    scriptLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src=\"${GIS_SCRIPT_URL}\"]`);
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
    if (!clientId) throw new Error('Google clientId is required');

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
      if (forceConsent) {
        token = await requestToken('consent');
      } else {
        // Try silent token refresh first to avoid forcing OAuth UX on each page load.
        token = await requestToken('');
      }
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

const parseSyncRows = rows => {
  const records = [];
  (rows || []).forEach((row, index) => {
    if (index === 0 && row[0] === 'doc_id') return;
    const docId = String(row[0] || '').trim();
    if (!docId) return;
    const revision = Number(row[1]) || 0;
    const updatedAt = Date.parse(row[2] || '') || 0;
    const payload = String(row[3] || '');
    records.push({
      rowNumber: index + 1,
      docId,
      revision,
      updatedAt,
      payload
    });
  });
  return records;
};

const parsePayload = payload => {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return {
      version: Number(parsed.version) || SYNC_SCHEMA_VERSION,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
      sourceDeviceId: String(parsed.sourceDeviceId || ''),
      records: parsed.records || {}
    };
  } catch {
    return null;
  }
};

const normalizeConfig = config => ({
  clientId: String(config.clientId || ''),
  spreadsheetId: String(config.spreadsheetId || ''),
  sheetName: String(config.sheetName || defaultSheetName),
  docId: String(config.docId || defaultDocId),
  spreadsheetTitle: String(config.spreadsheetTitle || 'Open Training App Data')
});

const parseErrorBody = async response => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const ensureSheetExists = async ({ fetchImpl, spreadsheetId, sheetName, token }) => {
  const metadataUrl = `${GOOGLE_SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const response = await fetchImpl(metadataUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw new Error(`Sheets metadata failed (${response.status}): ${body}`);
  }

  const json = await response.json();
  const titles = new Set((json.sheets || []).map(item => item?.properties?.title).filter(Boolean));
  if (titles.has(sheetName)) return;

  const createUrl = `${GOOGLE_SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const createResponse = await fetchImpl(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }
      ]
    })
  });

  if (!createResponse.ok) {
    const body = await parseErrorBody(createResponse);
    if (!body.includes('already exists')) {
      throw new Error(`Sheets create tab failed (${createResponse.status}): ${body}`);
    }
  }
};

const readValues = async ({ fetchImpl, spreadsheetId, range, token, errorPrefix = 'Sheets pull failed' }) => {
  const url = `${GOOGLE_SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeRange(range)}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw new Error(`${errorPrefix} (${response.status}): ${body}`);
  }

  return response.json();
};

const putValues = async ({
  fetchImpl,
  spreadsheetId,
  range,
  values,
  token,
  errorPrefix = 'Sheets write failed'
}) => {
  const url = `${GOOGLE_SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeRange(range)}?valueInputOption=RAW`;
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: values.map(row => row.map(normalizeRecordValue))
    })
  });

  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw new Error(`${errorPrefix} (${response.status}): ${body}`);
  }
};

const appendValues = async ({ fetchImpl, spreadsheetId, range, values, token, errorPrefix = 'Sheets append failed' }) => {
  const url = `${GOOGLE_SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeRange(range)}:append?valueInputOption=RAW`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: values.map(row => row.map(normalizeRecordValue))
    })
  });

  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw new Error(`${errorPrefix} (${response.status}): ${body}`);
  }
};

const ensureHeader = async ({ fetchImpl, spreadsheetId, sheetName, token }) => {
  await ensureSheetExists({ fetchImpl, spreadsheetId, sheetName, token });
  const range = columnRange(sheetName, 'A', 'D');
  const data = await readValues({ fetchImpl, spreadsheetId, range, token });
  const rows = data.values || [];
  if (rows.length > 0) return rows;

  await putValues({
    fetchImpl,
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1:D1`,
    values: [['doc_id', 'revision', 'updated_at', 'payload_json']],
    token,
    errorPrefix: 'Sheets header initialization failed'
  });

  return [['doc_id', 'revision', 'updated_at', 'payload_json']];
};

const readSyncRowsWithoutInit = async ({ fetchImpl, spreadsheetId, sheetName, token }) => {
  const range = columnRange(sheetName, 'A', 'D');
  const data = await readValues({
    fetchImpl,
    spreadsheetId,
    range,
    token,
    errorPrefix: 'Sheets backup read failed'
  });
  return data.values || [];
};

const writeTabularExport = async ({ fetchImpl, spreadsheetId, syncDoc, token }) => {
  const rowsBySheet = toTabularRows(syncDoc);
  const sheetNames = Object.keys(EXPORT_SHEETS);

  for (const sheetName of sheetNames) {
    await ensureSheetExists({ fetchImpl, spreadsheetId, sheetName, token });
    const header = EXPORT_SHEETS[sheetName];
    const rows = rowsBySheet[sheetName] || [];
    const allRows = [header, ...rows];
    await putValues({
      fetchImpl,
      spreadsheetId,
      range: `${quoteSheetName(sheetName)}!A1`,
      values: allRows,
      token,
      errorPrefix: `Sheets export write failed for ${sheetName}`
    });
  }
};

export const createGoogleSheetsAdapter = ({
  fetchImpl = globalThis.fetch,
  tokenProvider = createGisTokenProvider()
} = {}) => {
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.metadata.readonly'
  ].join(' ');

  return {
    id: 'google-sheets',

    validateConfig(config) {
      const normalized = normalizeConfig(config || {});
      if (!normalized.clientId) throw new Error('clientId is required');
      if (!normalized.spreadsheetId) throw new Error('spreadsheetId is required');
      return normalized;
    },

    async createTargetConfig(targetConfig) {
      const normalized = normalizeConfig(targetConfig || {});
      if (!normalized.clientId) throw new Error('clientId is required');
      const token = await tokenProvider({ clientId: normalized.clientId, scopes });

      const response = await fetchImpl(`${GOOGLE_SHEETS_BASE}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: {
            title: normalized.spreadsheetTitle
          }
        })
      });

      if (!response.ok) {
        const body = await parseErrorBody(response);
        throw new Error(`Sheets create failed (${response.status}): ${body}`);
      }

      const json = await response.json();
      const spreadsheetId = String(json.spreadsheetId || '');
      if (!spreadsheetId) {
        throw new Error('Sheets create failed: missing spreadsheetId');
      }

      return {
        ...normalized,
        spreadsheetId
      };
    },

    async listSpreadsheets(targetConfig, pageSize = 25) {
      const normalized = normalizeConfig(targetConfig || {});
      if (!normalized.clientId) throw new Error('clientId is required');
      let token = await tokenProvider({ clientId: normalized.clientId, scopes });
      const query = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
      const fields = encodeURIComponent('files(id,name,modifiedTime),nextPageToken');
      const url = `${GOOGLE_DRIVE_BASE}/files?q=${query}&pageSize=${Number(pageSize) || 25}&orderBy=modifiedTime desc&fields=${fields}`;

      let response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.status === 403) {
        const retryToken = await tokenProvider({
          clientId: normalized.clientId,
          scopes,
          forceConsent: true,
          forceRefresh: true
        });
        token = retryToken;
        response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
      }

      if (!response.ok) {
        const body = await parseErrorBody(response);
        throw new Error(`Drive list failed (${response.status}): ${body}`);
      }

      const json = await response.json();
      return (json.files || []).map(item => ({
        id: String(item.id || ''),
        name: String(item.name || 'Untitled spreadsheet'),
        modifiedTime: String(item.modifiedTime || '')
      }));
    },

    async assertBackupExists(targetConfig) {
      const config = this.validateConfig(targetConfig || {});
      const token = await tokenProvider({ clientId: config.clientId, scopes });
      let rows;
      try {
        rows = await readSyncRowsWithoutInit({
          fetchImpl,
          spreadsheetId: config.spreadsheetId,
          sheetName: config.sheetName,
          token
        });
      } catch (error) {
        throw new Error('Selected sheet is not a valid Open Training App backup.');
      }

      const latest = parseSyncRows(rows)
        .filter(item => item.docId === config.docId)
        .sort((a, b) => b.revision - a.revision || b.updatedAt - a.updatedAt)[0];

      const parsed = parsePayload(latest?.payload || '');
      const hasRecords =
        parsed &&
        parsed.records &&
        typeof parsed.records === 'object' &&
        ['program', 'workout', 'workoutExercise', 'session'].every(key =>
          Object.prototype.hasOwnProperty.call(parsed.records, key)
        );

      if (!latest || !hasRecords) {
        throw new Error('Selected sheet is not a valid Open Training App backup.');
      }

      return {
        revision: latest.revision
      };
    },

    async connect(targetConfig) {
      const config = this.validateConfig(targetConfig);
      await tokenProvider({ clientId: config.clientId, scopes });
      return config;
    },

    async disconnect() {
      return true;
    },

    async pull(target) {
      const config = this.validateConfig(target.config || {});
      const token = await tokenProvider({ clientId: config.clientId, scopes });
      const rows = await ensureHeader({
        fetchImpl,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        token
      });

      const matches = parseSyncRows(rows)
        .filter(item => item.docId === config.docId)
        .sort((a, b) => b.revision - a.revision || b.updatedAt - a.updatedAt);

      const latest = matches[0] || null;
      return {
        revision: latest?.revision || 0,
        doc: parsePayload(latest?.payload)
      };
    },

    async push(target, syncDoc, expectedRevision = 0) {
      const config = this.validateConfig(target.config || {});
      const token = await tokenProvider({ clientId: config.clientId, scopes });
      const rows = await ensureHeader({
        fetchImpl,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        token
      });

      const matches = parseSyncRows(rows)
        .filter(item => item.docId === config.docId)
        .sort((a, b) => b.revision - a.revision || b.updatedAt - a.updatedAt);
      const latest = matches[0] || null;

      const currentRevision = latest?.revision || 0;
      if (currentRevision !== Number(expectedRevision || 0)) {
        throw new SyncConflictError();
      }

      const nextRevision = currentRevision + 1;
      const updatedAt = defaultTimestamp();
      const payload = JSON.stringify(syncDoc);
      const values = [[config.docId, String(nextRevision), updatedAt, payload]];

      if (latest) {
        await putValues({
          fetchImpl,
          spreadsheetId: config.spreadsheetId,
          range: `${quoteSheetName(config.sheetName)}!A${latest.rowNumber}:D${latest.rowNumber}`,
          values,
          token,
          errorPrefix: 'Sheets push failed'
        });
      } else {
        await appendValues({
          fetchImpl,
          spreadsheetId: config.spreadsheetId,
          range: columnRange(config.sheetName, 'A', 'D'),
          values,
          token,
          errorPrefix: 'Sheets append failed'
        });
      }

      await writeTabularExport({
        fetchImpl,
        spreadsheetId: config.spreadsheetId,
        syncDoc,
        token
      });

      return { revision: nextRevision };
    }
  };
};
