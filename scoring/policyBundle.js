import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
// Fixed source allowlist: no server configuration, .env, accounts or credentials.
const names = ['decisionScores.js','componentScore.js','cryptoScoring.js','cryptoSetup.js','cryptoTradePlan.js',
  'fundamentalValidation.js','newsCatalyst.js','continuationSetup.js','earlyDiscovery.js'];
const sources = Object.fromEntries(names.map(name => [name,readFileSync(new URL(name,import.meta.url),'utf8')]));
sources['risk/evidencePolicy.js'] = readFileSync(new URL('../risk/evidencePolicy.js',import.meta.url),'utf8');
sources['market-data/barSnapshot.js'] = readFileSync(new URL('../market-data/barSnapshot.js',import.meta.url),'utf8');
const id = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
export const policyManifest = Object.freeze({id, files:Object.freeze(Object.keys(sources)), retention:'Last eight archived policy bundles; older versions may be unavailable'});
export async function archivePolicyBundle(directory) {
  const bundle = JSON.stringify({id,sources});
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
