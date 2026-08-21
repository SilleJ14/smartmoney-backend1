import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "acorn";

const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const serverAst = parse(serverSource, {
  ecmaVersion: "latest",
  sourceType: "module",
});

test("server bootstrap owns no direct HTTP route declarations", () => {
  const directRoutes = serverAst.body.filter(
    (node) =>
      node.expression?.callee?.object?.name === "app" &&
      ["get", "post", "put", "patch", "delete"].includes(
        node.expression.callee.property?.name
      )
  );
  assert.deepEqual(directRoutes, []);
});

test("major domain implementations stay outside server bootstrap", () => {
  const topLevelFunctions = new Set(
    serverAst.body
      .filter((node) => node.type === "FunctionDeclaration")
      .map((node) => node.id.name)
  );
  const extractedImplementations = [
    "executeEngineCycleBody",
    "scanMarket",
    "scanCryptoMarket",
    "scoreStock",
    "scoreCrypto",
    "calculateInstitutionalScores",
    "calculateCryptoInstitutionalQualification",
    "autoBuySignals",
    "autoBuyCryptoSignals",
    "autoExitPositions",
    "autoExitCryptoPositions",
  ];

  for (const name of extractedImplementations) {
    assert.equal(topLevelFunctions.has(name), false, `${name} leaked back into server.js`);
  }
});

test("server bootstrap composes every extracted domain service", () => {
  const requiredFactories = [
    "createAutoBuyStrategies",
    "createCryptoIntelligenceStrategy",
    "createCryptoMarketScanner",
    "createStockMarketStrategy",
    "createPositionExitManager",
    "createEngineCycle",
  ];

  for (const factory of requiredFactories) {
    assert.match(serverSource, new RegExp(`\\b${factory}\\(`));
  }
});
