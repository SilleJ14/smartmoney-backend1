export function createEngineState({ defaults, persisted = {}, canonicalize, config }) {
  const state = {
    ...defaults,
    ...persisted,
    running: false,
    cachedPositions: [],
    cachedAccount: null,
    lastError: null,
    polygonEntitlementBlocked: false,
  };
  canonicalize?.(state, config);
  return state;
}
