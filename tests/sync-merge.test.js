import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSyncDocs } from '../sync/merge.js';

const emptyDoc = () => ({
  version: 1,
  updatedAt: 0,
  sourceDeviceId: 'dev-local',
  records: {
    program: {},
    workout: {},
    workoutExercise: {},
    session: {}
  }
});

test('mergeSyncDocs chooses newer local record', () => {
  const local = emptyDoc();
  const remote = emptyDoc();

  local.records.program.p1 = { id: 'p1', name: 'Local', updatedAt: 20, deletedAt: null };
  remote.records.program.p1 = { id: 'p1', name: 'Remote', updatedAt: 10, deletedAt: null };

  const merged = mergeSyncDocs(local, remote, 30);
  assert.equal(merged.records.program.p1.name, 'Local');
});

test('mergeSyncDocs chooses newer remote record', () => {
  const local = emptyDoc();
  const remote = emptyDoc();

  local.records.program.p1 = { id: 'p1', name: 'Local', updatedAt: 10, deletedAt: null };
  remote.records.program.p1 = { id: 'p1', name: 'Remote', updatedAt: 20, deletedAt: null };

  const merged = mergeSyncDocs(local, remote, 30);
  assert.equal(merged.records.program.p1.name, 'Remote');
});

test('mergeSyncDocs keeps newer tombstone', () => {
  const local = emptyDoc();
  const remote = emptyDoc();

  local.records.program.p1 = { id: 'p1', name: 'Local', updatedAt: 20, deletedAt: null };
  remote.records.program.p1 = { id: 'p1', updatedAt: 25, deletedAt: 25 };

  const merged = mergeSyncDocs(local, remote, 30);
  assert.equal(merged.records.program.p1.deletedAt, 25);
});

test('mergeSyncDocs is deterministic across run order', () => {
  const a = emptyDoc();
  const b = emptyDoc();

  a.records.session.s1 = { id: 's1', updatedAt: 50, deletedAt: null, notes: 'A' };
  b.records.session.s1 = { id: 's1', updatedAt: 55, deletedAt: null, notes: 'B' };
  b.records.program.p1 = { id: 'p1', updatedAt: 30, deletedAt: null, name: 'B Program' };

  const one = mergeSyncDocs(a, b, 60);
  const two = mergeSyncDocs(b, a, 60);

  assert.deepEqual(one.records, two.records);
});
