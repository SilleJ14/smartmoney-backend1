// Aliases represent the same quantity. Conflicts are missing evidence, not
// permission to pick whichever value produces a stronger signal.
export function normalizeCryptoVolume(bar) {
  if (!bar || typeof bar !== 'object' || Array.isArray(bar)) return null;
  const read = keys => {
    const values = keys.filter(key => bar[key] != null && bar[key] !== '').map(key => Number(bar[key]));
    if (!values.length) return undefined;
    if (values.some(value => !Number.isFinite(value) || value < 0 || value !== values[0])) return null;
    return values[0];
  };
  const volume = read(['v', 'volume', 'volume_crypto', 'baseVolume']);
  const quoteVolume = read(['volume_usd', 'quoteVolume', 'dollarVolume']);
  if (volume == null || quoteVolume === null) return null;
  return { volume, quoteVolume };
}
