import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultSyncState,
  finalizeLocalStateForSync,
  migrateStateForSync,
  stateToSyncDoc,
  syncDocToState
} from '../sync/model.js';

const baseState = () => ({
  programs: [
    {
      id: 'p1',
      name: 'Program',
      workouts: [
        {
          id: 'w1',
          name: 'Workout A',
          exercises: [{
            id: 'e1',
            name: 'Bench',
            defaultSets: 3,
            defaultReps: '',
            defaultWeight: '',
            muscleGroups: ['Chest', 'Arms']
          }]
        }
      ]
    }
  ],
  sessions: [],
  selectedProgramId: 'p1',
  selectedWorkoutId: 'w1',
  draftSession: null,
  exerciseCache: { updatedAt: 0, exercises: [] },
  sync: createDefaultSyncState()
});

test('migrateStateForSync backfills metadata', () => {
  const migrated = migrateStateForSync(baseState(), 1_000);
  assert.ok(migrated.sync.deviceId);
  assert.equal(migrated.programs[0].updatedAt, 1_000);
  assert.equal(migrated.programs[0].workouts[0].updatedAt, 1_000);
  assert.equal(migrated.programs[0].workouts[0].exercises[0].updatedAt, 1_000);
});

test('finalizeLocalStateForSync creates tombstones for local deletions', () => {
  const previous = migrateStateForSync(baseState(), 1_000);
  const next = {
    ...previous,
    programs: [],
    selectedProgramId: '',
    selectedWorkoutId: ''
  };

  const finalized = finalizeLocalStateForSync(next, previous, 2_000);
  const tombstone = finalized.sync.tombstones.program.p1;
  assert.equal(tombstone.deletedAt, 2_000);
});

test('syncDocToState hides deleted records from arrays', () => {
  const state = migrateStateForSync(baseState(), 1_000);
  const doc = stateToSyncDoc(state, state.sync.deviceId, 1_100);
  doc.records.program.p1.deletedAt = 1_200;
  doc.records.program.p1.updatedAt = 1_200;

  const merged = syncDocToState(state, doc);
  assert.equal(merged.programs.length, 0);
  assert.ok(merged.sync.tombstones.program.p1);
});

test('sync round trip preserves workout exercise muscle groups', () => {
  const migrated = migrateStateForSync(baseState(), 1_000);
  const doc = stateToSyncDoc(migrated, migrated.sync.deviceId, 1_100);
  const merged = syncDocToState(migrated, doc);
  assert.deepEqual(merged.programs[0].workouts[0].exercises[0].muscleGroups, ['Chest', 'Arms']);
});
