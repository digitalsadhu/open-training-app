export class SyncConflictError extends Error {
  constructor(message = 'Sync revision conflict') {
    super(message);
    this.name = 'SyncConflictError';
  }
}
