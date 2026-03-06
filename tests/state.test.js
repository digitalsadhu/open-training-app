import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDraftSetState,
  addExerciseToWorkoutState,
  addWorkoutToProgramState,
  createProgramState,
  removeDraftSetState,
  removeExerciseFromWorkoutState,
  removeWorkoutFromProgramState,
  startSessionState,
  updateDraftSetState,
  updateWorkoutDefaultsState
} from '../state.js';

test('createProgramState adds a program with a default workout and selects it', () => {
  let id = 0;
  const createId = () => `id-${++id}`;
  const result = createProgramState([], 'Push Pull Legs', createId);
  assert.equal(result.program.name, 'Push Pull Legs');
  assert.equal(result.program.workouts.length, 1);
  assert.equal(result.program.workouts[0].name, 'Workout A');
  assert.equal(result.selectedProgramId, result.program.id);
  assert.equal(result.selectedWorkoutId, result.program.workouts[0].id);
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

test('updateWorkoutDefaultsState updates reps and weight', () => {
  const programs = [{
    id: 'p1',
    name: 'Program',
    workouts: [{
      id: 'w1',
      name: 'Push',
      exercises: [{ id: 'e1', name: 'Press', defaultReps: '', defaultWeight: '' }]
    }]
  }];
  const next = updateWorkoutDefaultsState(programs, 'p1', 'w1', 'e1', 'defaultReps', '8');
  const final = updateWorkoutDefaultsState(next, 'p1', 'w1', 'e1', 'defaultWeight', '60');
  assert.equal(final[0].workouts[0].exercises[0].defaultReps, 8);
  assert.equal(final[0].workouts[0].exercises[0].defaultWeight, 60);
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
    workouts: [{ id: 'w1', name: 'Bench Day', exercises: [{ id: 'e1', name: 'Bench', defaultReps: 5, defaultWeight: 100 }] }]
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
  assert.equal(draft.entries[0].sets[0].reps, 6);
  assert.equal(draft.entries[0].sets[0].weight, 105);
});

test('draft set mutations adjust entries', () => {
  const draft = {
    id: 's1',
    entries: [{ exerciseId: 'e1', name: 'Bench', sets: [{ reps: 5, weight: 100 }] }]
  };
  const added = addDraftSetState(draft, 'e1');
  assert.equal(added.entries[0].sets.length, 2);
  const updated = updateDraftSetState(added, 'e1', 1, 'reps', '8');
  assert.equal(updated.entries[0].sets[1].reps, 8);
  const removed = removeDraftSetState(updated, 'e1', 0);
  assert.equal(removed.entries[0].sets.length, 1);
});
