class MemoryStorage {
  constructor() {
    this.store = new Map();
  }

  clear() {
    this.store.clear();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  key(index) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key) {
    this.store.delete(key);
  }

  setItem(key, value) {
    this.store.set(String(key), String(value));
  }

  get length() {
    return this.store.size;
  }
}

const ensureStorage = (name) => {
  const existing = globalThis[name];
  if (existing && typeof existing.getItem === "function") return existing;

  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage,
  });

  if (globalThis.window && !globalThis.window[name]) {
    Object.defineProperty(globalThis.window, name, {
      configurable: true,
      value: storage,
    });
  }

  return storage;
};

ensureStorage("localStorage");
ensureStorage("sessionStorage");
