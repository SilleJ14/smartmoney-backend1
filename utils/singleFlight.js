// Share one expensive refresh, including failures; allow a later retry.
export function createSingleFlight() {
  let pending = null;
  return function run(work) {
    if (!pending) pending = Promise.resolve().then(work).finally(() => { pending = null; });
    return pending;
  };
}
