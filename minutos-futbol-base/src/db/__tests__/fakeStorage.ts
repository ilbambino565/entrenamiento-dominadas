import type { KeyValueStorage } from '../squadRepository';

/** localStorage falso: un Map con contador de escrituras y un fallo programable. */
export interface FakeStorage extends KeyValueStorage {
  data: Map<string, string>;
  writes: number;
  failNextWrite: Error | null;
}

export function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const storage: FakeStorage = {
    data: new Map(Object.entries(initial)),
    writes: 0,
    failNextWrite: null,
    getItem: (key) => storage.data.get(key) ?? null,
    setItem: (key, value) => {
      if (storage.failNextWrite) {
        const error = storage.failNextWrite;
        storage.failNextWrite = null;
        throw error;
      }
      storage.writes += 1;
      storage.data.set(key, value);
    },
  };
  return storage;
}
