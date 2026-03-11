export const clampNumber = value => {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Number(value);
  return Number.isNaN(parsed) ? '' : parsed;
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

export const getRepRangeForPriority = trainingPriority =>
  trainingPriority === 'strength'
    ? { min: 3, max: 6 }
    : { min: 8, max: 12 };

const getProgressionConfig = (exercise, trainingPriority) => {
  const defaultRange = getRepRangeForPriority(trainingPriority);
  const repRangeMin = Math.max(1, toNumberOr(exercise?.repRangeMin, defaultRange.min));
  const repRangeMax = Math.max(repRangeMin, toNumberOr(exercise?.repRangeMax, defaultRange.max));
  const weightStepKg = Math.max(0.25, toNumberOr(exercise?.weightStepKg, trainingPriority === 'strength' ? 2.5 : 1.25));
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
              defaultWeight: ''
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
            item.id === exerciseId ? { ...item, [field]: clampNumber(value) } : item
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
    const last = lastEntryForExercise(sessions, exercise.id, workout.id);
    const config = getProgressionConfig(exercise, trainingPriority);
    const setCount = Math.max(1, Number(exercise.defaultSets) || 1);
    const lastSets = Array.isArray(last?.sets) ? last.sets : [];
    const fallbackLastReps = toNumberOr(lastSets[0]?.reps, NaN);
    const fallbackLastWeight = clampNumber(lastSets[0]?.weight);

    const nextTargetReps =
      toNumberOr(last?.progression?.nextTargetReps, NaN) ||
      fallbackLastReps ||
      config.repRangeMin;

    const defaultWeight = clampNumber(exercise.defaultWeight);
    const nextTargetWeightFromHistory = clampNumber(last?.progression?.nextTargetWeight);
    const nextTargetWeight =
      nextTargetWeightFromHistory !== ''
        ? nextTargetWeightFromHistory
        : fallbackLastWeight !== ''
          ? fallbackLastWeight
          : defaultWeight;

    return {
      exerciseId: exercise.id,
      name: exercise.name,
      sets: Array.from({ length: setCount }, () => ({
        reps: '',
        weight: '',
        targetReps: nextTargetReps,
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
      sets: [...entry.sets, { reps: '', weight: '', targetReps: '', targetWeight: '', logged: false }]
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
      const weight = set.weight === '' ? set.targetWeight : set.weight;
      return { ...set, reps, weight, logged: true };
    });
    return { ...entry, sets };
  });
  return { ...draftSession, entries: updatedEntries };
};
