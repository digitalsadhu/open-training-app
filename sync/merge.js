import { SYNC_SCHEMA_VERSION, SYNC_TYPES } from './model.js';

const toNumber = value => Number(value) || 0;

const pickByTimestamp = (localRecord, remoteRecord) => {
  const localUpdated = toNumber(localRecord?.updatedAt);
  const remoteUpdated = toNumber(remoteRecord?.updatedAt);

  if (!localRecord) return remoteRecord;
  if (!remoteRecord) return localRecord;

  const localDeleted = toNumber(localRecord.deletedAt);
  const remoteDeleted = toNumber(remoteRecord.deletedAt);

  if (localDeleted || remoteDeleted) {
    if (localDeleted && remoteDeleted) {
      if (remoteUpdated > localUpdated) return remoteRecord;
      return localRecord;
    }

    if (localDeleted && localUpdated >= remoteUpdated) return localRecord;
    if (remoteDeleted && remoteUpdated >= localUpdated) return remoteRecord;
  }

  if (remoteUpdated > localUpdated) return remoteRecord;
  return localRecord;
};

const mergeRecordType = (local, remote) => {
  const merged = {};
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  keys.forEach(key => {
    merged[key] = pickByTimestamp(local?.[key], remote?.[key]);
  });
  return merged;
};

export const mergeSyncDocs = (localDoc, remoteDoc, now = Date.now()) => {
  const mergedRecords = {};
  Object.values(SYNC_TYPES).forEach(type => {
    mergedRecords[type] = mergeRecordType(localDoc.records?.[type], remoteDoc.records?.[type]);
  });

  return {
    version: SYNC_SCHEMA_VERSION,
    updatedAt: now,
    sourceDeviceId: localDoc.sourceDeviceId || remoteDoc.sourceDeviceId || '',
    records: mergedRecords
  };
};
