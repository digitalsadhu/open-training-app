import { LitElement, html, css } from 'https://cdn.jsdelivr.net/npm/lit@3.2.0/+esm';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/button/button.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/callout/callout.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/input/input.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/select/select.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/option/option.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/textarea/textarea.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/tab-group/tab-group.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/tab/tab.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/tab-panel/tab-panel.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/dialog/dialog.js';
import 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.2.1/dist-cdn/components/icon/icon.js';
import { fetchExercises, getEnglishLanguageId, MUSCLE_GROUPS, UNCATEGORIZED_GROUP } from './data.js';
import {
  SyncRegistry,
  alignSelections,
  cloneState,
  createDefaultSyncState,
  createGoogleSheetsAdapter,
  finalizeLocalStateForSync,
  migrateStateForSync,
  runSyncForTargets
} from './sync/index.js';
import {
  addDraftSetState,
  addExerciseToWorkoutState,
  addWorkoutToProgramState,
  computeProgressionForEntry,
  createProgramState,
  lastEntryForExercise,
  logDraftSetState,
  moveExerciseInWorkoutState,
  removeDraftSetState,
  removeExerciseFromWorkoutState,
  removeWorkoutFromProgramState,
  startSessionState,
  updateDraftSetState,
  updateWorkoutDefaultsState
} from './state.js';

const STORAGE_KEY = 'training-app:v1';
const EXERCISE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_SYNC_SHEET_TAB = '__training_sync';
const DEFAULT_SYNC_DOC_ID = 'default';
const ALL_GROUPS_FILTER = '__all__';

const resolveGoogleClientId = () => {
  const fromGlobal = String(globalThis.__TRAINING_APP_GOOGLE_CLIENT_ID || '').trim();
  if (fromGlobal) return fromGlobal;
  const fromMeta = String(
    globalThis.document?.querySelector?.('meta[name="training-app-google-client-id"]')?.content || ''
  ).trim();
  return fromMeta;
};
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

const normalizeExerciseLibraryItem = item => ({
  ...item,
  muscleGroups: normalizeMuscleGroups(item?.muscleGroups),
  sourceMuscles: {
    primary: Array.from(new Set((item?.sourceMuscles?.primary || []).map(value => String(value || '').trim()).filter(Boolean))),
    secondary: Array.from(new Set((item?.sourceMuscles?.secondary || []).map(value => String(value || '').trim()).filter(Boolean)))
  }
});

const defaultState = {
  programs: [],
  sessions: [],
  selectedProgramId: '',
  selectedWorkoutId: '',
  trainingPriority: 'hypertrophy',
  draftSession: null,
  sync: createDefaultSyncState(),
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
          name: workout.name || 'Workout',
          exercises: (workout.exercises || []).map(exercise => ({
            ...exercise,
            trainingPriority: exercise.trainingPriority || null,
            muscleGroups: normalizeMuscleGroups(exercise.muscleGroups)
          }))
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
          exercises: migratedExercises.map(exercise => ({
            ...exercise,
            trainingPriority: exercise.trainingPriority || null,
            muscleGroups: normalizeMuscleGroups(exercise.muscleGroups)
          }))
        }
      ]
    };
  });

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateStateForSync({ ...defaultState });
    const parsed = JSON.parse(raw);
    const merged = {
      ...defaultState,
      ...parsed,
      programs: normalizePrograms(parsed.programs || []),
      sync: {
        ...createDefaultSyncState(),
        ...(parsed.sync || {})
      },
      exerciseCache: {
        ...defaultState.exerciseCache,
        ...(parsed.exerciseCache || {}),
        exercises: (parsed.exerciseCache?.exercises || []).map(normalizeExerciseLibraryItem)
      }
    };
    return migrateStateForSync(merged);
  } catch (error) {
    console.warn('Failed to load state', error);
    return migrateStateForSync({ ...defaultState });
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

const normalizeSearchText = value =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const singularize = word => {
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
  return word;
};

const getWordVariants = word => {
  const variants = new Set([word]);
  variants.add(singularize(word));
  if (word.endsWith('es') && word.length > 3) {
    variants.add(word.slice(0, -2));
    variants.add(word.slice(0, -1));
  }
  return variants;
};

const scoreExerciseMatch = (name, rawQuery) => {
  const query = normalizeSearchText(rawQuery);
  if (!query) return 0;

  const normalizedName = normalizeSearchText(name);
  const nameWords = normalizedName.split(' ').filter(Boolean);
  const queryWords = query.split(' ').filter(Boolean);
  const queryVariants = queryWords.flatMap(word => Array.from(getWordVariants(word)));

  let score = 0;

  if (normalizedName === query) score += 500;
  if (normalizedName.startsWith(query)) score += 300;
  if (normalizedName.includes(query)) score += 200;

  queryVariants.forEach(variant => {
    nameWords.forEach(word => {
      if (word === variant) score += 220;
      if (word.startsWith(variant)) score += 170;
      if (word.includes(variant)) score += 90;
    });
  });

  const allTermsPresent = queryVariants.every(variant =>
    nameWords.some(word => word.includes(variant) || variant.includes(word))
  );
  if (allTermsPresent) score += 120;

  return score;
};
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
    exerciseGroupFilter: { state: true },
    loadingExercises: { state: true },
    selectedExercise: { state: true },
    trainingPriority: { state: true },
    exerciseCacheUpdatedAt: { state: true },
    exerciseLoadError: { state: true },
    exerciseFetchStatus: { state: true },
    historyExerciseId: { state: true },
    historyExerciseName: { state: true },
    saveValidationError: { state: true },
    activeTab: { state: true },
    clearDataDialogOpen: { state: true },
    syncState: { state: true },
    syncProviderId: { state: true },
    syncNameInput: { state: true },
    syncFeedback: { state: true },
    googleConnectDialogOpen: { state: true },
    googleSpreadsheetOptions: { state: true },
    googleSpreadsheetChoice: { state: true },
    googleSpreadsheetsLoading: { state: true }
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
    this.syncRegistry = new SyncRegistry();
    this.syncRegistry.register(createGoogleSheetsAdapter());
    this.autoSyncTimer = 0;
    this.lastPersistedState = cloneState(saved);
    this.programs = saved.programs;
    this.sessions = saved.sessions;
    this.selectedProgramId = saved.selectedProgramId || this.programs[0]?.id || '';
    const initialProgram = this.programs.find(item => item.id === this.selectedProgramId);
    this.selectedWorkoutId =
      saved.selectedWorkoutId || initialProgram?.workouts?.[0]?.id || '';
    this.trainingPriority = saved.trainingPriority || 'hypertrophy';
    this.draftSession = saved.draftSession;
    this.exercises = saved.exerciseCache.exercises || [];
    this.exerciseSearch = '';
    this.exerciseGroupFilter = ALL_GROUPS_FILTER;
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
    this.syncState = saved.sync;
    this.syncProviderId = 'google-sheets';
    const knownGoogleTarget = (saved.sync?.targets || []).find(
      target => target.adapterId === 'google-sheets' && target.config?.clientId
    );
    this.googleClientId = resolveGoogleClientId() || String(knownGoogleTarget?.config?.clientId || '');
    this.syncNameInput = 'Google Sheets';
    this.syncFeedback = '';
    this.googleConnectDialogOpen = false;
    this.googleSpreadsheetOptions = [];
    this.googleSpreadsheetChoice = '';
    this.googleSpreadsheetsLoading = false;
    this.historyExerciseId = '';
    this.historyExerciseName = '';
    this.saveValidationError = '';
    this.activeTab = this.programs.length > 0 ? 'train' : 'programs';
    this.clearDataDialogOpen = false;
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
    this.releaseAppCloakWhenReady();
  }

  async releaseAppCloakWhenReady() {
    const remove = () => document.documentElement.classList.remove('app-cloak');
    const nextPaint = () =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const waits = [
      customElements.whenDefined('wa-input'),
      customElements.whenDefined('wa-button'),
      customElements.whenDefined('wa-select'),
      customElements.whenDefined('wa-tab-group'),
      customElements.whenDefined('wa-tab'),
      customElements.whenDefined('wa-tab-panel'),
      nextPaint()
    ];

    if (document.fonts?.ready) {
      waits.push(document.fonts.ready.catch(() => {}));
    }

    try {
      await Promise.race([
        Promise.all(waits),
        new Promise(resolve => setTimeout(resolve, 3500))
      ]);
    } finally {
      remove();
    }
  }

  buildStateSnapshot() {
    return {
      programs: this.programs,
      sessions: this.sessions,
      selectedProgramId: this.selectedProgramId,
      selectedWorkoutId: this.selectedWorkoutId,
      trainingPriority: this.trainingPriority,
      draftSession: this.draftSession,
      sync: this.syncState,
      exerciseCache: {
        updatedAt: this.exerciseCacheUpdatedAt,
        exercises: this.exercises
      }
    };
  }

  applyStateSnapshot(state) {
    const aligned = alignSelections(migrateStateForSync(state));
    this.programs = aligned.programs;
    this.sessions = aligned.sessions;
    this.selectedProgramId = aligned.selectedProgramId;
    this.selectedWorkoutId = aligned.selectedWorkoutId;
    this.trainingPriority = aligned.trainingPriority || 'hypertrophy';
    this.draftSession = aligned.draftSession;
    this.syncState = aligned.sync;
    this.exercises = (aligned.exerciseCache?.exercises || []).map(normalizeExerciseLibraryItem);
    this.exerciseCacheUpdatedAt = aligned.exerciseCache?.updatedAt || 0;
  }

  persist({ triggerSync = true } = {}) {
    const snapshot = this.buildStateSnapshot();
    const previous = this.lastPersistedState || migrateStateForSync({ ...defaultState });
    const finalized = alignSelections(finalizeLocalStateForSync(snapshot, previous, Date.now()));
    this.applyStateSnapshot(finalized);
    saveState(finalized);
    this.lastPersistedState = cloneState(finalized);
    if (triggerSync && this.syncState?.autoSyncEnabled) {
      this.scheduleAutoSync();
    }
  }

  updateExerciseCache(timestamp, exercises) {
    this.exerciseCacheUpdatedAt = timestamp;
    this.exercises = (exercises || []).map(normalizeExerciseLibraryItem);
    this.persist({ triggerSync: false });
  }

  async loadExerciseLibrary(force = false) {
    console.info('[training-app] loadExerciseLibrary', { force });
    const cached = loadState().exerciseCache;
    if (!force && cached.exercises.length > 0 && Date.now() - cached.updatedAt < EXERCISE_CACHE_MAX_AGE_MS) {
      this.exercises = cached.exercises.map(normalizeExerciseLibraryItem);
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

  scheduleAutoSync() {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }
    if (this.syncState?.isSyncing) return;
    this.autoSyncTimer = window.setTimeout(() => {
      this.autoSyncTimer = 0;
      this.syncNow();
    }, 5000);
  }

  async syncNow(targetIds = []) {
    if (this.syncState?.isSyncing) return;
    this.syncState = { ...this.syncState, isSyncing: true };
    this.persist({ triggerSync: false });

    const run = await runSyncForTargets({
      state: this.buildStateSnapshot(),
      registry: this.syncRegistry,
      targetIds,
      now: Date.now()
    });

    this.applyStateSnapshot(run.state);
    saveState(run.state);
    this.lastPersistedState = cloneState(run.state);

    const failures = run.results.filter(result => !result.ok);
    if (failures.length === 0) {
      this.syncFeedback = `Synced ${run.results.length} target${run.results.length === 1 ? '' : 's'}.`;
    } else {
      this.syncFeedback = failures.map(item => item.error).join(' | ');
    }
  }

  async addSyncTarget() {
    if (this.syncProviderId === 'google-sheets') {
      await this.openGoogleConnectDialog();
      return;
    }

    const adapter = this.syncRegistry.get(this.syncProviderId);
    if (!adapter) {
      this.syncFeedback = `Missing adapter: ${this.syncProviderId}`;
      return;
    }

    const name = this.syncNameInput.trim() || 'Sync target';
    const baseConfig = {};

    try {
      const config = adapter.validateConfig(baseConfig);
      const connectedConfig = await adapter.connect(config);
      const target = {
        id: createId(),
        adapterId: adapter.id,
        name,
        status: 'idle',
        config: connectedConfig,
        lastSyncedAt: 0,
        lastError: '',
        lastRevision: 0,
        connected: true
      };
      this.syncState = {
        ...this.syncState,
        targets: [...(this.syncState.targets || []), target]
      };
      this.syncFeedback = `${name} connected.`;
      this.persist({ triggerSync: false });
    } catch (error) {
      this.syncFeedback = error?.message || String(error);
    }
  }

  async createAndConnectGoogleSheet() {
    const adapter = this.syncRegistry.get(this.syncProviderId);
    if (!adapter || adapter.id !== 'google-sheets') {
      this.syncFeedback = 'Create sheet is only supported for Google Sheets targets.';
      return;
    }

    if (!this.googleClientId) {
      this.syncFeedback = 'Google sync is not configured. Set window.__TRAINING_APP_GOOGLE_CLIENT_ID.';
      return;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const baseConfig = {
      clientId: this.googleClientId,
      spreadsheetTitle: `Open Training App Data (${stamp})`,
      sheetName: DEFAULT_SYNC_SHEET_TAB,
      docId: DEFAULT_SYNC_DOC_ID
    };

    try {
      const createdConfig = await adapter.createTargetConfig(baseConfig);
      const config = adapter.validateConfig(createdConfig);
      const connectedConfig = await adapter.connect(config);
      const target = this.createConnectedTarget(adapter.id, this.syncNameInput.trim() || 'Google Sheets', connectedConfig);
      this.syncFeedback = `${target.name} connected with a newly created sheet.`;
      this.persist({ triggerSync: false });
      this.closeGoogleConnectDialog();
    } catch (error) {
      this.syncFeedback = error?.message || String(error);
    }
  }

  createConnectedTarget(adapterId, name, config) {
    const target = {
      id: createId(),
      adapterId,
      name: name || 'Sync target',
      status: 'idle',
      config,
      lastSyncedAt: 0,
      lastError: '',
      lastRevision: 0,
      connected: true
    };
    this.syncState = {
      ...this.syncState,
      targets: [...(this.syncState.targets || []), target]
    };
    return target;
  }

  async connectExistingGoogleSheetAndRestore(spreadsheetId) {
    const adapter = this.syncRegistry.get(this.syncProviderId);
    if (!adapter || adapter.id !== 'google-sheets') {
      this.syncFeedback = 'Restore from sheet is only supported for Google Sheets targets.';
      return;
    }
    if (!this.googleClientId) {
      this.syncFeedback = 'Google sync is not configured. Set window.__TRAINING_APP_GOOGLE_CLIENT_ID.';
      return;
    }

    const safeSpreadsheetId = String(spreadsheetId || '').trim();
    if (!safeSpreadsheetId) {
      this.syncFeedback = 'Please choose a spreadsheet to restore from.';
      return;
    }

    try {
      const config = adapter.validateConfig({
        clientId: this.googleClientId,
        spreadsheetId: safeSpreadsheetId,
        sheetName: DEFAULT_SYNC_SHEET_TAB,
        docId: DEFAULT_SYNC_DOC_ID
      });
      await adapter.assertBackupExists(config);
      const connectedConfig = await adapter.connect(config);
      const target = this.createConnectedTarget(
        adapter.id,
        this.syncNameInput.trim() || 'Google Sheets (Restore)',
        connectedConfig
      );
      this.persist({ triggerSync: false });
      await this.syncNow([target.id]);
      this.syncFeedback = `Restored data from spreadsheet ${safeSpreadsheetId}.`;
      this.closeGoogleConnectDialog();
    } catch (error) {
      this.syncFeedback = error?.message || String(error);
    }
  }

  async openGoogleConnectDialog() {
    if (!this.googleClientId) {
      this.syncFeedback = 'Google sync is not configured. Set window.__TRAINING_APP_GOOGLE_CLIENT_ID.';
      return;
    }
    this.googleConnectDialogOpen = true;
    await this.loadGoogleSpreadsheetOptions();
  }

  closeGoogleConnectDialog() {
    this.googleConnectDialogOpen = false;
  }

  async loadGoogleSpreadsheetOptions() {
    const adapter = this.syncRegistry.get(this.syncProviderId);
    if (!adapter || adapter.id !== 'google-sheets') return;
    this.googleSpreadsheetsLoading = true;
    try {
      const sheets = await adapter.listSpreadsheets({ clientId: this.googleClientId }, 30);
      this.googleSpreadsheetOptions = sheets;
      this.googleSpreadsheetChoice = sheets[0]?.id || '';
    } catch (error) {
      this.syncFeedback = error?.message || String(error);
    } finally {
      this.googleSpreadsheetsLoading = false;
    }
  }

  async disconnectSyncTarget(targetId) {
    const target = (this.syncState.targets || []).find(item => item.id === targetId);
    if (!target) return;
    const adapter = this.syncRegistry.get(target.adapterId);
    if (adapter?.disconnect) {
      try {
        await adapter.disconnect(target.id);
      } catch (error) {
        this.syncFeedback = error?.message || String(error);
      }
    }

    this.syncState = {
      ...this.syncState,
      targets: (this.syncState.targets || []).map(item =>
        item.id === targetId ? { ...item, connected: false, status: 'idle' } : item
      )
    };
    this.persist({ triggerSync: false });
  }

  removeSyncTarget(targetId) {
    this.syncState = {
      ...this.syncState,
      targets: (this.syncState.targets || []).filter(item => item.id !== targetId)
    };
    this.persist({ triggerSync: false });
  }

  setSyncAutoEnabled(value) {
    this.syncState = { ...this.syncState, autoSyncEnabled: value };
    this.persist({ triggerSync: false });
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

  moveExerciseInWorkout(programId, workoutId, exerciseId, direction) {
    this.programs = moveExerciseInWorkoutState(this.programs, programId, workoutId, exerciseId, direction);
    this.persist();
  }

  updateWorkoutDefaults(programId, workoutId, exerciseId, field, value) {
    this.programs = updateWorkoutDefaultsState(this.programs, programId, workoutId, exerciseId, field, value);
    this.persist();
  }

  openClearDataDialog() {
    this.clearDataDialogOpen = true;
  }

  closeClearDataDialog() {
    this.clearDataDialogOpen = false;
    const dialog = this.renderRoot.querySelector('#clear-data-dialog');
    if (!dialog || !dialog.open) return;
    if (typeof dialog.hide === 'function') {
      dialog.hide();
    }
    dialog.open = false;
    dialog.removeAttribute('open');
  }

  async clearAllData() {
    const dialog = this.renderRoot.querySelector('#clear-data-dialog');
    if (dialog?.open && typeof dialog.hide === 'function') {
      await new Promise(resolve => {
        let resolved = false;
        const finalize = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        dialog.addEventListener('wa-after-hide', finalize, { once: true });
        dialog.hide();
        setTimeout(finalize, 500);
      });
    }
    this.clearDataDialogOpen = false;
    localStorage.removeItem(STORAGE_KEY);
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = 0;
    }
    try {
      globalThis.location?.reload();
      return;
    } catch {
      // Fall back to in-memory reset if reload is unavailable.
    }
    const reset = migrateStateForSync(cloneState(defaultState));
    this.lastPersistedState = cloneState(reset);
    this.applyStateSnapshot(reset);
    this.selectedExercise = '';
    this.exerciseSearch = '';
    this.exerciseGroupFilter = ALL_GROUPS_FILTER;
    this.syncFeedback = '';
    this.historyExerciseId = '';
    this.historyExerciseName = '';
    this.saveValidationError = '';
    this.activeTab = 'programs';
  }

  startSession(programId, workoutId) {
    const program = this.programs.find(item => item.id === programId);
    const nextDraft = startSessionState(
      program,
      workoutId,
      this.sessions,
      createId,
      todayISO(),
      this.trainingPriority
    );
    this.draftSession = nextDraft
      ? {
          ...nextDraft,
          entries: nextDraft.entries.map(entry => ({
            ...entry,
            skipped: Boolean(entry.skipped)
          }))
        }
      : null;
    this.saveValidationError = '';
    this.persist();
  }

  updateDraftSet(exerciseId, setIndex, field, value) {
    this.draftSession = updateDraftSetState(this.draftSession, exerciseId, setIndex, field, value);
    this.saveValidationError = '';
    this.persist();
  }

  addDraftSet(exerciseId) {
    this.draftSession = addDraftSetState(this.draftSession, exerciseId);
    this.saveValidationError = '';
    this.persist();
  }

  removeDraftSet(exerciseId, setIndex) {
    this.draftSession = removeDraftSetState(this.draftSession, exerciseId, setIndex);
    this.saveValidationError = '';
    this.persist();
  }

  logDraftSet(exerciseId, setIndex) {
    this.draftSession = logDraftSetState(this.draftSession, exerciseId, setIndex);
    this.saveValidationError = '';
    this.persist();
  }

  toggleSkipDraftExercise(exerciseId) {
    if (!this.draftSession) return;
    this.draftSession = {
      ...this.draftSession,
      entries: this.draftSession.entries.map(entry =>
        entry.exerciseId === exerciseId ? { ...entry, skipped: !entry.skipped } : entry
      )
    };
    this.saveValidationError = '';
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
    const hasExerciseWithoutLoggedSet = this.draftSession.entries.some(entry => {
      if (entry.skipped) return false;
      return !entry.sets.some(set => set.logged);
    });
    if (hasExerciseWithoutLoggedSet) {
      this.saveValidationError = 'Please log at least one set for each exercise (or skip it) before saving.';
      return;
    }

    const program = this.programs.find(item => item.id === this.draftSession.programId);
    const workout = program?.workouts?.find(item => item.id === this.draftSession.workoutId);

    const finalizedEntries = this.draftSession.entries
      .filter(entry => !entry.skipped)
      .map(entry => {
        const loggedSets = entry.sets
          .filter(set => set.logged)
          .map(set => ({ reps: set.reps, weight: set.weight }));
        const exercise = workout?.exercises?.find(item => item.id === entry.exerciseId) || {
          id: entry.exerciseId,
          defaultSets: loggedSets.length || 1
        };
        const previous = lastEntryForExercise(this.sessions, entry.exerciseId, this.draftSession.workoutId);
        const progression = computeProgressionForEntry({
          draftEntry: entry,
          loggedSets,
          exercise,
          previousEntry: previous,
          trainingPriority: this.trainingPriority
        });

        return {
          ...entry,
          sets: loggedSets,
          progression: {
            decision: progression.decision,
            sessionSuccess: progression.sessionSuccess,
            topReached: progression.topReached,
            successfulSets: progression.successfulSets,
            requiredSets: progression.requiredSets,
            failStreakAfter: progression.failStreakAfter,
            nextTargetReps: progression.nextTargetReps,
            nextTargetWeight: progression.nextTargetWeight,
            repRangeMin: progression.config.repRangeMin,
            repRangeMax: progression.config.repRangeMax,
            weightStepKg: progression.config.weightStepKg
          }
        };
      });
    this.sessions = [
      { ...this.draftSession, entries: finalizedEntries, savedAt: Date.now() },
      ...this.sessions
    ];
    this.saveValidationError = '';
    this.draftSession = null;
    this.persist();
  }

  setTrainingPriority(value) {
    this.trainingPriority = value === 'strength' ? 'strength' : 'hypertrophy';
    this.persist({ triggerSync: false });
  }

  lastEntryForExercise(exerciseId) {
    return lastEntryForExercise(this.sessions, exerciseId);
  }

  updateDraftNotes(value) {
    this.draftSession = { ...this.draftSession, notes: value };
    this.persist();
  }

  getExerciseHistory(exerciseId) {
    return this.sessions
      .map(session => {
        const entry = session.entries?.find(item => item.exerciseId === exerciseId);
        if (!entry || !Array.isArray(entry.sets) || entry.sets.length === 0) return null;
        return {
          sessionId: session.id,
          date: session.date,
          savedAt: session.savedAt || 0,
          workoutName: session.workoutName || 'Workout',
          sets: entry.sets
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  openExerciseHistory(exerciseId, exerciseName) {
    this.historyExerciseId = exerciseId;
    this.historyExerciseName = exerciseName;
    const dialog = this.renderRoot.querySelector('#exercise-history-dialog');
    dialog?.show();
  }

  closeExerciseHistory() {
    const dialog = this.renderRoot.querySelector('#exercise-history-dialog');
    if (!dialog) return;
    if (typeof dialog.hide === 'function') {
      dialog.hide();
    }
    dialog.open = false;
    dialog.removeAttribute('open');
  }

  updateProgramNotes(programId, value) {
    this.programs = this.programs.map(program =>
      program.id === programId ? { ...program, notes: value } : program
    );
    this.persist();
  }

  setExerciseGroupFilter(group) {
    const next = String(group || '').trim();
    this.exerciseGroupFilter = next || ALL_GROUPS_FILTER;
  }

  renderMuscleGroupChips(groups, { clickable = false, selected = '' } = {}) {
    const normalized = normalizeMuscleGroups(groups);
    return html`
      <div class="chip-row">
        ${normalized.map(group =>
          clickable
            ? html`
                <button
                  class="muscle-chip ${selected === group ? 'is-selected' : ''}"
                  @click=${() => this.setExerciseGroupFilter(selected === group ? ALL_GROUPS_FILTER : group)}
                >${group}</button>
              `
            : html`<span class="muscle-chip">${group}</span>`
        )}
      </div>
    `;
  }

  selectExerciseFromSearch(programId, workoutId, exercise) {
    this.addExerciseToWorkout(programId, workoutId, {
      ...exercise,
      trainingPriority: this.trainingPriority,
      muscleGroups: normalizeMuscleGroups(exercise.muscleGroups)
    });
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
    const search = this.exerciseSearch.trim();
    const lastTrainedByExerciseId = new Map();

    this.sessions.forEach(session => {
      const sessionTime = session.savedAt || Date.parse(session.date) || 0;
      (session.entries || []).forEach(entry => {
        const key = String(entry.exerciseId || '');
        if (!key) return;
        const existing = lastTrainedByExerciseId.get(key) || 0;
        if (sessionTime > existing) {
          lastTrainedByExerciseId.set(key, sessionTime);
        }
      });
    });

    const filteredExercises = this.exercises
      .map(item => ({ ...item, name: item.name || item.exercise?.name || item.translations?.[0]?.name || '' }))
      .filter(item => item.name)
      .map(item => ({ ...item, score: scoreExerciseMatch(item.name, search) }))
      .filter(item => item.score > 0)
      .filter(item =>
        this.exerciseGroupFilter === ALL_GROUPS_FILTER
          ? true
          : normalizeMuscleGroups(item.muscleGroups).includes(this.exerciseGroupFilter)
      )
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map(item => ({
        ...item,
        lastTrainedAt: lastTrainedByExerciseId.get(String(item.id)) || 0
      }))
      .slice(0, 30);
    const availableExerciseGroups = MUSCLE_GROUPS.filter(group =>
      this.exercises.some(item => normalizeMuscleGroups(item.muscleGroups).includes(group))
    );

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
                          <div class="muted">${workout.exercises?.length || 0} exercises</div>
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
                      const exercise = exactMatch || { id: createId(), name: value, muscleGroups: [UNCATEGORIZED_GROUP] };
                      if (!selectedWorkout) return;
                      this.selectExerciseFromSearch(program.id, selectedWorkout.id, exercise);
                    }
                  }}
                ></wa-input>

                <div class="chip-row">
                  <button
                    class="muscle-chip ${this.exerciseGroupFilter === ALL_GROUPS_FILTER ? 'is-selected' : ''}"
                    @click=${() => this.setExerciseGroupFilter(ALL_GROUPS_FILTER)}
                  >All</button>
                  ${availableExerciseGroups.map(group => html`
                    <button
                      class="muscle-chip ${this.exerciseGroupFilter === group ? 'is-selected' : ''}"
                      @click=${() => this.setExerciseGroupFilter(group)}
                    >${group}</button>
                  `)}
                </div>

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
                                ${this.renderMuscleGroupChips(item.muscleGroups)}
                                <div class="muted">
                                  Source: ${Array.isArray(item.sources) && item.sources.length > 0
                                    ? item.sources.join(', ')
                                    : item.source || 'unknown'}
                                </div>
                                ${item.lastTrainedAt
                                  ? html`<div class="last-trained">Last trained: ${formatDate(item.lastTrainedAt)}</div>`
                                  : html``}
                              </div>
                              <wa-button
                                @click=${() =>
                                  this.selectExerciseFromSearch(program.id, selectedWorkout.id, {
                                    id: item.id,
                                    name: item.name,
                                    muscleGroups: normalizeMuscleGroups(item.muscleGroups)
                                  })}
                              >Add</wa-button>
                            </div>
                          `
                        )}
                      </div>
                    `
                  : html``}

                <div class="list">
                  ${(selectedWorkout?.exercises || []).map((item, index, exercises) =>
                    html`
                      <div class="list-item">
                        <div>
                          <strong>${item.name}</strong>
                          ${this.renderMuscleGroupChips(item.muscleGroups)}
                          <div class="muted">
                            Defaults: ${formatNumber(item.defaultSets)} sets
                          </div>
                          <div class="muted">
                            Priority: ${item.trainingPriority || `Global (${this.trainingPriority})`}
                          </div>
                        </div>
                        <div class="inline exercise-defaults-row">
                          <wa-button
                            size="small"
                            ?disabled=${index === 0}
                            @click=${() => this.moveExerciseInWorkout(program.id, selectedWorkout.id, item.id, 'up')}
                            aria-label="Move exercise up"
                          >↑</wa-button>
                          <wa-button
                            size="small"
                            ?disabled=${index === exercises.length - 1}
                            @click=${() => this.moveExerciseInWorkout(program.id, selectedWorkout.id, item.id, 'down')}
                            aria-label="Move exercise down"
                          >↓</wa-button>
                          <wa-input
                            type="number"
                            label="Sets"
                            min="1"
                            style="max-width: 84px"
                            .value=${item.defaultSets}
                            @input=${event =>
                              this.updateWorkoutDefaults(program.id, selectedWorkout.id, item.id, 'defaultSets', event.target.value)}
                          ></wa-input>
                          <wa-select
                            label="Priority"
                            style="min-width: 170px"
                            .value=${item.trainingPriority || ''}
                            @change=${event =>
                              this.updateWorkoutDefaults(
                                program.id,
                                selectedWorkout.id,
                                item.id,
                                'trainingPriority',
                                event.currentTarget.value
                              )}
                          >
                            <wa-option value="">Use global</wa-option>
                            <wa-option value="strength">Strength</wa-option>
                            <wa-option value="hypertrophy">Hypertrophy</wa-option>
                          </wa-select>
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
    const historyItems = this.historyExerciseId ? this.getExerciseHistory(this.historyExerciseId) : [];
    return html`
      <section class="section">
        <h2>Train</h2>
        ${program && workout
          ? html`
                <div class="stack">
                  <wa-select
                    label="Workout"
                    placeholder="Select workout..."
                    .value=${workout.id}
                    @change=${event => this.selectWorkout(event.currentTarget.value)}
                  >
                    <wa-option value="" disabled>Select workout...</wa-option>
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
                            <div class="exercise-card ${entry.skipped ? 'is-skipped' : ''}">
                              <div class="exercise-card-header">
                                <div>
                                  <h3>${entry.name}</h3>
                                  ${this.renderMuscleGroupChips(entry.muscleGroups)}
                                </div>
                                <div class="inline">
                                  <wa-button
                                    size="small"
                                    @click=${() => this.openExerciseHistory(entry.exerciseId, entry.name)}
                                    aria-label="Show exercise history"
                                  >
                                    <wa-icon name="clock-rotate-left" label="History"></wa-icon>
                                  </wa-button>
                                  <wa-button
                                    size="small"
                                    @click=${() => this.toggleSkipDraftExercise(entry.exerciseId)}
                                  >${entry.skipped ? 'Unskip' : 'Skip'}</wa-button>
                                </div>
                              </div>
                              ${entry.sets.map(
                                (set, index) => html`
                                  <div class="set-row">
                                    <wa-input
                                      type="number"
                                      label="Reps"
                                      .value=${set.reps}
                                      placeholder=${set.targetReps}
                                      ?disabled=${entry.skipped}
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
                                      ?disabled=${entry.skipped}
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
                                      ?disabled=${set.logged || entry.skipped}
                                      @click=${() => this.logDraftSet(entry.exerciseId, index)}
                                    >${set.logged ? 'Logged' : 'Log'}</wa-button>
                                    <wa-button
                                      variant="danger"
                                      ?disabled=${entry.sets.length === 1 || entry.skipped}
                                      @click=${() => this.removeDraftSet(entry.exerciseId, index)}
                                    >-</wa-button>
                                  </div>
                                `
                              )}
                              <div class="inline">
                                <wa-button
                                  ?disabled=${entry.skipped}
                                  @click=${() => this.addDraftSet(entry.exerciseId)}
                                >Add set</wa-button>
                              </div>
                              ${entry.skipped ? html`<div class="muted">Skipped for this session.</div>` : html``}
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
                            this.saveValidationError = '';
                            this.draftSession = null;
                            this.persist();
                          }}>Discard</wa-button>
                        </div>
                        ${this.saveValidationError
                          ? html`<wa-callout variant="warning">${this.saveValidationError}</wa-callout>`
                          : html``}
                      </div>
                    `
                  : html`<div class="muted">Start a session to log sets and weights.</div>`}
              </div>
            `
          : html`<div class="muted">Create a program and workout first to start training.</div>`}
      </section>

      <wa-dialog
        id="exercise-history-dialog"
        label=${this.historyExerciseName ? `${this.historyExerciseName} History` : 'Exercise History'}
        @wa-after-hide=${() => {
          this.historyExerciseId = '';
          this.historyExerciseName = '';
        }}
      >
        ${historyItems.length === 0
          ? html`<div class="muted">No logged sets yet for this exercise.</div>`
          : html`
              <div class="stack">
                ${historyItems.map(
                  item => html`
                    <div class="list-item history-item">
                      <div>
                        <strong>${formatDate(item.date)} · ${item.workoutName}</strong>
                        <div class="muted">
                          ${item.sets
                            .map(set => `${formatNumber(set.reps)} reps @ ${formatNumber(set.weight)} kg`)
                            .join(' · ')}
                        </div>
                      </div>
                    </div>
                  `
                )}
              </div>
            `}
        <wa-button
          slot="footer"
          variant="primary"
          @click=${() => this.closeExerciseHistory()}
        >Close</wa-button>
      </wa-dialog>
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

  renderSync() {
    const adapters = this.syncRegistry.list();
    const targets = this.syncState?.targets || [];
    const googleConfigured = Boolean(this.googleClientId);

    return html`
      <section class="section">
        <h2>Training Preferences</h2>
        <div class="stack">
          <wa-select
            label="Training priority"
            .value=${this.trainingPriority}
            @change=${event => this.setTrainingPriority(event.currentTarget.value)}
          >
            <wa-option value="strength">Strength (lower reps)</wa-option>
            <wa-option value="hypertrophy">Hypertrophy (higher reps)</wa-option>
          </wa-select>
          <div class="muted">
            Strength defaults target 3-6 reps. Hypertrophy defaults target 8-12 reps.
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Sync</h2>
        <div class="stack">
          <div class="inline">
            <label class="sync-toggle-label">
              <input
                type="checkbox"
                ?checked=${Boolean(this.syncState?.autoSyncEnabled)}
                @change=${event => this.setSyncAutoEnabled(event.target.checked)}
              />
              Auto-sync after changes
            </label>
            <wa-button
              variant="primary"
              ?disabled=${Boolean(this.syncState?.isSyncing)}
              @click=${() => this.syncNow()}
            >${this.syncState?.isSyncing ? 'Syncing...' : 'Sync all now'}</wa-button>
          </div>
          ${this.syncFeedback ? html`<wa-callout>${this.syncFeedback}</wa-callout>` : html``}
        </div>
      </section>

      <section class="section">
        <h2>Add Sync Target</h2>
        <div class="stack">
          <wa-select
            label="Provider"
            .value=${this.syncProviderId}
            @change=${event => {
              this.syncProviderId = event.currentTarget.value;
              if (this.syncProviderId === 'google-sheets') {
                this.syncNameInput = 'Google Sheets';
              }
            }}
          >
            ${adapters.map(adapter => html`<wa-option value=${adapter.id}>${adapter.id}</wa-option>`)}
          </wa-select>
          ${this.syncProviderId !== 'google-sheets'
            ? html`<wa-input
                label="Target name"
                .value=${this.syncNameInput}
                @input=${event => {
                  this.syncNameInput = event.target.value;
                }}
              ></wa-input>`
            : html``}

          ${this.syncProviderId === 'google-sheets'
            ? html`
                ${googleConfigured
                  ? html`<div class="muted">Click connect, then choose an existing sheet or create a new one.</div>`
                  : html`<wa-callout variant="warning"
                      >Google OAuth client id is missing from app config.</wa-callout
                    >`}
              `
            : html``}

          <div class="inline">
            <wa-button
              variant="primary"
              ?disabled=${this.syncProviderId === 'google-sheets' && !googleConfigured}
              @click=${() => this.addSyncTarget()}
            >${this.syncProviderId === 'google-sheets' ? 'Connect Google Sheets' : 'Connect target'}</wa-button>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Connected Targets</h2>
        ${targets.length === 0
          ? html`<div class="muted">No sync targets configured yet.</div>`
          : html`
              <div class="list">
                ${targets.map(
                  target => html`
                    <div class="list-item sync-target-item">
                      <div>
                        <strong>${target.name}</strong>
                        <div class="muted">
                          ${target.adapterId} · ${target.connected ? target.status : 'disconnected'}
                        </div>
                        <div class="muted">Last sync: ${formatTimestamp(target.lastSyncedAt)}</div>
                        ${target.lastError ? html`<div class="muted">${target.lastError}</div>` : html``}
                      </div>
                      <div class="inline">
                        <wa-button
                          ?disabled=${Boolean(this.syncState?.isSyncing) || !target.connected}
                          @click=${() => this.syncNow([target.id])}
                        >Sync now</wa-button>
                        <wa-button
                          ?disabled=${!target.connected}
                          @click=${() => this.disconnectSyncTarget(target.id)}
                        >Disconnect</wa-button>
                        <wa-button variant="danger" @click=${() => this.removeSyncTarget(target.id)}
                          >Remove</wa-button
                        >
                      </div>
                    </div>
                  `
                )}
              </div>
            `}
      </section>

      <section class="section">
        <h2>Data</h2>
        <div class="stack">
          <div class="muted">Delete all local programs, sessions, and sync configuration from this device.</div>
          <div class="inline">
            <wa-button variant="danger" @click=${() => this.openClearDataDialog()}>Clear all data</wa-button>
          </div>
        </div>
      </section>

      <wa-dialog
        label="Connect Google Sheets"
        ?open=${this.googleConnectDialogOpen}
        @wa-after-hide=${() => this.closeGoogleConnectDialog()}
      >
        <div class="stack">
          <div class="muted">Select an existing spreadsheet backup or create a new one.</div>
          <label class="native-select-label" for="google-sheet-select">Existing spreadsheet</label>
          <select
            id="google-sheet-select"
            class="native-select"
            .value=${this.googleSpreadsheetChoice}
            @change=${event => {
              this.googleSpreadsheetChoice = event.target.value;
            }}
          >
            <option value="">Select...</option>
            ${this.googleSpreadsheetOptions.map(
              item => html`<option value=${item.id}>${item.name}</option>`
            )}
          </select>
          <div class="inline">
            <wa-button
              ?disabled=${!this.googleSpreadsheetChoice || this.googleSpreadsheetsLoading}
              @click=${() => this.connectExistingGoogleSheetAndRestore(this.googleSpreadsheetChoice)}
              >Use selected spreadsheet</wa-button
            >
            <wa-button @click=${() => this.loadGoogleSpreadsheetOptions()}>Refresh list</wa-button>
          </div>
          ${this.googleSpreadsheetsLoading ? html`<div class="muted">Loading spreadsheets...</div>` : html``}
          <div class="sync-or-divider">Or</div>
          <wa-button
            variant="primary"
            ?disabled=${this.googleSpreadsheetsLoading}
            @click=${() => this.createAndConnectGoogleSheet()}
            >Create new spreadsheet</wa-button
          >
        </div>
        <wa-button slot="footer" @click=${() => this.closeGoogleConnectDialog()}>Close</wa-button>
      </wa-dialog>

      <wa-dialog
        id="clear-data-dialog"
        label="Clear all local data"
        ?open=${this.clearDataDialogOpen}
      >
        <div class="stack">
          <wa-callout variant="warning">
            This removes all local programs, sessions, and sync settings. This action cannot be undone.
          </wa-callout>
          <div class="muted">Connected cloud data is not deleted remotely.</div>
        </div>
        <wa-button slot="footer" @click=${() => this.closeClearDataDialog()}>Cancel</wa-button>
        <wa-button slot="footer" variant="danger" @click=${() => this.clearAllData()}>Clear data</wa-button>
      </wa-dialog>
    `;
  }

  render() {
    return html`
      <main>
        <header>
          <div>
            <h1>Open Training App</h1>
            <p>Build programs, log sets, and carry your last performance into every session.</p>
          </div>
          <div class="badge">PWA-ready</div>
        </header>

        <wa-tab-group
          @wa-tab-show=${event => {
            const nextTab = String(event.detail?.name || event.detail?.panel || '').trim();
            if (nextTab) this.activeTab = nextTab;
          }}
        >
          <wa-tab slot="nav" panel="programs" ?active=${this.activeTab === 'programs'}>Programs</wa-tab>
          <wa-tab slot="nav" panel="train" ?active=${this.activeTab === 'train'}>Train</wa-tab>
          <wa-tab slot="nav" panel="progress" ?active=${this.activeTab === 'progress'}>Progress</wa-tab>
          <wa-tab slot="nav" panel="settings" ?active=${this.activeTab === 'settings'}>Settings</wa-tab>

          <wa-tab-panel name="programs" ?active=${this.activeTab === 'programs'}>${this.renderPrograms()}</wa-tab-panel>
          <wa-tab-panel name="train" ?active=${this.activeTab === 'train'}>${this.renderTraining()}</wa-tab-panel>
          <wa-tab-panel name="progress" ?active=${this.activeTab === 'progress'}>${this.renderProgress()}</wa-tab-panel>
          <wa-tab-panel name="settings" ?active=${this.activeTab === 'settings'}>${this.renderSync()}</wa-tab-panel>
        </wa-tab-group>

        <footer>
          <div>Exercise data: public open-source API. Cache refreshes weekly for offline support.</div>
        </footer>
      </main>
    `;
  }
}

customElements.define('training-app', TrainingApp);
