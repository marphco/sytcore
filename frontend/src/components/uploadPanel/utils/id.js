export function makeId() {
  // ✅ best: crypto.randomUUID (quando disponibile)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // ✅ fallback: crypto.getRandomValues
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);

    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ✅ fallback finale: Math.random
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
