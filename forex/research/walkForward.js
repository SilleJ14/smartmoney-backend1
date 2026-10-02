function indexes(length, start, end) {
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
}

export function rollingWalkForwardSplits(data, {
  trainSize,
  testSize,
  step = testSize,
  purge = 0,
  embargo = 0,
  finalOosSize = testSize,
} = {}) {
  const rows = Array.isArray(data) ? data : indexes(Number(data), 0, Number(data));
  for (const [name, value] of Object.entries({ trainSize, testSize, step, purge, embargo, finalOosSize })) {
    if (!Number.isInteger(value) || value < (["purge", "embargo"].includes(name) ? 0 : 1)) {
      throw new TypeError(`${name} must be a valid integer`);
    }
  }
  if (finalOosSize >= rows.length) throw new Error("final OOS must leave development data");
  const developmentEnd = rows.length - finalOosSize;
  const splits = [];
  for (let testStart = trainSize + purge; testStart + testSize <= developmentEnd; testStart += step + embargo) {
    const nominalStart = Math.max(0, testStart - purge - trainSize);
    const trainEnd = testStart - purge;
    const train = indexes(rows.length, nominalStart, trainEnd);
    if (train.length) {
      const test = indexes(rows.length, testStart, testStart + testSize);
      splits.push(Object.freeze({
        trainIndices: train,
        testIndices: test,
        train: train.map((index) => rows[index]),
        test: test.map((index) => rows[index]),
        purgeIndices: indexes(rows.length, trainEnd, testStart),
        embargoIndices: indexes(rows.length, testStart + testSize,
          Math.min(developmentEnd, testStart + testSize + embargo)),
      }));
    }
  }
  return Object.freeze({
    splits,
    finalOosIndices: indexes(rows.length, developmentEnd, rows.length),
    finalOos: rows.slice(developmentEnd),
    untouched: true,
  });
}

export function assertNoSplitLeakage(result) {
  const finalSet = new Set(result.finalOosIndices);
  for (const split of result.splits) {
    if (split.trainIndices.some((index) => finalSet.has(index))
      || split.testIndices.some((index) => finalSet.has(index))) {
      throw new Error("Final OOS was used during development");
    }
    if (Math.max(...split.trainIndices) >= Math.min(...split.testIndices)) {
      throw new Error("Train/test temporal overlap");
    }
  }
  return true;
}
