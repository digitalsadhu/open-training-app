export const clampNumber = value => {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Number(value);
  return Number.isNaN(parsed) ? '' : parsed;
};
export const EXERCISE_SET_TYPES = {
  REPS_WEIGHT: 'reps_weight',
  TIME: 'time',
  TIME_WEIGHT: 'time_weight'
};
export const PLANNED_PROGRAM_TYPE = 'sequence';
export const normalizeExerciseSetType = value => {
  if (value === EXERCISE_SET_TYPES.TIME) return EXERCISE_SET_TYPES.TIME;
  if (value === EXERCISE_SET_TYPES.TIME_WEIGHT) return EXERCISE_SET_TYPES.TIME_WEIGHT;
  return EXERCISE_SET_TYPES.REPS_WEIGHT;
};
const setTypeUsesReps = setType => setType === EXERCISE_SET_TYPES.REPS_WEIGHT;
const setTypeUsesTime = setType => setType === EXERCISE_SET_TYPES.TIME || setType === EXERCISE_SET_TYPES.TIME_WEIGHT;
const setTypeUsesWeight = setType => setType === EXERCISE_SET_TYPES.REPS_WEIGHT || setType === EXERCISE_SET_TYPES.TIME_WEIGHT;
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

const makeWorkout = (createId, name) => ({
  id: createId(),
  name,
  exercises: []
});

const toNumberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundToStep = (value, step) => {
  const safeStep = Math.max(0.01, Number(step) || 1);
  const rounded = Math.round(value / safeStep) * safeStep;
  return Number(rounded.toFixed(2));
};

const normalizeNameKey = value =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');

const toPositiveNumberOrBlank = value => {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : '';
};

const toPositiveIntegerOrBlank = value => {
  const parsed = toPositiveNumberOrBlank(value);
  return parsed === '' ? '' : Math.round(parsed);
};

const normalizeTrainingMaxesKg = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [String(key || '').trim(), toPositiveNumberOrBlank(raw)])
      .filter(([key, raw]) => key && raw !== '')
  );
};

const normalizeLoadRoundingKg = value => toPositiveNumberOrBlank(value) || 2.5;

const makePlannedExerciseId = entry => {
  const provided = String(entry?.exerciseId || entry?.id || '').trim();
  if (provided) return provided;
  const liftKey = String(entry?.liftKey || '').trim();
  const nameKey = normalizeNameKey(entry?.name);
  return `planned:${liftKey || nameKey || 'exercise'}`;
};

const normalizePlannedSet = (set, setType, sessionLabel, entryLabel, setIndex) => {
  const targetReps = setTypeUsesReps(setType)
    ? toPositiveIntegerOrBlank(set?.targetReps ?? set?.reps)
    : '';
  const targetTime = setTypeUsesTime(setType)
    ? toPositiveNumberOrBlank(set?.targetTime ?? set?.time)
    : '';
  const targetWeight = setTypeUsesWeight(setType)
    ? toPositiveNumberOrBlank(set?.targetWeight ?? set?.weight)
    : '';
  const percent = setTypeUsesWeight(setType)
    ? toPositiveNumberOrBlank(set?.percent)
    : '';

  if (targetReps === '' && targetTime === '' && targetWeight === '' && percent === '') {
    throw new Error(`${sessionLabel} ${entryLabel} set ${setIndex + 1} needs reps, time, targetWeight, or percent.`);
  }

  return {
    targetReps,
    targetTime,
    targetWeight,
    percent
  };
};

const normalizePlannedEntry = (entry, sessionLabel, entryIndex) => {
  const name = String(entry?.name || '').trim();
  if (!name) {
    throw new Error(`${sessionLabel} entry ${entryIndex + 1} is missing an exercise name.`);
  }

  const setType = normalizeExerciseSetType(entry?.setType);
  const rawSets = Array.isArray(entry?.sets) ? entry.sets : [];
  if (rawSets.length === 0) {
    throw new Error(`${sessionLabel} ${name} needs at least one prescribed set.`);
  }

  const liftKey = String(entry?.liftKey || '').trim();
  return {
    id: String(entry?.id || makePlannedExerciseId(entry)),
    exerciseId: makePlannedExerciseId(entry),
    name,
    liftKey,
    setType,
    muscleGroups: normalizeMuscleGroups(entry?.muscleGroups),
    sets: rawSets.map((set, setIndex) => normalizePlannedSet(set || {}, setType, sessionLabel, name, setIndex))
  };
};

const sortPlannedSessions = sessions =>
  sessions.slice().sort((a, b) =>
    Number(a.week) - Number(b.week) ||
    Number(a.day) - Number(b.day) ||
    Number(a.order || 0) - Number(b.order || 0)
  );

const parsePlannedProgramSource = rawPlan => {
  if (typeof rawPlan !== 'string') return rawPlan && typeof rawPlan === 'object' ? rawPlan : {};
  const trimmed = rawPlan.trim();
  if (!trimmed) throw new Error('Paste planned program JSON before importing.');
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Planned program JSON is invalid: ${error?.message || String(error)}`);
  }
};

export const isPlannedProgram = program =>
  program?.schedule?.type === PLANNED_PROGRAM_TYPE &&
  Array.isArray(program.schedule.sessions);

export const normalizePlannedProgramImport = (rawPlan, createId, now = Date.now()) => {
  const plan = parsePlannedProgramSource(rawPlan);
  const programName = String(plan.programName || plan.name || '').trim();
  if (!programName) throw new Error('Planned program JSON needs a programName.');

  const rawSessions = Array.isArray(plan.sessions)
    ? plan.sessions
    : Array.isArray(plan.schedule?.sessions)
      ? plan.schedule.sessions
      : [];
  if (rawSessions.length === 0) {
    throw new Error('Planned program JSON needs at least one session.');
  }

  const sessions = rawSessions.map((session, index) => {
    const week = toPositiveIntegerOrBlank(session?.week);
    const day = toPositiveIntegerOrBlank(session?.day);
    if (week === '' || day === '') {
      throw new Error(`Session ${index + 1} needs positive numeric week and day values.`);
    }

    const sessionLabel = `Week ${week} Day ${day}`;
    const entries = Array.isArray(session?.entries) ? session.entries : [];
    if (entries.length === 0) {
      throw new Error(`${sessionLabel} needs at least one exercise entry.`);
    }

    return {
      id: String(session?.id || createId()),
      week,
      day,
      name: String(session?.name || sessionLabel).trim() || sessionLabel,
      order: index,
      entries: entries.map((entry, entryIndex) => normalizePlannedEntry(entry || {}, sessionLabel, entryIndex))
    };
  });

  const sortedSessions = sortPlannedSessions(sessions);
  const durationWeeks =
    toPositiveIntegerOrBlank(plan.durationWeeks ?? plan.schedule?.durationWeeks) ||
    Math.max(...sortedSessions.map(session => Number(session.week) || 0));

  return {
    id: String(plan.id || createId()),
    name: programName,
    notes: String(plan.notes || '').trim(),
    workouts: [],
    createdAt: Number(plan.createdAt) || now,
    trainingMaxesKg: normalizeTrainingMaxesKg(plan.trainingMaxesKg),
    loadRoundingKg: normalizeLoadRoundingKg(plan.loadRoundingKg),
    schedule: {
      type: PLANNED_PROGRAM_TYPE,
      durationWeeks,
      sessions: sortedSessions
    }
  };
};

export const createPlannedProgramState = (programs, rawPlan, createId, now = Date.now()) => {
  const program = normalizePlannedProgramImport(rawPlan, createId, now);
  return {
    programs: [program, ...programs],
    selectedProgramId: program.id,
    selectedWorkoutId: '',
    program
  };
};

export const getCompletedPlannedSessionIds = (sessions, programId) =>
  new Set(
    (sessions || [])
      .filter(session => session.programId === programId && session.plannedSessionId)
      .map(session => String(session.plannedSessionId))
  );

export const getPlannedProgramProgress = (program, sessions) => {
  const plannedSessions = isPlannedProgram(program) ? sortPlannedSessions(program.schedule.sessions || []) : [];
  const completedIds = getCompletedPlannedSessionIds(sessions, program?.id);
  const nextSession = plannedSessions.find(session => !completedIds.has(String(session.id))) || null;
  return {
    total: plannedSessions.length,
    completed: plannedSessions.filter(session => completedIds.has(String(session.id))).length,
    nextSession,
    sessions: plannedSessions,
    completedIds
  };
};

export const getRepRangeForPriority = trainingPriority =>
  trainingPriority === 'strength'
    ? { min: 3, max: 6 }
    : { min: 8, max: 12 };

const getProgressionConfig = (exercise, trainingPriority) => {
  const effectivePriority = exercise?.trainingPriority || trainingPriority;
  const defaultRange = getRepRangeForPriority(effectivePriority);
  const repRangeMin = Math.max(1, toNumberOr(exercise?.repRangeMin, defaultRange.min));
  const repRangeMax = Math.max(repRangeMin, toNumberOr(exercise?.repRangeMax, defaultRange.max));
  const weightStepKg = Math.max(0.25, toNumberOr(exercise?.weightStepKg, effectivePriority === 'strength' ? 2.5 : 1.25));
  const deloadPercent = Math.min(25, Math.max(2.5, toNumberOr(exercise?.deloadPercent, 7.5)));
  const failStreakForDeload = Math.max(2, toNumberOr(exercise?.failStreakForDeload, 2));

  return {
    repRangeMin,
    repRangeMax,
    weightStepKg,
    deloadPercent,
    failStreakForDeload
  };
};

const getFirstFilled = (sets, key) => {
  const found = (sets || []).find(set => set?.[key] !== '' && set?.[key] !== null && set?.[key] !== undefined);
  return found ? found[key] : '';
};

export const computeProgressionForEntry = ({
  draftEntry,
  loggedSets,
  exercise,
  previousEntry,
  trainingPriority
}) => {
  const config = getProgressionConfig(exercise, trainingPriority);
  const previousFailStreak = Math.max(0, Number(previousEntry?.progression?.failStreakAfter) || 0);
  const plannedSets = Math.max(1, Number(exercise?.defaultSets) || (loggedSets || []).length || 1);
  const requiredSets = Math.max(1, Math.ceil(plannedSets * 0.67));

  const baselineTargetReps =
    toNumberOr(getFirstFilled(draftEntry?.sets, 'targetReps'), NaN) ||
    toNumberOr(previousEntry?.progression?.nextTargetReps, NaN) ||
    config.repRangeMin;

  const baselineTargetWeightRaw =
    clampNumber(getFirstFilled(draftEntry?.sets, 'targetWeight')) !== ''
      ? clampNumber(getFirstFilled(draftEntry?.sets, 'targetWeight'))
      : clampNumber(previousEntry?.progression?.nextTargetWeight);

  const baselineTargetWeight = clampNumber(baselineTargetWeightRaw);

  const successfulSets = (loggedSets || []).filter(set => {
    const repsOk = toNumberOr(set?.reps, 0) >= toNumberOr(baselineTargetReps, 0);
    if (baselineTargetWeight === '') return repsOk;
    const weightOk = toNumberOr(set?.weight, 0) >= toNumberOr(baselineTargetWeight, 0);
    return repsOk && weightOk;
  }).length;

  const topRangeSets = (loggedSets || []).filter(
    set => toNumberOr(set?.reps, 0) >= config.repRangeMax
  ).length;

  const sessionSuccess = successfulSets >= requiredSets;
  const topReached = topRangeSets >= requiredSets;

  let nextTargetReps = Math.max(config.repRangeMin, Math.min(config.repRangeMax, toNumberOr(baselineTargetReps, config.repRangeMin)));
  let nextTargetWeight = baselineTargetWeight;
  let failStreakAfter = previousFailStreak;
  let decision = 'hold';

  if (sessionSuccess && topReached) {
    decision = 'increase_weight';
    nextTargetReps = config.repRangeMin;
    failStreakAfter = 0;
    if (nextTargetWeight !== '') {
      nextTargetWeight = roundToStep(toNumberOr(nextTargetWeight, 0) + config.weightStepKg, config.weightStepKg);
    }
  } else if (sessionSuccess) {
    decision = 'increase_reps';
    nextTargetReps = Math.min(config.repRangeMax, toNumberOr(nextTargetReps, config.repRangeMin) + 1);
    failStreakAfter = 0;
  } else {
    failStreakAfter = previousFailStreak + 1;
    if (failStreakAfter >= config.failStreakForDeload && nextTargetWeight !== '') {
      decision = 'deload';
      const factor = 1 - config.deloadPercent / 100;
      nextTargetWeight = roundToStep(toNumberOr(nextTargetWeight, 0) * factor, config.weightStepKg);
      nextTargetReps = Math.round((config.repRangeMin + config.repRangeMax) / 2);
      failStreakAfter = 0;
    }
  }

  return {
    decision,
    sessionSuccess,
    topReached,
    successfulSets,
    requiredSets,
    failStreakAfter,
    nextTargetReps,
    nextTargetWeight,
    config
  };
};

export const createProgramState = (programs, name, createId) => {
  const trimmed = name.trim();
  if (!trimmed) {
    return {
      programs,
      selectedProgramId: programs[0]?.id || '',
      selectedWorkoutId: programs[0]?.workouts?.[0]?.id || '',
      program: null
    };
  }

  const program = {
    id: createId(),
    name: trimmed,
    workouts: [],
    createdAt: Date.now()
  };

  return {
    programs: [program, ...programs],
    selectedProgramId: program.id,
    selectedWorkoutId: '',
    program
  };
};

export const addWorkoutToProgramState = (programs, programId, workoutName, createId) => {
  const trimmed = workoutName.trim();
  if (!trimmed) {
    return { programs, workout: null };
  }

  const workout = makeWorkout(createId, trimmed);
  const nextPrograms = programs.map(program =>
    program.id === programId ? { ...program, workouts: [...program.workouts, workout] } : program
  );

  return { programs: nextPrograms, workout };
};

export const removeWorkoutFromProgramState = (programs, programId, workoutId) =>
  programs.map(program => {
    if (program.id !== programId) return program;
    return {
      ...program,
      workouts: program.workouts.filter(workout => workout.id !== workoutId)
    };
  });

export const addExerciseToWorkoutState = (programs, programId, workoutId, exercise) =>
  programs.map(program => {
    if (program.id !== programId) return program;
    return {
      ...program,
      workouts: program.workouts.map(workout => {
        if (workout.id !== workoutId) return workout;
        const exists = workout.exercises.some(item => item.id === exercise.id && item.name === exercise.name);
        if (exists) return workout;
        return {
          ...workout,
          exercises: [
            ...workout.exercises,
            {
              id: exercise.id,
              name: exercise.name,
              defaultSets: exercise.defaultSets || 3,
              defaultReps: '',
              defaultTime: '',
              defaultWeight: '',
              setType: normalizeExerciseSetType(exercise.setType),
              trainingPriority: exercise.trainingPriority || null,
              muscleGroups: normalizeMuscleGroups(exercise.muscleGroups)
            }
          ]
        };
      })
    };
  });

export const removeExerciseFromWorkoutState = (programs, programId, workoutId, exerciseId) =>
  programs.map(program => {
    if (program.id !== programId) return program;
    return {
      ...program,
      workouts: program.workouts.map(workout => {
        if (workout.id !== workoutId) return workout;
        return {
          ...workout,
          exercises: workout.exercises.filter(item => item.id !== exerciseId)
        };
      })
    };
  });

export const moveExerciseInWorkoutState = (programs, programId, workoutId, exerciseId, direction) =>
  programs.map(program => {
    if (program.id !== programId) return program;
    return {
      ...program,
      workouts: program.workouts.map(workout => {
        if (workout.id !== workoutId) return workout;
        const fromIndex = workout.exercises.findIndex(item => item.id === exerciseId);
        if (fromIndex < 0) return workout;
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        if (toIndex < 0 || toIndex >= workout.exercises.length) return workout;
        const nextExercises = [...workout.exercises];
        const [moved] = nextExercises.splice(fromIndex, 1);
        nextExercises.splice(toIndex, 0, moved);
        return {
          ...workout,
          exercises: nextExercises
        };
      })
    };
  });

export const updateWorkoutDefaultsState = (programs, programId, workoutId, exerciseId, field, value) =>
  programs.map(program => {
    if (program.id !== programId) return program;
    return {
      ...program,
      workouts: program.workouts.map(workout => {
        if (workout.id !== workoutId) return workout;
        return {
          ...workout,
          exercises: workout.exercises.map(item =>
            item.id === exerciseId
              ? {
                  ...item,
                  [field]:
                    field === 'trainingPriority'
                      ? value || null
                      : field === 'setType'
                        ? normalizeExerciseSetType(value)
                      : clampNumber(value)
                }
              : item
          )
        };
      })
    };
  });

export const lastEntryForExercise = (sessions, exerciseId, workoutId = '') => {
  for (const session of sessions) {
    if (workoutId && session.workoutId !== workoutId) continue;
    const entry = session.entries.find(item => item.exerciseId === exerciseId);
    if (entry) return entry;
  }
  return null;
};

export const startSessionState = (program, workoutId, sessions, createId, dateISO, trainingPriority = 'hypertrophy') => {
  if (!program) return null;
  const workout = program.workouts.find(item => item.id === workoutId);
  if (!workout) return null;

  const entries = workout.exercises.map(exercise => {
    const setType = normalizeExerciseSetType(exercise.setType);
    const last = lastEntryForExercise(sessions, exercise.id, workout.id);
    const config = getProgressionConfig(exercise, trainingPriority);
    const setCount = Math.max(1, Number(exercise.defaultSets) || 1);
    const lastSets = Array.isArray(last?.sets) ? last.sets : [];
    const fallbackLastReps = toNumberOr(lastSets[0]?.reps, NaN);
    const fallbackLastTime = clampNumber(lastSets[0]?.time);
    const fallbackLastWeight = clampNumber(lastSets[0]?.weight);

    const nextTargetReps = setTypeUsesReps(setType)
      ? (toNumberOr(last?.progression?.nextTargetReps, NaN) ||
        fallbackLastReps ||
        toNumberOr(exercise.defaultReps, NaN) ||
        config.repRangeMin)
      : '';

    const defaultTime = clampNumber(exercise.defaultTime);
    const nextTargetTime = setTypeUsesTime(setType)
      ? (fallbackLastTime !== '' ? fallbackLastTime : defaultTime)
      : '';

    const defaultWeight = clampNumber(exercise.defaultWeight);
    const nextTargetWeightFromHistory = clampNumber(last?.progression?.nextTargetWeight);
    const nextTargetWeight = setTypeUsesWeight(setType)
      ? (nextTargetWeightFromHistory !== ''
        ? nextTargetWeightFromHistory
        : fallbackLastWeight !== ''
          ? fallbackLastWeight
          : defaultWeight)
      : '';

    return {
      exerciseId: exercise.id,
      name: exercise.name,
      setType,
      muscleGroups: normalizeMuscleGroups(exercise.muscleGroups),
      sets: Array.from({ length: setCount }, () => ({
        reps: '',
        time: '',
        weight: '',
        targetReps: nextTargetReps,
        targetTime: nextTargetTime,
        targetWeight: nextTargetWeight,
        logged: false
      }))
    };
  });

  return {
    id: createId(),
    programId: program.id,
    workoutId: workout.id,
    workoutName: workout.name,
    date: dateISO,
    entries,
    notes: ''
  };
};

const resolvePlannedTargetWeight = (program, entry, set) => {
  const explicit = clampNumber(set?.targetWeight);
  if (explicit !== '') return explicit;

  const percent = toPositiveNumberOrBlank(set?.percent);
  const liftKey = String(entry?.liftKey || '').trim();
  const trainingMax = toPositiveNumberOrBlank(program?.trainingMaxesKg?.[liftKey]);
  if (percent === '' || trainingMax === '') return '';

  return roundToStep((trainingMax * percent) / 100, normalizeLoadRoundingKg(program?.loadRoundingKg));
};

export const startPlannedSessionState = (program, plannedSessionId, sessions, createId, dateISO) => {
  if (!isPlannedProgram(program)) return null;

  const progress = getPlannedProgramProgress(program, sessions);
  const plannedSession = plannedSessionId
    ? progress.sessions.find(session => session.id === plannedSessionId)
    : progress.nextSession;
  if (!plannedSession) return null;

  return {
    id: createId(),
    programId: program.id,
    workoutId: plannedSession.id,
    workoutName: plannedSession.name,
    plannedSessionId: plannedSession.id,
    plannedWeek: plannedSession.week,
    plannedDay: plannedSession.day,
    date: dateISO,
    entries: (plannedSession.entries || []).map(entry => {
      const setType = normalizeExerciseSetType(entry.setType);
      return {
        exerciseId: entry.exerciseId || entry.id,
        plannedEntryId: entry.id || entry.exerciseId,
        name: entry.name,
        liftKey: entry.liftKey || '',
        setType,
        muscleGroups: normalizeMuscleGroups(entry.muscleGroups),
        sets: (entry.sets || []).map(set => ({
          reps: '',
          time: '',
          weight: '',
          targetReps: setTypeUsesReps(setType) ? clampNumber(set.targetReps) : '',
          targetTime: setTypeUsesTime(setType) ? clampNumber(set.targetTime) : '',
          targetWeight: setTypeUsesWeight(setType) ? resolvePlannedTargetWeight(program, entry, set) : '',
          percent: set?.percent ?? '',
          logged: false
        }))
      };
    }),
    notes: ''
  };
};

export const updateDraftSetState = (draftSession, exerciseId, setIndex, field, value) => {
  const updatedEntries = draftSession.entries.map(entry => {
    if (entry.exerciseId !== exerciseId) return entry;
    const sets = entry.sets.map((set, index) =>
      index === setIndex ? { ...set, [field]: clampNumber(value) } : set
    );
    return { ...entry, sets };
  });
  return { ...draftSession, entries: updatedEntries };
};

export const addDraftSetState = (draftSession, exerciseId) => {
  const updatedEntries = draftSession.entries.map(entry => {
    if (entry.exerciseId !== exerciseId) return entry;
    return {
      ...entry,
      sets: [...entry.sets, { reps: '', time: '', weight: '', targetReps: '', targetTime: '', targetWeight: '', logged: false }]
    };
  });
  return { ...draftSession, entries: updatedEntries };
};

export const removeDraftSetState = (draftSession, exerciseId, setIndex) => {
  const updatedEntries = draftSession.entries.map(entry => {
    if (entry.exerciseId !== exerciseId) return entry;
    return {
      ...entry,
      sets: entry.sets.filter((_, index) => index !== setIndex)
    };
  });
  return { ...draftSession, entries: updatedEntries };
};

export const logDraftSetState = (draftSession, exerciseId, setIndex) => {
  const updatedEntries = draftSession.entries.map(entry => {
    if (entry.exerciseId !== exerciseId) return entry;
    const sets = entry.sets.map((set, index) => {
      if (index !== setIndex) return set;
      const reps = set.reps === '' ? set.targetReps : set.reps;
      const time = set.time === '' ? set.targetTime : set.time;
      const weight = set.weight === '' ? set.targetWeight : set.weight;
      return { ...set, reps, time, weight, logged: true };
    });
    return { ...entry, sets };
  });
  return { ...draftSession, entries: updatedEntries };
};
