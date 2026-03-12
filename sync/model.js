export const SYNC_SCHEMA_VERSION = 1;
const UNCATEGORIZED_GROUP = 'Uncategorized';
const normalizeMuscleGroups = groups => {
  const normalized = Array.from(
    new Set(
      (Array.isArray(groups) ? groups : [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
    )
  );
  return normalized.length > 0 ? normalized : [UNCATEGORIZED_GROUP];
};

export const SYNC_TYPES = {
  PROGRAM: 'program',
  WORKOUT: 'workout',
  WORKOUT_EXERCISE: 'workoutExercise',
  SESSION: 'session'
};

const EMPTY_TOMBSTONES = {
  [SYNC_TYPES.PROGRAM]: {},
  [SYNC_TYPES.WORKOUT]: {},
  [SYNC_TYPES.WORKOUT_EXERCISE]: {},
  [SYNC_TYPES.SESSION]: {}
};

export const createDefaultSyncState = () => ({
  version: SYNC_SCHEMA_VERSION,
  deviceId: '',
  autoSyncEnabled: true,
  targets: [],
  tombstones: structuredClone(EMPTY_TOMBSTONES),
  isSyncing: false,
  lastAutoSyncAt: 0
});

const shallowClone = value => JSON.parse(JSON.stringify(value));

export const createDeviceId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeTombstones = tombstones => {
  const next = structuredClone(EMPTY_TOMBSTONES);
  Object.values(SYNC_TYPES).forEach(type => {
    const source = tombstones?.[type] || {};
    Object.entries(source).forEach(([id, record]) => {
      if (!record || typeof record !== 'object') return;
      next[type][id] = {
        ...record,
        id,
        type,
        deletedAt: Number(record.deletedAt) || Number(record.updatedAt) || Date.now(),
        updatedAt: Number(record.updatedAt) || Number(record.deletedAt) || Date.now(),
        sourceDeviceId: String(record.sourceDeviceId || '')
      };
    });
  });
  return next;
};

const normalizeTarget = target => ({
  id: String(target.id || ''),
  adapterId: String(target.adapterId || ''),
  name: String(target.name || 'Sync target'),
  status: String(target.status || 'idle'),
  config: target.config || {},
  lastSyncedAt: Number(target.lastSyncedAt) || 0,
  lastError: String(target.lastError || ''),
  lastRevision: Number(target.lastRevision) || 0,
  connected: target.connected !== false
});

const cloneAndStampSessionEntries = (entries, updatedAt, sourceDeviceId) =>
  (entries || []).map(entry => ({
    ...entry,
    updatedAt: Number(entry.updatedAt) || updatedAt,
    deletedAt: entry.deletedAt || null,
    sourceDeviceId: String(entry.sourceDeviceId || sourceDeviceId || '')
  }));

const stampProgramTree = (programs, now, sourceDeviceId) =>
  (programs || []).map(program => ({
    ...program,
    updatedAt: Number(program.updatedAt) || now,
    deletedAt: program.deletedAt || null,
    sourceDeviceId: String(program.sourceDeviceId || sourceDeviceId || ''),
    workouts: (program.workouts || []).map(workout => ({
      ...workout,
      updatedAt: Number(workout.updatedAt) || Number(program.updatedAt) || now,
      deletedAt: workout.deletedAt || null,
      sourceDeviceId: String(workout.sourceDeviceId || sourceDeviceId || ''),
      exercises: (workout.exercises || []).map(exercise => ({
        ...exercise,
        muscleGroups: normalizeMuscleGroups(exercise.muscleGroups),
        updatedAt: Number(exercise.updatedAt) || Number(workout.updatedAt) || Number(program.updatedAt) || now,
        deletedAt: exercise.deletedAt || null,
        sourceDeviceId: String(exercise.sourceDeviceId || sourceDeviceId || '')
      }))
    }))
  }));

const stampSessions = (sessions, now, sourceDeviceId) =>
  (sessions || []).map(session => ({
    ...session,
    updatedAt: Number(session.updatedAt) || Number(session.savedAt) || now,
    deletedAt: session.deletedAt || null,
    sourceDeviceId: String(session.sourceDeviceId || sourceDeviceId || ''),
    entries: cloneAndStampSessionEntries(session.entries, Number(session.updatedAt) || Number(session.savedAt) || now, sourceDeviceId)
  }));

export const migrateStateForSync = (state, now = Date.now()) => {
  const nextSync = {
    ...createDefaultSyncState(),
    ...(state.sync || {})
  };

  if (!nextSync.deviceId) {
    nextSync.deviceId = createDeviceId();
  }

  nextSync.targets = (nextSync.targets || []).map(normalizeTarget);
  nextSync.tombstones = normalizeTombstones(nextSync.tombstones);
  nextSync.version = SYNC_SCHEMA_VERSION;

  return {
    ...state,
    programs: stampProgramTree(state.programs, now, nextSync.deviceId),
    sessions: stampSessions(state.sessions, now, nextSync.deviceId),
    sync: nextSync
  };
};

const stripMeta = record => {
  if (!record || typeof record !== 'object') return record;
  const next = { ...record };
  delete next.updatedAt;
  delete next.deletedAt;
  delete next.sourceDeviceId;
  return next;
};

const valueEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const indexLocalRecords = state => {
  const index = {
    [SYNC_TYPES.PROGRAM]: {},
    [SYNC_TYPES.WORKOUT]: {},
    [SYNC_TYPES.WORKOUT_EXERCISE]: {},
    [SYNC_TYPES.SESSION]: {}
  };

  (state.programs || []).forEach((program, programOrder) => {
    index[SYNC_TYPES.PROGRAM][program.id] = {
      id: program.id,
      name: program.name,
      notes: program.notes || '',
      createdAt: program.createdAt || 0,
      order: programOrder,
      updatedAt: Number(program.updatedAt) || 0,
      deletedAt: program.deletedAt || null,
      sourceDeviceId: program.sourceDeviceId || ''
    };

    (program.workouts || []).forEach((workout, workoutOrder) => {
      index[SYNC_TYPES.WORKOUT][workout.id] = {
        id: workout.id,
        programId: program.id,
        name: workout.name,
        order: workoutOrder,
        updatedAt: Number(workout.updatedAt) || Number(program.updatedAt) || 0,
        deletedAt: workout.deletedAt || null,
        sourceDeviceId: workout.sourceDeviceId || program.sourceDeviceId || ''
      };

      (workout.exercises || []).forEach((exercise, exerciseOrder) => {
        const id = `${workout.id}:${exercise.id}`;
        index[SYNC_TYPES.WORKOUT_EXERCISE][id] = {
          id,
          workoutId: workout.id,
          exerciseId: exercise.id,
          name: exercise.name,
          defaultSets: Number(exercise.defaultSets) || 0,
          defaultReps: exercise.defaultReps ?? '',
          defaultWeight: exercise.defaultWeight ?? '',
          muscleGroups: normalizeMuscleGroups(exercise.muscleGroups),
          order: exerciseOrder,
          updatedAt:
            Number(exercise.updatedAt) ||
            Number(workout.updatedAt) ||
            Number(program.updatedAt) ||
            0,
          deletedAt: exercise.deletedAt || null,
          sourceDeviceId: exercise.sourceDeviceId || workout.sourceDeviceId || program.sourceDeviceId || ''
        };
      });
    });
  });

  (state.sessions || []).forEach((session, order) => {
    index[SYNC_TYPES.SESSION][session.id] = {
      ...session,
      order,
      updatedAt: Number(session.updatedAt) || Number(session.savedAt) || 0,
      deletedAt: session.deletedAt || null,
      sourceDeviceId: session.sourceDeviceId || ''
    };
  });

  return index;
};

const mergeTombstonesIntoIndex = (index, tombstones) => {
  Object.values(SYNC_TYPES).forEach(type => {
    const records = tombstones?.[type] || {};
    Object.entries(records).forEach(([id, record]) => {
      const existing = index[type][id];
      if (!existing || Number(record.updatedAt) >= Number(existing.updatedAt || 0)) {
        index[type][id] = {
          ...record,
          id,
          type,
          deletedAt: Number(record.deletedAt) || Number(record.updatedAt) || Date.now(),
          updatedAt: Number(record.updatedAt) || Number(record.deletedAt) || Date.now()
        };
      }
    });
  });
};

export const stateToSyncDoc = (state, sourceDeviceId = '', now = Date.now()) => {
  const index = indexLocalRecords(state);
  mergeTombstonesIntoIndex(index, state.sync?.tombstones);

  return {
    version: SYNC_SCHEMA_VERSION,
    updatedAt: now,
    sourceDeviceId: sourceDeviceId || state.sync?.deviceId || '',
    records: index
  };
};

const sortByOrderThenUpdated = list =>
  list
    .slice()
    .sort((a, b) => {
      const byOrder = Number(a.order || 0) - Number(b.order || 0);
      if (byOrder !== 0) return byOrder;
      return Number(a.updatedAt || 0) - Number(b.updatedAt || 0);
    });

export const syncDocToState = (state, syncDoc) => {
  const programsById = {};
  const workoutsByProgram = {};
  const exercisesByWorkout = {};

  Object.values(syncDoc.records?.program || {}).forEach(program => {
    if (program.deletedAt) return;
    programsById[program.id] = {
      id: program.id,
      name: program.name || 'Program',
      notes: program.notes || '',
      createdAt: Number(program.createdAt) || 0,
      updatedAt: Number(program.updatedAt) || Date.now(),
      deletedAt: null,
      sourceDeviceId: String(program.sourceDeviceId || ''),
      workouts: []
    };
  });

  Object.values(syncDoc.records?.workout || {}).forEach(workout => {
    if (workout.deletedAt) return;
    if (!programsById[workout.programId]) return;
    const next = {
      id: workout.id,
      name: workout.name || 'Workout',
      updatedAt: Number(workout.updatedAt) || Date.now(),
      deletedAt: null,
      sourceDeviceId: String(workout.sourceDeviceId || ''),
      exercises: [],
      order: Number(workout.order) || 0
    };
    if (!workoutsByProgram[workout.programId]) workoutsByProgram[workout.programId] = [];
    workoutsByProgram[workout.programId].push(next);
  });

  Object.values(syncDoc.records?.workoutExercise || {}).forEach(exercise => {
    if (exercise.deletedAt) return;
    const next = {
      id: exercise.exerciseId,
      name: exercise.name,
      defaultSets: Number(exercise.defaultSets) || 0,
      defaultReps: exercise.defaultReps ?? '',
      defaultWeight: exercise.defaultWeight ?? '',
      muscleGroups: normalizeMuscleGroups(exercise.muscleGroups),
      updatedAt: Number(exercise.updatedAt) || Date.now(),
      deletedAt: null,
      sourceDeviceId: String(exercise.sourceDeviceId || ''),
      order: Number(exercise.order) || 0
    };
    if (!exercisesByWorkout[exercise.workoutId]) exercisesByWorkout[exercise.workoutId] = [];
    exercisesByWorkout[exercise.workoutId].push(next);
  });

  Object.values(programsById).forEach(program => {
    const workouts = sortByOrderThenUpdated(workoutsByProgram[program.id] || []).map(workout => {
      const exercises = sortByOrderThenUpdated(exercisesByWorkout[workout.id] || []).map(item => {
        const { order, ...rest } = item;
        return rest;
      });
      const { order, ...rest } = workout;
      return { ...rest, exercises };
    });
    program.workouts = workouts;
  });

  const sessions = sortByOrderThenUpdated(
    Object.values(syncDoc.records?.session || {}).filter(item => !item.deletedAt)
  )
    .map(session => {
      const { order, ...rest } = session;
      return {
        ...rest,
        updatedAt: Number(rest.updatedAt) || Number(rest.savedAt) || Date.now(),
        deletedAt: null,
        sourceDeviceId: String(rest.sourceDeviceId || '')
      };
    })
    .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));

  const tombstones = structuredClone(EMPTY_TOMBSTONES);
  Object.values(SYNC_TYPES).forEach(type => {
    Object.entries(syncDoc.records?.[type] || {}).forEach(([id, record]) => {
      if (!record?.deletedAt) return;
      tombstones[type][id] = {
        ...record,
        id,
        type,
        updatedAt: Number(record.updatedAt) || Number(record.deletedAt) || Date.now(),
        deletedAt: Number(record.deletedAt) || Number(record.updatedAt) || Date.now(),
        sourceDeviceId: String(record.sourceDeviceId || '')
      };
    });
  });

  const nextSync = {
    ...createDefaultSyncState(),
    ...(state.sync || {}),
    tombstones,
    version: SYNC_SCHEMA_VERSION
  };

  return {
    ...state,
    programs: Object.values(programsById),
    sessions,
    sync: nextSync
  };
};

export const finalizeLocalStateForSync = (nextState, previousState, now = Date.now()) => {
  const sourceDeviceId = nextState.sync?.deviceId || previousState.sync?.deviceId || createDeviceId();
  const previousDoc = stateToSyncDoc(previousState, sourceDeviceId, now);
  const nextDoc = stateToSyncDoc(nextState, sourceDeviceId, now);

  Object.values(SYNC_TYPES).forEach(type => {
    const prevRecords = previousDoc.records[type] || {};
    const currRecords = nextDoc.records[type] || {};

    Object.entries(currRecords).forEach(([id, current]) => {
      const previous = prevRecords[id];
      if (!previous) {
        currRecords[id] = {
          ...current,
          updatedAt: Number(current.updatedAt) || now,
          deletedAt: null,
          sourceDeviceId
        };
        return;
      }

      const previousComparable = stripMeta(previous);
      const currentComparable = stripMeta(current);
      if (valueEqual(previousComparable, currentComparable)) {
        currRecords[id] = {
          ...current,
          updatedAt: Number(current.updatedAt) || Number(previous.updatedAt) || now,
          deletedAt: null,
          sourceDeviceId: current.sourceDeviceId || previous.sourceDeviceId || sourceDeviceId
        };
      } else {
        currRecords[id] = {
          ...current,
          updatedAt: now,
          deletedAt: null,
          sourceDeviceId
        };
      }
    });

    Object.entries(prevRecords).forEach(([id, previous]) => {
      if (currRecords[id]) return;
      currRecords[id] = {
        ...stripMeta(previous),
        id,
        type,
        updatedAt: now,
        deletedAt: now,
        sourceDeviceId
      };
    });
  });

  const mergedState = syncDocToState(
    {
      ...nextState,
      sync: {
        ...createDefaultSyncState(),
        ...(nextState.sync || {}),
        deviceId: sourceDeviceId,
        version: SYNC_SCHEMA_VERSION
      }
    },
    {
      ...nextDoc,
      updatedAt: now,
      sourceDeviceId,
      records: nextDoc.records
    }
  );

  mergedState.sync.deviceId = sourceDeviceId;
  return mergedState;
};

export const alignSelections = state => {
  const selectedProgram = state.programs.find(item => item.id === state.selectedProgramId) || state.programs[0] || null;
  const selectedWorkout =
    selectedProgram?.workouts?.find(item => item.id === state.selectedWorkoutId) ||
    selectedProgram?.workouts?.[0] ||
    null;

  return {
    ...state,
    selectedProgramId: selectedProgram?.id || '',
    selectedWorkoutId: selectedWorkout?.id || '',
    draftSession:
      state.draftSession &&
      selectedProgram &&
      state.draftSession.programId === selectedProgram.id &&
      (selectedWorkout ? state.draftSession.workoutId === selectedWorkout.id : !state.draftSession.workoutId)
        ? state.draftSession
        : null
  };
};

export const cloneState = state => shallowClone(state);
