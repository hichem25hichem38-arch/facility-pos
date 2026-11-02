/*
 * Zustand's persist middleware reads `localStorage` when the store module is first
 * evaluated, and silently disables itself if it is missing. Test files that import
 * the app store must therefore side-effect-import this module before any store.
 */
const values = new Map<string, string>();

const memoryStorage: Storage = {
  getItem: (key) => (values.has(key) ? values.get(key)! : null),
  setItem: (key, value) => void values.set(key, String(value)),
  removeItem: (key) => void values.delete(key),
  clear: () => values.clear(),
  key: (index) => [...values.keys()][index] ?? null,
  get length() {
    return values.size;
  },
};

globalThis.localStorage = memoryStorage;

export {};
