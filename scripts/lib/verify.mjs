import fs from 'node:fs/promises';
import path from 'node:path';
import {read,json,write,exists,hash} from './io.mjs';
import {scan} from './scan.mjs';
import {shellBlocks,headings,images,links,prose} from './markdown.mjs';
import {firstScreen} from './screen.mjs';
import {runCopy} from './execute.mjs';
const check=(id,issues=[],extra={})=>({id,status:issues.length?'fail':'pass',issues,...extra});
export async function staticChecks(repo,facts,brief={},opts={}){
 const md=await read(path.join(repo,'README.md')),zh=await read(path.join(repo,'README.zh-CN.md'));const checks=[];
 const linkIssues=[];for(const [file,text]of [['README.md',md],...(zh?[['README.zh-CN.md',zh]]:[])]){
 for(const link of links(text)){
  if(/^https?:/.test(link)){if(opts.online)try{const res=await fetch(link,{method:'HEAD',signal:AbortSignal.timeout(10000)});if(!res.ok)linkIssues.push(`${file}: ${link} HTTP ${res.status}`);}catch(e){linkIssues.push(`${file}: ${link}: ${e.message}`);}continue;}
  if(/^(mailto:|data:)/.test(link))continue;
  const [p,anchor]=link.split('#');let target;try{target=decodeURIComponent(p||file);}catch{linkIssues.push(`Malformed link: ${link}`);continue;}
  const full=path.resolve(repo,target);if(!await exists(full))linkIssues.push(`${file}: missing ${link}`);
  else if(anchor&&/\.md$/.test(target)&&!headings(await read(full)).some(h=>h.slug===decodeURIComponent(anchor)))linkIssues.push(`${file}: missing anchor ${link}`);
 }}checks.push(check('V3',linkIssues,{externalLinks:opts.online?'checked':'not checked; use --online'}));
 const imageIssues=[],referenced=[];for(const [file,text]of [['README.md',md],...(zh?[['README.zh-CN.md',zh]]:[])]){
  for(const img of images(text)){
   if(!img.source&&!img.alt?.trim())imageIssues.push(`${file}: missing image alt`);
   if(img.width&&(!Number.isFinite(Number(img.width))||Number(img.width)>900))imageIssues.push(`${file}: image width exceeds 900`);
   if(!img.src)imageIssues.push(`${file}: missing image source`);else{
    referenced.push(img.src);if(!/^https?:|^data:/.test(img.src)&&!await exists(path.resolve(repo,img.src)))imageIssues.push(`${file}: missing ${img.src}`);
    if(!/badge|shields\.io|badgen/i.test(img.src)&&/\.(png|svg|jpe?g|webp)(?:$|\?)/.test(img.src)){
     if(file==='README.zh-CN.md'&&!/\.zh-CN\./.test(img.src))imageIssues.push(`${file}: English image ${img.src}`);
     if(file==='README.md'&&/\.zh-CN\./.test(img.src))imageIssues.push(`${file}: Chinese image ${img.src}`);
    }
   }
  }
  for(const p of text.matchAll(/<picture>[\s\S]*?<\/picture>/gi)){
   const imgs=images(p[0]);if(!imgs.some(i=>/dark/.test(i.src||''))||!imgs.some(i=>/light/.test(i.src||'')))imageIssues.push(`${file}: picture requires light and dark variants`);
  }
 }
 for(const img of facts.images.filter(i=>i.startsWith('docs/readme/')))if(!referenced.includes(img)&&!/^docs\/readme\/social-/.test(img))imageIssues.push(`Unreferenced image: ${img}`);
 checks.push(check('V4',imageIssues));
 const truth=[];const all=md+'\n'+zh;
 if(/OWNER\/REPO|<your[-_…\w]|\bTODO\b|\blorem\b/i.test(all))truth.push('Placeholder text');
 const licenseText=md.match(/(?:^|\n)#{1,6}\s+License[^\n]*\n([\s\S]*?)(?=\n#|$)/i)?.[1]||'';
 const named=licenseText.match(/MIT|Apache-2\.0|GPL-3\.0(?:-only)?|BSD-3-Clause/g)||[];
 if(named.some(l=>l!==facts.spdx))truth.push(`License section disagrees with ${facts.spdx||'unknown SPDX'}`);
 for(const badge of all.matchAll(/https?:[^\s)"<>]+/g)){
  const u=decodeURIComponent(badge[0]);const l=u.match(/badge\/licen[cs]e-([^-/?]+(?:-[\d.]+)?)/i)?.[1];if(l&&facts.spdx&&!l.toLowerCase().startsWith(facts.spdx.toLowerCase()))truth.push('License badge mismatch');
  const v=u.match(/badge\/version-v?([\d.]+)/i)?.[1];if(v&&v!==facts.manifest.version)truth.push('Version badge mismatch');
  const workflow=u.match(/actions\/workflows\/([^/?#]+)/)?.[1];if(workflow&&!facts.workflows.includes(`.github/workflows/${workflow}`))truth.push(`Unknown CI workflow ${workflow}`);
 }
 for(const b of shellBlocks(md)){
  const pkg=b.code.match(/npm (?:install|i)(?: -g)? ([\w@/.-]+)/)?.[1];if(pkg&&pkg!==facts.manifest.name&&!['--'].includes(pkg))truth.push(`Install package differs from manifest: ${pkg}`);
  const remote=b.code.match(/(?:skills add|git clone)(?: https:\/\/github.com\/)?\s*([\w.-]+\/[\w.-]+)/)?.[1]?.replace(/\.git$/,'');if(remote&&facts.remote&&remote!==facts.remote)truth.push('Install repository differs from remote');
 }
 const claims=await json(path.join(repo,'docs/readme/claims.json'),await json(path.join(repo,'claims.json'),[]));
 for(const c of claims){if(!all.includes(c.claim))truth.push(`Claim absent: ${c.claim}`);if(!c.factIds?.length||c.factIds.some(id=>!facts.facts.some(f=>f.id===id)))truth.push(`Unbacked claim: ${c.claim}`);}
 checks.push(check('V5',truth));
 const copy=[],words=prose(md).match(/\b[\w'-]+\b/g)||[];if(words.length>(brief.wordBudget??400))copy.push(`Word budget: ${words.length} > ${brief.wordBudget??400}`);
 for(const para of prose(md).split(/\n\s*\n/))if((para.match(/[.!?。！？](?:\s|$)/g)||[]).length>3)copy.push('Paragraph exceeds three sentences');
 if((md.match(/!\[[^\]]*\]\([^)]*(?:badge|shields\.io|badgen)[^)]*\)/gi)||[]).length>4)copy.push('More than four badges');
 if(headings(md).some(h=>/\p{Extended_Pictographic}/u.test(h.text)))copy.push('Emoji heading');
 for(const term of ['blazing fast','revolutionary','seamless'])if(all.toLowerCase().includes(term))copy.push(`Empty wording: ${term}`);
 const denied=opts['deny-words']?(await read(opts['deny-words'])).split(/\r?\n/).filter(Boolean):[];
 const terms=[...denied,...(!brief.allowNamedAlternatives?(facts.competitorTerms||[]).filter(t=>!Object.keys({...facts.manifest.dependencies,...facts.manifest.devDependencies}).includes(t)):[])];
 for(const t of terms)if(all.toLowerCase().includes(t.toLowerCase()))copy.push(`Forbidden term: ${t}`);
 checks.push(check('V6',copy,{wordCount:words.length}));
 if(!zh)checks.push({id:'V7',status:brief.languages?.includes('zh-CN')?'fail':'skip',reason:'Chinese README absent',issues:brief.languages?.includes('zh-CN')?['Requested language missing']:[]});
 else{
  const issues=[];if(JSON.stringify(headings(md).map(h=>h.depth))!==JSON.stringify(headings(zh).map(h=>h.depth)))issues.push('Heading structure/order differs');
  if(JSON.stringify(shellBlocks(md).map(b=>b.code))!==JSON.stringify(shellBlocks(zh).map(b=>b.code)))issues.push('Shell blocks differ');
  const norm=s=>images(s).map(i=>i.src?.replace(/\.zh-CN(?=\.)/g,''));if(JSON.stringify(norm(md))!==JSON.stringify(norm(zh)))issues.push('Image sequence differs');
  checks.push(check('V7',issues));
 }return checks;
}
async function base(opts){const facts=await scan(opts.repo,{github:false}),brief=await json(opts.brief||path.join(opts.work,'brief.json'),{});const checks=await staticChecks(opts.repo,facts,brief,opts);
 let screen;try{screen=await firstScreen({...opts,install:brief.install?.command});checks.unshift(check('V2',Object.entries(screen.viewports.desktop.checks).filter(([,v])=>!v).map(([k])=>`${k} is not fully visible on desktop`),{screen}));}catch(e){checks.unshift(check('V2',[e.message]));}
 return {facts,brief,checks};}
export function reportMarkdown(result,title){return `# ${title}\n\nScore: ${result.score}/100\n\n| Check | Result | Evidence |\n|---|---|---|\n${result.checks.map(c=>`| ${c.id} | ${c.status} | ${(c.issues?.join('; ')||c.reason||'Passed').replace(/\|/g,'\\|')} |`).join('\n')}\n\n${result.checks.find(c=>c.id==='V2')?.screen?.renderer||'No screen renderer'}\n`;}
export async function audit(opts){const {checks}=await base(opts);const r={mode:'audit',checks,score:Math.round(checks.filter(c=>c.status==='pass').length/checks.filter(c=>c.status!=='skip').length*100)};await write(path.join(opts.work,'audit.json'),r);await write(path.join(opts.work,'audit.md'),reportMarkdown(r,'README audit'));return r;}
export async function verify(opts){const {facts,brief,checks}=await base(opts),commandResults=[];const plan=await json(opts.plan||path.join(opts.work,'command-plan.json'),{blocks:[]});
 for(const file of ['README.md',...(await exists(path.join(opts.repo,'README.zh-CN.md'))?['README.zh-CN.md']:[])])for(const b of shellBlocks(await read(path.join(opts.repo,file)))){
  const rule=plan.blocks?.find(r=>(!r.file||r.file===file)&&(r.code===b.code||r.index===b.index));
  if(!rule){commandResults.push({...b,file,status:'fail',reason:'No command plan'});continue;}
  if(rule.skip){commandResults.push({...b,file,status:'skip',reason:rule.skip});continue;}
  const run=await runCopy(opts.repo,b.code,{tty:rule.tty});commandResults.push({...b,file,...run,status:!run.timedOut&&run.exitCode===(rule.expectExit??0)?'pass':'fail'});
 }
 checks.unshift(check('V1',commandResults.filter(r=>r.status==='fail').map(r=>`${r.file} block ${r.index}: ${r.reason||`exit ${r.exitCode}`}`),{results:commandResults}));
 if(!facts.testCommands.length)checks.push({id:'V8',status:'skip',reason:'No test command discovered',issues:[]});
 else{const results=[];for(const cmd of facts.testCommands)results.push(await runCopy(opts.repo,cmd));checks.push(check('V8',results.filter(r=>r.exitCode!==0||r.timedOut).map(r=>`${r.command}: exit ${r.exitCode}`),{results}));}
 const manifest=await json(path.join(opts.repo,'docs/readme/art-manifest.json'));const artIssues=[];
 if(!manifest)artIssues.push('Missing art manifest');else if(!manifest.files?.length)artIssues.push('Empty art manifest');else for(const f of manifest.files){
  const full=path.resolve(opts.repo,'docs/readme',f.file);if(!await exists(full))artIssues.push(`Missing ${f.file}`);else if(hash(await fs.readFile(full))!==f.sha256)artIssues.push(`Hash mismatch ${f.file}`);
  if(!f.checks||['overflow','fontSize','contrast','fields','size'].some(k=>f.checks[k]!=='pass'))artIssues.push(`Failed or absent self-check ${f.file}`);
 }
 checks.push(check('V9',artIssues));checks.sort((a,b)=>a.id.localeCompare(b.id));const r={mode:'verify',ok:!checks.some(c=>c.status==='fail'),checks,score:Math.round(checks.filter(c=>c.status==='pass').length/checks.filter(c=>c.status!=='skip').length*100),summary:Object.fromEntries(['pass','fail','skip'].map(s=>[s,checks.filter(c=>c.status===s).length]))};await write(path.join(opts.work,'verify.json'),r);await write(path.join(opts.work,'verify.md'),reportMarkdown(r,'README verification'));return r;
}
