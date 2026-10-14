// Drafts and idempotency keys stay usable even when browser storage is full or disabled.
const memory = new Map<string, string>();
export const draftStorage = {
  getItem(key: string): string | null {
    if (memory.has(key)) return memory.get(key)!;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): boolean {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  removeItem(key: string) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* The in-memory copy remains authoritative for this page. */
    }
  },
};
