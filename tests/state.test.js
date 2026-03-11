import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDraftSetState,
  addExerciseToWorkoutState,
  addWorkoutToProgramState,
  createProgramState,
  logDraftSetState,
  removeDraftSetState,
  removeExerciseFromWorkoutState,
  removeWorkoutFromProgramState,
  startSessionState,
  updateDraftSetState,
  updateWorkoutDefaultsState
} from '../state.js';

test('createProgramState adds a program without default workouts', () => {
  let id = 0;
  const createId = () => `id-${++id}`;
  const result = createProgramState([], 'Push Pull Legs', createId);
  assert.equal(result.program.name, 'Push Pull Legs');
  assert.equal(result.program.workouts.length, 0);
  assert.equal(result.selectedProgramId, result.program.id);
  assert.equal(result.selectedWorkoutId, '');
});

test('addWorkoutToProgramState adds named workouts', () => {
  const programs = [{ id: 'p1', name: 'Program', workouts: [] }];
  const next = addWorkoutToProgramState(programs, 'p1', 'Upper A', () => 'w1');
  assert.equal(next.programs[0].workouts.length, 1);
  assert.equal(next.programs[0].workouts[0].name, 'Upper A');
});

test('addExerciseToWorkoutState inserts exercise once', () => {
  const programs = [{ id: 'p1', name: 'Program', workouts: [{ id: 'w1', name: 'Push', exercises: [] }] }];
  const next = addExerciseToWorkoutState(programs, 'p1', 'w1', { id: 'e1', name: 'Squat' });
  assert.equal(next[0].workouts[0].exercises.length, 1);
  const again = addExerciseToWorkoutState(next, 'p1', 'w1', { id: 'e1', name: 'Squat' });
  assert.equal(again[0].workouts[0].exercises.length, 1);
});

test('removeExerciseFromWorkoutState removes by id', () => {
  const programs = [{
    id: 'p1',
    name: 'Program',
    workouts: [{ id: 'w1', name: 'Pull', exercises: [{ id: 'e1', name: 'Row' }] }]
  }];
  const next = removeExerciseFromWorkoutState(programs, 'p1', 'w1', 'e1');
  assert.equal(next[0].workouts[0].exercises.length, 0);
});

test('updateWorkoutDefaultsState updates sets', () => {
  const programs = [{
    id: 'p1',
    name: 'Program',
    workouts: [{
      id: 'w1',
      name: 'Push',
      exercises: [{ id: 'e1', name: 'Press', defaultReps: '', defaultWeight: '' }]
    }]
  }];
  const withSets = updateWorkoutDefaultsState(programs, 'p1', 'w1', 'e1', 'defaultSets', '4');
  assert.equal(withSets[0].workouts[0].exercises[0].defaultSets, 4);
});

test('removeWorkoutFromProgramState removes workout', () => {
  const programs = [{
    id: 'p1',
    name: 'Program',
    workouts: [
      { id: 'w1', name: 'Upper', exercises: [] },
      { id: 'w2', name: 'Lower', exercises: [] }
    ]
  }];
  const next = removeWorkoutFromProgramState(programs, 'p1', 'w1');
  assert.equal(next[0].workouts.length, 1);
  assert.equal(next[0].workouts[0].id, 'w2');
});

test('startSessionState hydrates from last session for same workout', () => {
  const program = {
    id: 'p1',
    name: 'Program',
    workouts: [{ id: 'w1', name: 'Bench Day', exercises: [{ id: 'e1', name: 'Bench', defaultSets: 3, defaultReps: 5, defaultWeight: 100 }] }]
  };
  const sessions = [
    {
      programId: 'p1',
      workoutId: 'w1',
      entries: [{ exerciseId: 'e1', name: 'Bench', sets: [{ reps: 6, weight: 105 }] }]
    }
  ];
  const draft = startSessionState(program, 'w1', sessions, () => 's1', '2026-02-13');
  assert.equal(draft.workoutId, 'w1');
  assert.equal(draft.workoutName, 'Bench Day');
  assert.equal(draft.entries[0].sets.length, 3);
  assert.equal(draft.entries[0].sets[0].reps, '');
  assert.equal(draft.entries[0].sets[0].weight, '');
  assert.equal(draft.entries[0].sets[0].targetReps, 6);
  assert.equal(draft.entries[0].sets[0].targetWeight, 105);
  assert.equal(draft.entries[0].sets[0].logged, false);
  assert.equal(draft.entries[0].sets[1].targetReps, '');
  assert.equal(draft.entries[0].sets[1].targetWeight, '');
});

test('startSessionState builds default number of sets when no prior session exists', () => {
  const program = {
    id: 'p1',
    name: 'Program',
    workouts: [{ id: 'w1', name: 'Push', exercises: [{ id: 'e1', name: 'Press', defaultSets: 4, defaultReps: 8, defaultWeight: 50 }] }]
  };
  const draft = startSessionState(program, 'w1', [], () => 's1', '2026-02-13');
  assert.equal(draft.entries[0].sets.length, 4);
  assert.equal(draft.entries[0].sets[0].reps, '');
  assert.equal(draft.entries[0].sets[0].weight, '');
  assert.equal(draft.entries[0].sets[0].targetReps, '');
  assert.equal(draft.entries[0].sets[0].targetWeight, '');
});

test('draft set mutations adjust entries', () => {
  const draft = {
    id: 's1',
    entries: [{ exerciseId: 'e1', name: 'Bench', sets: [{ reps: '', weight: '', targetReps: 5, targetWeight: 100, logged: false }] }]
  };
  const added = addDraftSetState(draft, 'e1');
  assert.equal(added.entries[0].sets.length, 2);
  const updated = updateDraftSetState(added, 'e1', 1, 'reps', '8');
  assert.equal(updated.entries[0].sets[1].reps, 8);
  const logged = logDraftSetState(updated, 'e1', 0);
  assert.equal(logged.entries[0].sets[0].reps, 5);
  assert.equal(logged.entries[0].sets[0].weight, 100);
  assert.equal(logged.entries[0].sets[0].logged, true);
  const removed = removeDraftSetState(logged, 'e1', 0);
  assert.equal(removed.entries[0].sets.length, 1);
});
