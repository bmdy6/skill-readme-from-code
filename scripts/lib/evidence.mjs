import path from 'node:path';
import fs from 'node:fs/promises';
import {json,hash} from './io.mjs';
const result=(id,issues)=>({id,status:issues.length?'fail':'pass',issues});
export async function heroRelevance(repo,brief,facts){
 const issues=[],core=brief.coreAction;
 if(!core?.what||!core.input||!(core.command||core.agentStep)||!core.output?.keywords?.length||!core.factIds?.length)issues.push('Missing sourced coreAction (what, input, command/agentStep, output keywords, factIds)');
 if(facts&&core?.factIds?.some(id=>!facts.facts.some(f=>f.id===id)))issues.push('coreAction references unknown fact IDs');
 const base=path.join(repo,'docs/readme');const spec=await json(path.join(base,'art.json'));
 const hero=spec?.images?.find(i=>i.id==='hero');
 const capture=hero?.captureId&&await json(path.join(base,'captures',hero.captureId+'.json'));
 if(!capture)issues.push('Hero requires a core capture');
 else{
  if(capture.role!=='core')issues.push('Hero capture role must be core');
  const command=capture.command||'';
  if(/\b(?:skills\s+add|(?:npm|pnpm|yarn)\s+(?:ci|i\b|install|add)|(?:gh\s+repo|git)\s+clone|pip\s+install)\b/i.test(command))issues.push('Hero shows an installation command');
  if(/\b(?:test|lint|check|verify)(?:\b|[._-])/i.test(command))issues.push('Hero shows a check instead of the core action');
  if(/\bpreview\.mjs\b|\b(?:cat|head)\s+README/i.test(command)||(hero.template!=='hero-screens'&&/^#{1,2}\s+.+/m.test(capture.stdout||'')))issues.push('Hero shows README text rather than a core result');
  if(capture.kind==='agent-run'){
   if(!capture.input||!capture.agentStep||!capture.usedFiles?.length||!capture.response?.file)issues.push('Agent-run needs input, agentStep, usedFiles and an original response');
   else{
    for(const used of [...capture.usedFiles,capture.response]){
     const p=path.resolve(base,used.file);
     if(!p.startsWith(path.resolve(base)+path.sep))issues.push('Agent-run source escapes its input directory');
     else try{if(hash(await fs.readFile(p))!==used.sha256)issues.push(`Changed agent-run source: ${used.file}`);}catch{issues.push(`Missing agent-run source: ${used.file}`);}
    }
    try{const raw=await json(path.join(base,capture.response.file));if(raw?.[capture.response.outputKey]!==capture.stdout)issues.push('Agent output differs from the original response');}catch{issues.push('Invalid original agent response');}
   }
  }else if(capture.exitCode!==undefined&&(capture.exitCode!==0||capture.timedOut))issues.push('Core command did not complete successfully');
 }
 return result('V10',issues);
}
