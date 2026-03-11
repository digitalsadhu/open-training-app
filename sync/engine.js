import { SyncConflictError } from './errors.js';
import { mergeSyncDocs } from './merge.js';
import { alignSelections, stateToSyncDoc, syncDocToState } from './model.js';

const updateTargetStatus = (state, targetId, patch) => {
  const sync = state.sync || {};
  return {
    ...state,
    sync: {
      ...sync,
      targets: (sync.targets || []).map(target =>
        target.id === targetId ? { ...target, ...patch } : target
      )
    }
  };
};

const runSingleTarget = async ({ state, target, registry, now = Date.now() }) => {
  const adapter = registry.get(target.adapterId);
  if (!adapter) {
    return {
      state: updateTargetStatus(state, target.id, {
        status: 'error',
        lastError: `Unknown adapter: ${target.adapterId}`
      }),
      result: {
        targetId: target.id,
        ok: false,
        error: `Unknown adapter: ${target.adapterId}`
      }
    };
  }

  let workingState = updateTargetStatus(state, target.id, { status: 'syncing', lastError: '' });
  const localDoc = stateToSyncDoc(workingState, workingState.sync.deviceId, now);

  const pushMerged = async (remotePull, expectedRevision) => {
    const mergedDoc = mergeSyncDocs(localDoc, remotePull.doc || localDoc, now);
    let mergedState = syncDocToState(workingState, mergedDoc);
    mergedState = alignSelections(mergedState);

    const pushResult = await adapter.push(target, mergedDoc, expectedRevision);
    mergedState = updateTargetStatus(mergedState, target.id, {
      status: 'idle',
      lastError: '',
      lastSyncedAt: now,
      lastRevision: Number(pushResult?.revision) || Number(expectedRevision) || 0
    });

    return {
      state: mergedState,
      result: {
        targetId: target.id,
        ok: true,
        revision: Number(pushResult?.revision) || Number(expectedRevision) || 0
      }
    };
  };

  try {
    const remotePull = await adapter.pull(target);
    return await pushMerged(remotePull, Number(remotePull?.revision) || Number(target.lastRevision) || 0);
  } catch (error) {
    if (error instanceof SyncConflictError) {
      try {
        const latestRemote = await adapter.pull(target);
        return await pushMerged(latestRemote, Number(latestRemote?.revision) || Number(target.lastRevision) || 0);
      } catch (retryError) {
        const failed = updateTargetStatus(workingState, target.id, {
          status: 'error',
          lastError: retryError?.message || String(retryError)
        });
        return {
          state: failed,
          result: {
            targetId: target.id,
            ok: false,
            error: retryError?.message || String(retryError)
          }
        };
      }
    }

    const failed = updateTargetStatus(workingState, target.id, {
      status: 'error',
      lastError: error?.message || String(error)
    });
    return {
      state: failed,
      result: {
        targetId: target.id,
        ok: false,
        error: error?.message || String(error)
      }
    };
  }
};

export const runSyncForTargets = async ({
  state,
  registry,
  targetIds = [],
  now = Date.now()
}) => {
  const allTargets = state.sync?.targets || [];
  const selected = targetIds.length
    ? allTargets.filter(target => targetIds.includes(target.id))
    : allTargets.filter(target => target.connected !== false);

  let workingState = {
    ...state,
    sync: {
      ...state.sync,
      isSyncing: true
    }
  };

  const results = [];
  for (const target of selected) {
    const run = await runSingleTarget({
      state: workingState,
      target,
      registry,
      now: Date.now()
    });
    workingState = run.state;
    results.push(run.result);
  }

  workingState = {
    ...workingState,
    sync: {
      ...workingState.sync,
      isSyncing: false,
      lastAutoSyncAt: now
    }
  };

  return {
    state: workingState,
    results
  };
};
