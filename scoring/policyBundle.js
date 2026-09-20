import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
// Fixed source allowlist: no server configuration, .env, accounts or credentials.
const names = ['decisionScores.js','componentScore.js','cryptoScoring.js','cryptoSetup.js','cryptoTradePlan.js',
  'fundamentalValidation.js','newsCatalyst.js','continuationSetup.js','earlyDiscovery.js'];
const sources = Object.fromEntries(names.map(name => [name,readFileSync(new URL(name,import.meta.url),'utf8')]));
sources['risk/evidencePolicy.js'] = readFileSync(new URL('../risk/evidencePolicy.js',import.meta.url),'utf8');
sources['market-data/barSnapshot.js'] = readFileSync(new URL('../market-data/barSnapshot.js',import.meta.url),'utf8');
// Hash every first-party runtime JS dependency, including the central server.
// Retain compact hashes, not server source/environment contents. An immutable
// release commit plus this manifest identifies code beyond the source excerpt.
export function runtimeDependencyHashes(root = fileURLToPath(new URL('../', import.meta.url))) {
  const hashes = {};
  const excluded = new Set(['node_modules', '.git', 'test', 'tests', 'scripts', 'data', 'archive', 'dist']);
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || excluded.has(entry.name)) continue;
      const name = `${prefix}${entry.name}`, file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, `${name}/`);
      else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) hashes[name] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
  }
  visit(root);
  return Object.freeze(hashes);
}
const dependencies = runtimeDependencyHashes();
const id = createHash('sha256').update(JSON.stringify({ sources, dependencies })).digest('hex');
const commit = process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || '';
export const policyManifest = Object.freeze({ id, files:Object.freeze(Object.keys(sources)), dependencies,
  releaseCommit: /^[a-f0-9]{40}$/i.test(commit) ? commit : null,
  reconstruction: 'Runtime dependency hashes plus release commit; archived sources are bounded excerpts, not the complete repository',
  retention:'Last eight archived policy bundles; older versions may be unavailable' });
export async function archivePolicyBundle(directory) {
  const bundle = JSON.stringify({id,sources,dependencies,releaseCommit:policyManifest.releaseCommit});
  if (Buffer.byteLength(bundle)>1048576) throw new Error('POLICY_BUNDLE_CAPACITY');
  const slots = await Promise.all(Array.from({length:8},async(_,index)=>{
    const file=path.join(directory,`policy-bundle-${index}.json`);
    try {
      const stat=await fs.stat(file);
      if(stat.size>1048576) return {file,at:0};
      const existing=JSON.parse(await fs.readFile(file,'utf8'));
      return {file,at:stat.mtimeMs,matched:existing.id===id};
    } catch(error) { if(error.code==='ENOENT')return {file,at:0}; throw error; }
  }));
  if(slots.some(slot=>slot.matched))return id;
  const target=slots.sort((a,b)=>a.at-b.at)[0].file;
  await fs.writeFile(`${target}.tmp`,bundle,{mode:0o600});
  await fs.rename(`${target}.tmp`,target);
  return id;
}
