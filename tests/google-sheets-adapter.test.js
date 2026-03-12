import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSheetsAdapter } from '../sync/googleSheetsAdapter.js';
import { SyncConflictError } from '../sync/errors.js';

const makeResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload)
});

const baseDoc = {
  version: 1,
  updatedAt: 100,
  sourceDeviceId: 'device-a',
  records: {
    program: {},
    workout: {},
    workoutExercise: {},
    session: {}
  }
};

test('google adapter pull parses latest row payload', async () => {
  const fetchImpl = async () =>
    makeResponse(200, {
      values: [
        ['doc_id', 'revision', 'updated_at', 'payload_json'],
        ['default', '2', '2026-03-10T00:00:00.000Z', JSON.stringify(baseDoc)]
      ]
    });

  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  const pull = await adapter.pull({
    config: { clientId: 'c', spreadsheetId: 'sheet1', sheetName: '__training_sync', docId: 'default' }
  });

  assert.equal(pull.revision, 2);
  assert.deepEqual(pull.doc.records, baseDoc.records);
});

test('google adapter validateConfig rejects missing required fields', () => {
  const adapter = createGoogleSheetsAdapter({
    fetchImpl: async () => makeResponse(200, { values: [] }),
    tokenProvider: async () => 'token'
  });

  assert.throws(() => adapter.validateConfig({ spreadsheetId: 'sheet1' }), /clientId is required/);
  assert.throws(() => adapter.validateConfig({ clientId: 'c' }), /spreadsheetId is required/);
});

test('google adapter can create target config with new spreadsheet', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body || '' });
    if (options.method === 'POST' && /\/v4\/spreadsheets$/.test(url)) {
      return makeResponse(200, { spreadsheetId: 'new-sheet-123' });
    }
    return makeResponse(200, {});
  };

  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  const config = await adapter.createTargetConfig({
    clientId: 'client-1',
    spreadsheetTitle: 'My Training Data',
    sheetName: '__training_sync',
    docId: 'default'
  });

  assert.equal(config.spreadsheetId, 'new-sheet-123');
  assert.equal(config.spreadsheetTitle, 'My Training Data');
  const createCall = calls.find(call => call.method === 'POST' && /\/v4\/spreadsheets$/.test(call.url));
  assert.ok(createCall);
  assert.match(createCall.body, /My Training Data/);
});

test('google adapter can list spreadsheets for selection UI', async () => {
  const fetchImpl = async (url, options = {}) => {
    if ((!options.method || options.method === 'GET') && url.includes('/drive/v3/files')) {
      return makeResponse(200, {
        files: [
          { id: 'sheet-a', name: 'Training Data A', modifiedTime: '2026-03-11T12:00:00Z' },
          { id: 'sheet-b', name: 'Training Data B', modifiedTime: '2026-03-10T12:00:00Z' }
        ]
      });
    }
    return makeResponse(200, {});
  };

  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  const sheets = await adapter.listSpreadsheets({ clientId: 'client-1' }, 10);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].id, 'sheet-a');
  assert.equal(sheets[1].name, 'Training Data B');
});

test('google adapter assertBackupExists accepts valid backup sheet', async () => {
  const backupDoc = {
    version: 1,
    updatedAt: 200,
    sourceDeviceId: 'dev',
    records: {
      program: {},
      workout: {},
      workoutExercise: {},
      session: {}
    }
  };

  const fetchImpl = async () =>
    makeResponse(200, {
      values: [
        ['doc_id', 'revision', 'updated_at', 'payload_json'],
        ['default', '5', '2026-03-11T00:00:00.000Z', JSON.stringify(backupDoc)]
      ]
    });

  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  const result = await adapter.assertBackupExists({
    clientId: 'client-1',
    spreadsheetId: 'sheet-ok',
    sheetName: '__training_sync',
    docId: 'default'
  });

  assert.equal(result.revision, 5);
});

test('google adapter assertBackupExists rejects invalid sheet', async () => {
  const fetchImpl = async () => makeResponse(200, { values: [['doc_id', 'revision', 'updated_at', 'payload_json']] });
  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  await assert.rejects(
    adapter.assertBackupExists({
      clientId: 'client-1',
      spreadsheetId: 'sheet-bad',
      sheetName: '__training_sync',
      docId: 'default'
    }),
    /not a valid Training App backup/
  );
});

test('google adapter push bumps revision', async () => {
  let call = 0;
  const fetchImpl = async (_url, options = {}) => {
    call += 1;
    if (!options.method || options.method === 'GET') {
      return makeResponse(200, {
        values: [
          ['doc_id', 'revision', 'updated_at', 'payload_json'],
          ['default', '3', '2026-03-10T00:00:00.000Z', JSON.stringify(baseDoc)]
        ]
      });
    }
    return makeResponse(200, {});
  };

  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  const push = await adapter.push(
    { config: { clientId: 'c', spreadsheetId: 'sheet1', sheetName: '__training_sync', docId: 'default' } },
    baseDoc,
    3
  );

  assert.equal(push.revision, 4);
  assert.ok(call >= 2);
});

test('google adapter push writes readable export tabs', async () => {
  const calls = [];
  const doc = {
    ...baseDoc,
    records: {
      ...baseDoc.records,
      program: {
        p1: { id: 'p1', name: 'Program', notes: '', createdAt: 1, order: 0, updatedAt: 100, deletedAt: null, sourceDeviceId: 'dev' }
      },
      workoutExercise: {
        'w1:e1': {
          id: 'w1:e1',
          workoutId: 'w1',
          exerciseId: 'e1',
          name: 'Bench Press',
          defaultSets: 3,
          defaultReps: '',
          defaultWeight: '',
          muscleGroups: ['Chest', 'Arms'],
          order: 0,
          updatedAt: 100,
          deletedAt: null,
          sourceDeviceId: 'dev'
        }
      }
    }
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body || '' });
    if (!options.method || options.method === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        return makeResponse(200, { sheets: [{ properties: { title: '__training_sync' } }] });
      }
      return makeResponse(200, {
        values: [
          ['doc_id', 'revision', 'updated_at', 'payload_json'],
          ['default', '1', '2026-03-10T00:00:00.000Z', JSON.stringify(baseDoc)]
        ]
      });
    }
    return makeResponse(200, {});
  };

  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  await adapter.push(
    { config: { clientId: 'c', spreadsheetId: 'sheet1', sheetName: '__training_sync', docId: 'default' } },
    doc,
    1
  );

  const exportWrite = calls.find(call => call.method === 'PUT' && call.url.includes("'programs'!A1"));
  assert.ok(exportWrite, 'expected export write to programs tab');
  assert.match(exportWrite.body, /Program/);
  const workoutExerciseWrite = calls.find(call => call.method === 'PUT' && call.url.includes("'workout_exercises'!A1"));
  assert.ok(workoutExerciseWrite, 'expected export write to workout_exercises tab');
  assert.match(workoutExerciseWrite.body, /muscle_groups/);
  assert.match(workoutExerciseWrite.body, /Chest/);
});

test('google adapter push throws conflict on revision mismatch', async () => {
  const fetchImpl = async (_url, options = {}) => {
    if (!options.method || options.method === 'GET') {
      return makeResponse(200, {
        values: [
          ['doc_id', 'revision', 'updated_at', 'payload_json'],
          ['default', '7', '2026-03-10T00:00:00.000Z', JSON.stringify(baseDoc)]
        ]
      });
    }
    return makeResponse(200, {});
  };

  const adapter = createGoogleSheetsAdapter({
    fetchImpl,
    tokenProvider: async () => 'token'
  });

  await assert.rejects(
    adapter.push(
      { config: { clientId: 'c', spreadsheetId: 'sheet1', sheetName: '__training_sync', docId: 'default' } },
      baseDoc,
      2
    ),
    SyncConflictError
  );
});

test('google adapter surfaces auth failures', async () => {
  const adapter = createGoogleSheetsAdapter({
    fetchImpl: async () => makeResponse(200, { values: [] }),
    tokenProvider: async () => {
      throw new Error('oauth failed');
    }
  });

  await assert.rejects(
    adapter.pull({ config: { clientId: 'c', spreadsheetId: 'sheet1', sheetName: '__training_sync', docId: 'default' } }),
    /oauth failed/
  );
});
