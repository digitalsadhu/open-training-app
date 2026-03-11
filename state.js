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

export const startSessionState = (program, workoutId, sessions, createId, dateISO) => {
  if (!program) return null;
  const workout = program.workouts.find(item => item.id === workoutId);
  if (!workout) return null;

  const entries = workout.exercises.map(exercise => {
    const last = lastEntryForExercise(sessions, exercise.id, workout.id);
    const setCount = Math.max(1, Number(exercise.defaultSets) || 1);
    const lastSets = Array.isArray(last?.sets) ? last.sets : [];
    return {
      exerciseId: exercise.id,
      name: exercise.name,
      sets: Array.from({ length: setCount }, (_, index) => ({
        reps: '',
        weight: '',
        targetReps: lastSets[index]?.reps ?? '',
        targetWeight: lastSets[index]?.weight ?? '',
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
