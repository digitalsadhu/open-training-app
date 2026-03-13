import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncRegistry } from '../sync/registry.js';
import { runSyncForTargets } from '../sync/engine.js';
import { SyncConflictError } from '../sync/errors.js';
import { createDefaultSyncState, migrateStateForSync } from '../sync/model.js';
import { mergeSyncDocs } from '../sync/merge.js';

const baseState = () =>
  migrateStateForSync({
    programs: [
      { id: 'p1', name: 'Program', workouts: [] }
    ],
    sessions: [],
    selectedProgramId: 'p1',
    selectedWorkoutId: '',
    draftSession: null,
    exerciseCache: { updatedAt: 0, exercises: [] },
    sync: {
      ...createDefaultSyncState(),
      targets: []
    }
  });

test('runSyncForTargets syncs targets sequentially', async () => {
  const seen = [];
  const registry = new SyncRegistry();

  const mkAdapter = id => ({
    id,
    validateConfig: config => config,
    connect: async config => config,
    disconnect: async () => true,
    pull: async () => ({ revision: 0, doc: null }),
    push: async (_target, doc) => {
      seen.push({ id, hasPrograms: Object.keys(doc.records.program || {}).length });
      return { revision: 1 };
    }
  });

  registry.register(mkAdapter('a'));
  registry.register(mkAdapter('b'));

  const state = baseState();
  state.sync.targets = [
    { id: 't1', adapterId: 'a', name: 'A', status: 'idle', config: {}, lastSyncedAt: 0, lastError: '', lastRevision: 0, connected: true },
    { id: 't2', adapterId: 'b', name: 'B', status: 'idle', config: {}, lastSyncedAt: 0, lastError: '', lastRevision: 0, connected: true }
  ];

  const run = await runSyncForTargets({ state, registry });
  assert.equal(run.results.length, 2);
  assert.deepEqual(seen.map(item => item.id), ['a', 'b']);
});

test('runSyncForTargets retries once on conflict', async () => {
  const registry = new SyncRegistry();
  let pushCalls = 0;

  registry.register({
    id: 'conflict',
    validateConfig: config => config,
    connect: async config => config,
    disconnect: async () => true,
    pull: async () => ({ revision: 1, doc: null }),
    push: async () => {
      pushCalls += 1;
      if (pushCalls === 1) throw new SyncConflictError();
      return { revision: 2 };
    }
  });

  const state = baseState();
  state.sync.targets = [
    { id: 't1', adapterId: 'conflict', name: 'Conflict', status: 'idle', config: {}, lastSyncedAt: 0, lastError: '', lastRevision: 0, connected: true }
  ];

  const run = await runSyncForTargets({ state, registry });
  assert.equal(run.results[0].ok, true);
  assert.equal(pushCalls, 2);
});

test('mergeSyncDocs keeps local deletion when remote still has record', () => {
  const local = {
    version: 1,
    updatedAt: 0,
    sourceDeviceId: 'local',
    records: {
      program: { p1: { id: 'p1', updatedAt: 10, deletedAt: null } },
      workout: { w1: { id: 'w1', programId: 'p1', updatedAt: 30, deletedAt: 30 } },
      workoutExercise: {},
      session: {}
    }
  };
  const remote = {
    version: 1,
    updatedAt: 0,
    sourceDeviceId: 'remote',
    records: {
      program: { p1: { id: 'p1', updatedAt: 20, deletedAt: null } },
      workout: { w1: { id: 'w1', programId: 'p1', name: 'Resurrected', updatedAt: 50, deletedAt: null } },
      workoutExercise: {},
      session: {}
    }
  };
  const merged = mergeSyncDocs(local, remote, 60);
  assert.equal(merged.records.workout.w1.deletedAt, 30);
});
