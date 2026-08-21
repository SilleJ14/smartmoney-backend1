export function createEngineState({ defaults, persisted = {}, canonicalize, config }) {
  const state = {
    ...defaults,
    ...persisted,
    running: false,
    cachedPositions: [],
    cachedAccount: null,
    lastError: null,
  };
  canonicalize?.(state, config);
  return state;
}
