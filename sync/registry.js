export class SyncRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    if (!adapter?.id) throw new Error('Adapter must define an id');
    this.adapters.set(adapter.id, adapter);
  }

  get(adapterId) {
    return this.adapters.get(adapterId);
  }

  list() {
    return Array.from(this.adapters.values());
  }
}
