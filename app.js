import { LitElement, html, css } from 'https://cdn.jsdelivr.net/npm/lit@3.2.0/+esm';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/button/button.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/callout/callout.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/input/input.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/select/select.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/option/option.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/textarea/textarea.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/tab-group/tab-group.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/tab/tab.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@latest/dist-cdn/components/tab-panel/tab-panel.js';
import { fetchExercises, getEnglishLanguageId } from './data.js';
import {
  addDraftSetState,
  addExerciseToWorkoutState,
  addWorkoutToProgramState,
  createProgramState,
  lastEntryForExercise,
  logDraftSetState,
  removeDraftSetState,
  removeExerciseFromWorkoutState,
  removeWorkoutFromProgramState,
  startSessionState,
  updateDraftSetState,
  updateWorkoutDefaultsState
} from './state.js';

const STORAGE_KEY = 'training-app:v1';
const EXERCISE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

const defaultState = {
  programs: [],
  sessions: [],
  selectedProgramId: '',
  selectedWorkoutId: '',
  draftSession: null,
  exerciseCache: {
    updatedAt: 0,
    exercises: []
  }
};

const normalizePrograms = programs =>
  (programs || []).map(program => {
    if (Array.isArray(program.workouts) && program.workouts.length > 0) {
      return {
        ...program,
        workouts: program.workouts.map(workout => ({
          ...workout,
          exercises: workout.exercises || []
        }))
      };
    }

    const migratedExercises = Array.isArray(program.exercises) ? program.exercises : [];
    return {
      ...program,
      workouts: [
        {
          id:
            globalThis.crypto?.randomUUID?.() ||
            `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          name: 'Workout A',
          exercises: migratedExercises
        }
      ]
    };
  });

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw);
    return {
      ...defaultState,
      ...parsed,
      programs: normalizePrograms(parsed.programs || []),
      exerciseCache: {
        ...defaultState.exerciseCache,
        ...(parsed.exerciseCache || {})
      }
    };
  } catch (error) {
    console.warn('Failed to load state', error);
    return { ...defaultState };
  }
};

const saveState = state => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const formatDate = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const formatNumber = value => (value === '' || value === null || value === undefined ? '-' : value);
const formatTimestamp = value =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    : 'Never';
const createId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `id-${Date.now()}-${randomPart}`;
};

class TrainingApp extends LitElement {
  static properties = {
    programs: { state: true },
    sessions: { state: true },
    selectedProgramId: { state: true },
    selectedWorkoutId: { state: true },
    draftSession: { state: true },
    exercises: { state: true },
    exerciseSearch: { state: true },
    loadingExercises: { state: true },
    selectedExercise: { state: true },
    exerciseCacheUpdatedAt: { state: true },
    exerciseLoadError: { state: true },
    exerciseFetchStatus: { state: true }
  };

  static styles = css`
    :host {
      display: block;
    }
  `;

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    const saved = loadState();
    this.programs = saved.programs;
    this.sessions = saved.sessions;
    this.selectedProgramId = saved.selectedProgramId || this.programs[0]?.id || '';
    const initialProgram = this.programs.find(item => item.id === this.selectedProgramId);
    this.selectedWorkoutId =
      saved.selectedWorkoutId || initialProgram?.workouts?.[0]?.id || '';
    this.draftSession = saved.draftSession;
    this.exercises = saved.exerciseCache.exercises || [];
    this.exerciseSearch = '';
    this.loadingExercises = false;
    this.selectedExercise = '';
    this.exerciseCacheUpdatedAt = saved.exerciseCache.updatedAt || 0;
    this.exerciseLoadError = '';
    this.exerciseFetchStatus = {
      state: 'idle',
      lastStart: 0,
      lastEnd: 0,
      lastCount: 0,
      lastError: ''
    };
  }

  connectedCallback() {
    super.connectedCallback();
    console.info('[training-app] connected');
    this.installMobileZoomGuard();
    this.loadExerciseLibrary();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(error => {
        console.warn('Service worker registration failed', error);
      });
    }
  }

  installMobileZoomGuard() {
    if (window.__trainingAppZoomGuardInstalled) return;
    window.__trainingAppZoomGuardInstalled = true;

    let lastTouchEnd = 0;
    const prevent = event => event.preventDefault();
    const listenerOptions = { passive: false, capture: true };

    document.addEventListener(
      'touchend',
      event => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
          event.preventDefault();
        }
        lastTouchEnd = now;
      },
      listenerOptions
    );

    // iOS Safari/PWA pinch gesture events
    window.addEventListener('gesturestart', prevent, listenerOptions);
    window.addEventListener('gesturechange', prevent, listenerOptions);
    window.addEventListener('gestureend', prevent, listenerOptions);
    document.addEventListener('gesturestart', prevent, listenerOptions);
    document.addEventListener('gesturechange', prevent, listenerOptions);
    document.addEventListener('gestureend', prevent, listenerOptions);

    // Block multi-touch as early as possible
    const blockMultiTouch = event => {
      if (event.touches && event.touches.length > 1) {
        event.preventDefault();
      }
    };
    window.addEventListener('touchstart', blockMultiTouch, listenerOptions);
    document.addEventListener('touchstart', blockMultiTouch, listenerOptions);

    // Block multi-touch zoom while allowing normal one-finger scroll
    window.addEventListener('touchmove', blockMultiTouch, listenerOptions);
    document.addEventListener('touchmove', blockMultiTouch, listenerOptions);
  }

  firstUpdated() {
    if (this.exercises.length === 0 && !this.loadingExercises) {
      this.loadExerciseLibrary(true);
    }
  }

  persist() {
    saveState({
      programs: this.programs,
      sessions: this.sessions,
      selectedProgramId: this.selectedProgramId,
      selectedWorkoutId: this.selectedWorkoutId,
      draftSession: this.draftSession,
      exerciseCache: {
        updatedAt: this.exerciseCacheUpdatedAt,
        exercises: this.exercises
      }
    });
  }

  updateExerciseCache(timestamp, exercises) {
    saveState({
      programs: this.programs,
      sessions: this.sessions,
      selectedProgramId: this.selectedProgramId,
      selectedWorkoutId: this.selectedWorkoutId,
      draftSession: this.draftSession,
      exerciseCache: {
        updatedAt: timestamp,
        exercises
      }
    });
    this.exerciseCacheUpdatedAt = timestamp;
  }

  async loadExerciseLibrary(force = false) {
    console.info('[training-app] loadExerciseLibrary', { force });
    const cached = loadState().exerciseCache;
    if (!force && cached.exercises.length > 0 && Date.now() - cached.updatedAt < EXERCISE_CACHE_MAX_AGE_MS) {
      this.exercises = cached.exercises;
      this.exerciseCacheUpdatedAt = cached.updatedAt;
      this.exerciseFetchStatus = {
        ...this.exerciseFetchStatus,
        state: 'cached',
        lastCount: this.exercises.length
      };
      return;
    }

    this.loadingExercises = true;
    this.exerciseLoadError = '';
    this.exerciseFetchStatus = {
      ...this.exerciseFetchStatus,
      state: 'loading',
      lastStart: Date.now(),
      lastError: ''
    };
    try {
      const languageId = await getEnglishLanguageId();
      const exercises = await fetchExercises(languageId);
      this.exercises = exercises;
      this.updateExerciseCache(Date.now(), exercises);
      this.exerciseFetchStatus = {
        ...this.exerciseFetchStatus,
        state: 'loaded',
        lastEnd: Date.now(),
        lastCount: exercises.length
      };
    } catch (error) {
      console.warn('Failed to load exercises', error);
      this.exerciseLoadError = 'Could not load the exercise library. Check your network and try again.';
      this.exerciseFetchStatus = {
        ...this.exerciseFetchStatus,
        state: 'error',
        lastEnd: Date.now(),
        lastError: error?.message || String(error)
      };
    } finally {
      this.loadingExercises = false;
    }
  }


  createProgram(name) {
    const next = createProgramState(this.programs, name, createId);
    if (!next.program) return;
    this.programs = next.programs;
    this.selectedProgramId = next.selectedProgramId;
    this.selectedWorkoutId = next.selectedWorkoutId;
    this.persist();
  }

  deleteProgram(programId) {
    this.programs = this.programs.filter(program => program.id !== programId);
    if (this.selectedProgramId === programId) {
      this.selectedProgramId = this.programs[0]?.id || '';
      this.selectedWorkoutId = this.programs[0]?.workouts?.[0]?.id || '';
    }
    this.sessions = this.sessions.filter(session => session.programId !== programId);
    if (this.draftSession?.programId === programId) {
      this.draftSession = null;
    }
    this.persist();
  }

  addWorkout(programId, workoutName) {
    const next = addWorkoutToProgramState(this.programs, programId, workoutName, createId);
    if (!next.workout) return;
    this.programs = next.programs;
    this.selectedWorkoutId = next.workout.id;
    this.persist();
  }

  removeWorkout(programId, workoutId) {
    const program = this.programs.find(item => item.id === programId);
    if (!program) return;
    this.programs = removeWorkoutFromProgramState(this.programs, programId, workoutId);
    if (this.selectedWorkoutId === workoutId) {
      const updatedProgram = this.programs.find(item => item.id === programId);
      this.selectedWorkoutId = updatedProgram?.workouts?.[0]?.id || '';
    }
    this.sessions = this.sessions.filter(session => !(session.programId === programId && session.workoutId === workoutId));
    if (this.draftSession?.programId === programId && this.draftSession?.workoutId === workoutId) {
      this.draftSession = null;
    }
    this.persist();
  }

  addExerciseToWorkout(programId, workoutId, exercise) {
    this.programs = addExerciseToWorkoutState(this.programs, programId, workoutId, exercise);
    this.persist();
  }

  removeExerciseFromWorkout(programId, workoutId, exerciseId) {
    this.programs = removeExerciseFromWorkoutState(this.programs, programId, workoutId, exerciseId);
    this.persist();
  }

  updateWorkoutDefaults(programId, workoutId, exerciseId, field, value) {
    this.programs = updateWorkoutDefaultsState(this.programs, programId, workoutId, exerciseId, field, value);
    this.persist();
  }

  startSession(programId, workoutId) {
    const program = this.programs.find(item => item.id === programId);
    this.draftSession = startSessionState(program, workoutId, this.sessions, createId, todayISO());
    this.persist();
  }

  updateDraftSet(exerciseId, setIndex, field, value) {
    this.draftSession = updateDraftSetState(this.draftSession, exerciseId, setIndex, field, value);
    this.persist();
  }

  addDraftSet(exerciseId) {
    this.draftSession = addDraftSetState(this.draftSession, exerciseId);
    this.persist();
  }

  removeDraftSet(exerciseId, setIndex) {
    this.draftSession = removeDraftSetState(this.draftSession, exerciseId, setIndex);
    this.persist();
  }

  logDraftSet(exerciseId, setIndex) {
    this.draftSession = logDraftSetState(this.draftSession, exerciseId, setIndex);
    this.persist();
  }

  resolveSpinnerValue(set, field, rawValue, inputType) {
    if (rawValue === '' || rawValue === null || rawValue === undefined) return rawValue;
    const currentValue = set[field];
    const targetField = field === 'reps' ? 'targetReps' : 'targetWeight';
    const targetValue = set[targetField];
    const parsedRaw = Number(rawValue);
    const parsedTarget = Number(targetValue);
    const isLikelySpinnerStep =
      inputType !== 'insertText' &&
      inputType !== 'insertFromPaste' &&
      !Number.isNaN(parsedRaw) &&
      Math.abs(parsedRaw) <= 1;

    if (
      currentValue === '' &&
      targetValue !== '' &&
      !Number.isNaN(parsedTarget) &&
      isLikelySpinnerStep
    ) {
      return parsedTarget + parsedRaw;
    }

    return rawValue;
  }

  saveSession() {
    if (!this.draftSession) return;
    const finalizedEntries = this.draftSession.entries.map(entry => ({
      ...entry,
      sets: entry.sets
        .filter(set => set.logged)
        .map(set => ({ reps: set.reps, weight: set.weight }))
    }));
    this.sessions = [
      { ...this.draftSession, entries: finalizedEntries, savedAt: Date.now() },
      ...this.sessions
    ];
    this.draftSession = null;
    this.persist();
  }

  lastEntryForExercise(exerciseId) {
    return lastEntryForExercise(this.sessions, exerciseId);
  }

  updateDraftNotes(value) {
    this.draftSession = { ...this.draftSession, notes: value };
    this.persist();
  }

  updateProgramNotes(programId, value) {
    this.programs = this.programs.map(program =>
      program.id === programId ? { ...program, notes: value } : program
    );
    this.persist();
  }

  selectExerciseFromSearch(programId, workoutId, exercise) {
    this.addExerciseToWorkout(programId, workoutId, exercise);
    this.exerciseSearch = '';
  }

  selectProgram(event) {
    this.selectedProgramId = event.target.value;
    const program = this.programs.find(item => item.id === this.selectedProgramId);
    this.selectedWorkoutId = program?.workouts?.[0]?.id || '';
    this.persist();
  }

  selectWorkout(workoutId) {
    this.selectedWorkoutId = workoutId;
    this.persist();
  }

  renderPrograms() {
    const program = this.programs.find(item => item.id === this.selectedProgramId);
    const selectedWorkout = program?.workouts?.find(item => item.id === this.selectedWorkoutId) || program?.workouts?.[0] || null;
    const search = this.exerciseSearch.trim().toLowerCase();
    const filteredExercises = this.exercises
      .map(item => ({ ...item, name: item.name || item.exercise?.name || item.translations?.[0]?.name || '' }))
      .filter(item => item.name)
      .filter(item => item.name.toLowerCase().includes(search))
      .slice(0, 8);

    return html`
      <section class="section">
        <h2>Programs</h2>
        <div class="stack">
          <div class="inline controls-row">
            <wa-input
              id="new-program"
              label="New program"
              placeholder="Push / Pull / Legs"
              @keydown=${event => {
                if (event.key === 'Enter') {
                  this.createProgram(event.target.value);
                  event.target.value = '';
                }
              }}
            ></wa-input>
            <wa-button
              variant="primary"
              @click=${() => {
                const input = this.renderRoot.querySelector('#new-program');
                if (input) {
                  this.createProgram(input.value);
                  input.value = '';
                }
              }}
            >Add</wa-button>
          </div>
          <div class="list">
            ${this.programs.map(item =>
              html`
                <div class="list-item">
                  <div>
                    <strong>${item.name}</strong>
                    <div class="muted">
                      ${item.workouts?.length || 0} workouts ·
                      ${(item.workouts || []).reduce((count, workout) => count + (workout.exercises?.length || 0), 0)} exercises
                    </div>
                  </div>
                  <div class="inline">
                    <wa-button
                      ?disabled=${this.selectedProgramId === item.id}
                      @click=${() => {
                        this.selectedProgramId = item.id;
                        this.persist();
                      }}
                    >${this.selectedProgramId === item.id ? 'Selected' : 'Select'}</wa-button>
                    <wa-button variant="danger" @click=${() => this.deleteProgram(item.id)}
                      >Delete</wa-button
                    >
                  </div>
                </div>
              `
            )}
          </div>
        </div>
      </section>

      ${program
        ? html`
            <section class="section">
              <h2>Program Builder</h2>
              <div class="stack">
                <div class="inline controls-row">
                  <wa-input
                    id="new-workout"
                    label="New workout"
                    placeholder="Push / Pull / Legs / Upper / Lower"
                    @keydown=${event => {
                      if (event.key === 'Enter') {
                        this.addWorkout(program.id, event.target.value);
                        event.target.value = '';
                      }
                    }}
                  ></wa-input>
                  <wa-button
                    variant="primary"
                    @click=${() => {
                      const input = this.renderRoot.querySelector('#new-workout');
                      if (input) {
                        this.addWorkout(program.id, input.value);
                        input.value = '';
                      }
                    }}
                  >Add Workout</wa-button>
                </div>

                <div class="list">
                  ${(program.workouts || []).map(workout =>
                    html`
                      <div class="list-item">
                        <div>
                          <strong>${workout.name}</strong>
                          <div class="muted">${workout.exercises.length} exercises</div>
                        </div>
                        <div class="inline">
                          <wa-button
                            ?disabled=${this.selectedWorkoutId === workout.id}
                            @click=${() => this.selectWorkout(workout.id)}
                          >${this.selectedWorkoutId === workout.id ? 'Selected' : 'Select'}</wa-button>
                          <wa-button
                            variant="danger"
                            @click=${() => this.removeWorkout(program.id, workout.id)}
                          >Delete</wa-button>
                        </div>
                      </div>
                    `
                  )}
                </div>

                ${selectedWorkout
                  ? html`<div class="badge">Editing workout: ${selectedWorkout.name}</div>`
                  : html``}

                <wa-input
                  label="Search exercises"
                  placeholder="Search open data or type your own and press Enter"
                  .value=${this.exerciseSearch}
                  @input=${event => {
                    this.exerciseSearch = event.target.value;
                  }}
                  @keydown=${event => {
                    if (event.key === 'Enter') {
                      const value = this.exerciseSearch.trim();
                      if (!value) return;
                      const exactMatch = this.exercises.find(
                        item => item.name.toLowerCase() === value.toLowerCase()
                      );
                      const exercise = exactMatch || { id: createId(), name: value };
                      if (!selectedWorkout) return;
                      this.selectExerciseFromSearch(program.id, selectedWorkout.id, exercise);
                    }
                  }}
                ></wa-input>

                ${this.loadingExercises
                  ? html`<div class="muted">Loading exercise library...</div>`
                  : html``}

                <div class="inline">
                  <div class="muted">Library updated: ${formatTimestamp(this.exerciseCacheUpdatedAt)}</div>
                  <wa-button @click=${() => this.loadExerciseLibrary(true)}>Reload library</wa-button>
                </div>

                ${this.exerciseLoadError
                  ? html`<wa-callout variant="danger">${this.exerciseLoadError}</wa-callout>`
                  : html``}

                <div class="muted">
                  Fetch status: ${this.exerciseFetchStatus.state} · last count ${this.exerciseFetchStatus.lastCount}
                </div>

                ${this.exerciseSearch
                  ? html`
                      <div class="list">
                        ${filteredExercises.map(item =>
                          html`
                            <div class="list-item">
                              <div>
                                <strong>${item.name}</strong>
                                <div class="muted">Open exercise library</div>
                              </div>
                              <wa-button
                                @click=${() =>
                                  this.selectExerciseFromSearch(program.id, selectedWorkout.id, {
                                    id: item.id,
                                    name: item.name
                                  })}
                              >Add</wa-button>
                            </div>
                          `
                        )}
                      </div>
                    `
                  : html``}

                <div class="list">
                  ${(selectedWorkout?.exercises || []).map(item =>
                    html`
                      <div class="list-item">
                        <div>
                          <strong>${item.name}</strong>
                          <div class="muted">
                            Defaults: ${formatNumber(item.defaultSets)} sets
                          </div>
                        </div>
                        <div class="inline exercise-defaults-row">
                          <wa-input
                            type="number"
                            label="Sets"
                            min="1"
                            style="max-width: 84px"
                            .value=${item.defaultSets}
                            @input=${event =>
                              this.updateWorkoutDefaults(program.id, selectedWorkout.id, item.id, 'defaultSets', event.target.value)}
                          ></wa-input>
                          <wa-button variant="danger" @click=${() => this.removeExerciseFromWorkout(program.id, selectedWorkout.id, item.id)}
                            >Remove</wa-button
                          >
                        </div>
                      </div>
                    `
                  )}
                </div>
              </div>
            </section>
          `
        : html``}
    `;
  }

  renderTraining() {
    const program = this.programs.find(item => item.id === this.selectedProgramId);
    const workouts = program?.workouts || [];
    const workout = workouts.find(item => item.id === this.selectedWorkoutId) || workouts[0] || null;
    return html`
      <section class="section">
        <h2>Train</h2>
        ${program && workout
          ? html`
              <div class="stack">
                  <wa-select
                    label="Workout"
                    .value=${workout.id}
                    @change=${event => this.selectWorkout(event.currentTarget.value)}
                  >
                    ${workouts.map(item => html`<wa-option value=${item.id}>${item.name}</wa-option>`)}
                  </wa-select>
                <div class="inline">
                  <div class="badge">${program.name}</div>
                  <div class="badge">${workout.name}</div>
                  <wa-button variant="primary" @click=${() => this.startSession(program.id, workout.id)}
                    >${this.draftSession ? 'Restart Session' : 'Start Session'}</wa-button
                  >
                </div>
                ${this.draftSession
                  ? html`
                      <div class="stack">
                        ${this.draftSession.entries.map(entry =>
                          html`
                            <div class="exercise-card">
                              <h3>${entry.name}</h3>
                              ${entry.sets.map(
                                (set, index) => html`
                                  <div class="set-row">
                                    <wa-input
                                      type="number"
                                      label="Reps"
                                      .value=${set.reps}
                                      placeholder=${set.targetReps}
                                      @input=${event => {
                                        const nextValue = this.resolveSpinnerValue(
                                          set,
                                          'reps',
                                          event.target.value,
                                          event.inputType
                                        );
                                        event.target.value = nextValue;
                                        this.updateDraftSet(entry.exerciseId, index, 'reps', nextValue);
                                      }}
                                    ></wa-input>
                                    <wa-input
                                      type="number"
                                      label="Weight"
                                      .value=${set.weight}
                                      placeholder=${set.targetWeight}
                                      @input=${event => {
                                        const nextValue = this.resolveSpinnerValue(
                                          set,
                                          'weight',
                                          event.target.value,
                                          event.inputType
                                        );
                                        event.target.value = nextValue;
                                        this.updateDraftSet(entry.exerciseId, index, 'weight', nextValue);
                                      }}
                                    ></wa-input>
                                    <wa-button
                                      variant="primary"
                                      ?disabled=${set.logged}
                                      @click=${() => this.logDraftSet(entry.exerciseId, index)}
                                    >${set.logged ? 'Logged' : 'Log'}</wa-button>
                                    <wa-button
                                      variant="danger"
                                      ?disabled=${entry.sets.length === 1}
                                      @click=${() => this.removeDraftSet(entry.exerciseId, index)}
                                    >-</wa-button>
                                  </div>
                                `
                              )}
                              <div class="inline">
                                <wa-button @click=${() => this.addDraftSet(entry.exerciseId)}>Add set</wa-button>
                              </div>
                            </div>
                          `
                        )}
                        <wa-textarea
                          label="Session notes"
                          placeholder="How did it feel?"
                          .value=${this.draftSession.notes}
                          @input=${event => this.updateDraftNotes(event.target.value)}
                        ></wa-textarea>
                        <div class="inline">
                          <wa-button variant="primary" @click=${() => this.saveSession()}>Save session</wa-button>
                          <wa-button variant="danger" @click=${() => {
                            this.draftSession = null;
                            this.persist();
                          }}>Discard</wa-button>
                        </div>
                      </div>
                    `
                  : html`<div class="muted">Start a session to log sets and weights.</div>`}
              </div>
            `
          : html`<div class="muted">Create a program and workout first to start training.</div>`}
      </section>
    `;
  }

  renderProgress() {
    const sessions = this.sessions.slice(0, 10);
    const exerciseNames = Array.from(
      new Set(this.sessions.flatMap(session => session.entries.map(entry => entry.name)))
    ).sort();

    return html`
      <section class="section">
        <h2>Progress</h2>
        ${sessions.length === 0
          ? html`<div class="muted">Log a session to see progress history.</div>`
          : html`
              <div class="stack">
                <div class="list">
                  ${sessions.map(session => {
                    const program = this.programs.find(item => item.id === session.programId);
                    const totalSets = session.entries.reduce((sum, entry) => sum + entry.sets.length, 0);
                    return html`
                      <div class="list-item">
                        <div>
                          <strong>${program?.name || 'Program'} · ${session.workoutName || 'Workout'}</strong>
                          <div class="muted">${formatDate(session.date)} · ${totalSets} sets logged</div>
                        </div>
                        <div class="badge">${session.entries.length} exercises</div>
                      </div>
                    `;
                  })}
                </div>

                <div class="section" style="margin: 0">
                  <h2>Exercise Trends</h2>
                  <wa-select
                    label="Pick an exercise"
                    .value=${this.selectedExercise}
                    @change=${event => {
                      this.selectedExercise = event.currentTarget.value;
                      this.requestUpdate();
                    }}
                  >
                    <wa-option value="">Select...</wa-option>
                    ${exerciseNames.map(name => html`<wa-option value=${name}>${name}</wa-option>`)}
                  </wa-select>

                  ${this.selectedExercise
                    ? html`
                        <div class="list" style="margin-top: 12px">
                          ${this.sessions
                            .filter(session =>
                              session.entries.some(entry => entry.name === this.selectedExercise)
                            )
                            .slice(0, 6)
                            .map(session => {
                              const entry = session.entries.find(
                                item => item.name === this.selectedExercise
                              );
                              const best = entry.sets.reduce(
                                (max, set) =>
                                  Math.max(max, (Number(set.weight) || 0) * (Number(set.reps) || 0)),
                                0
                              );
                              return html`
                                <div class="list-item">
                                  <div>
                                    <strong>${formatDate(session.date)}</strong>
                                    <div class="muted">
                                      Sets: ${entry.sets
                                        .map(set => `${formatNumber(set.reps)}x${formatNumber(set.weight)}`)
                                        .join(', ')}
                                    </div>
                                  </div>
                                  <div class="badge">${best} volume</div>
                                </div>
                              `;
                            })}
                        </div>
                      `
                    : html`<div class="muted">Choose an exercise to see recent sets.</div>`}
                </div>
              </div>
            `}
      </section>
    `;
  }

  render() {
    return html`
      <main>
        <header>
          <div>
            <h1>Training App</h1>
            <p>Build programs, log sets, and carry your last performance into every session.</p>
          </div>
          <div class="badge">PWA-ready</div>
        </header>

        <wa-tab-group>
          <wa-tab slot="nav" panel="programs">Programs</wa-tab>
          <wa-tab slot="nav" panel="train">Train</wa-tab>
          <wa-tab slot="nav" panel="progress">Progress</wa-tab>

          <wa-tab-panel name="programs">${this.renderPrograms()}</wa-tab-panel>
          <wa-tab-panel name="train">${this.renderTraining()}</wa-tab-panel>
          <wa-tab-panel name="progress">${this.renderProgress()}</wa-tab-panel>
        </wa-tab-group>

        <footer>
          <div>Exercise data: public open-source API. Cache refreshes weekly for offline support.</div>
        </footer>
      </main>
    `;
  }
}

customElements.define('training-app', TrainingApp);
