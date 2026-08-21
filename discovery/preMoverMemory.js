export function prunePreMoverMemory(memory = {}, maxEntries = 500) {
  const safeLimit = Math.max(1, Math.min(2000, Number(maxEntries) || 500));
  const entries = Object.entries(memory || {});
  if (entries.length <= safeLimit) return { memory, removedCount: 0 };
  entries.sort((a, b) => {
    const aTime = Date.parse(a[1]?.lastSeenAt || "") || 0;
    const bTime = Date.parse(b[1]?.lastSeenAt || "") || 0;
    return bTime - aTime || a[0].localeCompare(b[0]);
  });
  const retained = Object.fromEntries(entries.slice(0, safeLimit));
  return { memory: retained, removedCount: entries.length - safeLimit };
}

