import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { capture } from '../scripts/lib/capture.mjs';
import { runCopy } from '../scripts/lib/execute.mjs';
import { verify, staticChecks } from '../scripts/lib/verify.mjs';
import { report, scoreAnswers } from '../scripts/lib/delivery.mjs';
import { firstScreen } from '../scripts/lib/screen.mjs';
import { write } from '../scripts/lib/io.mjs';
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-round4-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),work=path.join(root,'work');
 await fs.mkdir(repo); await fs.mkdir(work);return {root,repo,work};
}
const facts={facts:[],manifest:{},images:[],workflows:[]};
test('#12 capture saves original failure and partial output collection errors',async t=>{
 const {repo,work}=await fixture(t);
 const r=await capture({repo,work,id:'failure',command:'echo started; echo problem >&2; echo kept > ok.txt; exit 7',outputs:'ok.txt,missing.txt'});
 assert.equal(r.exitCode,7);assert.match(r.stdout,/started/);assert.match(r.stderr,/problem/);
 assert.equal(r.outputs.length,1);assert.equal(r.outputErrors[0].file,'missing.txt');
 assert.equal(JSON.parse(await fs.readFile(path.join(work,'captures/failure.json'))).exitCode,7);
});
test('#12 capture timeout without output is persisted and CLI rejects missing successful output',async t=>{
 const {repo,work}=await fixture(t);
 const r=await capture({repo,work,id:'timeout',command:'echo started; sleep 5',outputs:'missing.txt','timeout-ms':30});
 assert.equal(r.timedOut,true);assert.equal(r.outputErrors.length,1);
 try {execFileSync(process.execPath,['scripts/run.mjs','capture','--repo',repo,'--work',work,'--id','missing','--outputs','missing.txt','--','echo done'],{stdio:'pipe'});assert.fail('must fail');} catch(e){assert.equal(e.status,1);}
 assert.equal(JSON.parse(await fs.readFile(path.join(work,'captures/missing.json'))).outputErrors.length,1);
});
test('#12 capture keeps traversal and symlink escape protections',async t=>{
 const {repo,work,root}=await fixture(t); await write(path.join(root,'outside'),'private');
 await assert.rejects(runCopy(repo,'true',{outputs:['../outside'],outputDir:work}),/escapes/);
 const r=await runCopy(repo,`ln -s '${root}/outside' bad`,{outputs:['bad'],outputDir:work});
 assert.equal(r.outputs.length,0);assert.match(r.outputErrors[0].error,/escapes/);
 assert.equal(await fs.stat(path.join(work,'bad')).then(()=>true,()=>false),false);
});
for (const mode of ['all','partial','none','mixed']) test(`#13 V1 ${mode} discloses skipped commands`,async t=>{
 const {repo,work}=await fixture(t);
 const commands=mode==='none'?[]: mode==='all'?['echo skip']:['echo run','echo skip'];
 await write(path.join(repo,'README.md'),'# Digest\n\nCreate a readable digest.\n\n'+commands.map(c=>'```sh\n'+c+'\n```').join('\n\n'));
 await write(path.join(work,'command-plan.json'),{blocks:commands.map((code,index)=>index===commands.length-1?{index,skip:'Explicit synthetic skip'}:{index,expectExit:mode==='mixed'?7:0}),projectTests:{skip:'No project tests in this fixture'}});
 const r=await verify({repo,work,offline:true});const v=r.checks.find(c=>c.id==='V1');
 assert.equal(v.status,mode==='all'||mode==='none'?'skip':mode==='mixed'?'fail':'pass');
 if(commands.length){
  assert.ok((await fs.readFile(path.join(work,'verify.md'),'utf8')).includes('README.md block '+(commands.length-1)+': Explicit synthetic skip'));
  const body=await report({repo,work});assert.match(body,/Not verified[\s\S]*Explicit synthetic skip/);
 }
});
for (const primary of ['en','zh-CN']) test(`#14 ${primary} primary checks both languages and images`,async t=>{
 const {repo,work}=await fixture(t);const zh='# 笔记\n\n生成摘要。\n\n![演示](docs/readme/demo.zh-CN.png)\n\n## 快速开始\n\n```sh\necho ready\n```';
 const en='# Notes\n\nCreate a digest.\n\n![Demo](docs/readme/demo.png)\n\n## Quick start\n\n```sh\necho ready\n```';
 const other=primary==='en'?'README.zh-CN.md':'README.en.md';
 await write(path.join(repo,'README.md'),primary==='en'?en:zh);await write(path.join(repo,other),primary==='en'?zh:en);
 await write(path.join(repo,'docs/readme/demo.png'),'png');await write(path.join(repo,'docs/readme/demo.zh-CN.png'),'png');
 const brief={languages:['en','zh-CN'],readmes:{'README.md':primary,[other]:primary==='en'?'zh-CN':'en'}};
 const checks=await staticChecks(repo,{...facts,images:['docs/readme/demo.png','docs/readme/demo.zh-CN.png']},brief);
 for(const id of ['V3','V4','V7'])assert.equal(checks.find(c=>c.id===id).status,'pass',JSON.stringify(checks));
 await write(path.join(work,'brief.json'),brief);await write(path.join(work,'command-plan.json'),{blocks:[{index:0}],projectTests:{skip:'Fixture'}});
 const r=await verify({repo,work,offline:true});assert.deepEqual(r.checks.find(c=>c.id==='V1').results.map(r=>r.file).sort(),['README.md',other].sort());
 await fs.appendFile(path.join(repo,other),'\n[bad](missing.md)\n');
 assert.equal((await staticChecks(repo,facts,brief)).find(c=>c.id==='V3').status,'fail');
 await fs.appendFile(path.join(repo,other),'\n## Extra\n');
 assert.equal((await staticChecks(repo,facts,brief)).find(c=>c.id==='V7').status,'fail');
});
test('#15 copies tracked public env example but excludes credentials and nonportable caches',async t=>{
 const {repo}=await fixture(t);execFileSync('git',['init','-q',repo]);
 for(const f of ['templates/.env.example','.env','.env.local','untracked/.env.example','.build/pch','.venv/bin/python','__pycache__/code.pyc'])await write(path.join(repo,f),'synthetic');
 execFileSync('git',['-C',repo,'add','-f','templates/.env.example']);
 const r=await runCopy(repo,'test -f templates/.env.example && test ! -e .env && test ! -e .env.local && test ! -e untracked/.env.example && test ! -e .build && test ! -e .venv && test ! -e __pycache__');
 assert.equal(r.exitCode,0,r.stderr);
});
test('#15 local npm bin links run inside the copy without changing source dependencies',async t=>{
 const {repo}=await fixture(t);await write(path.join(repo,'node_modules/tool/cli.mjs'),"import {value} from './lib.mjs'; console.log(value);");await write(path.join(repo,'node_modules/tool/lib.mjs'),'export const value="copied-bin";');
 await fs.mkdir(path.join(repo,'node_modules/.bin'));await fs.symlink('../tool/cli.mjs',path.join(repo,'node_modules/.bin/tool'));
 const r=await runCopy(repo,'node node_modules/.bin/tool; echo changed > node_modules/tool/lib.mjs');
 assert.equal(r.exitCode,0,r.stderr);assert.match(r.stdout,/copied-bin/);assert.match(await fs.readFile(path.join(repo,'node_modules/tool/lib.mjs'),'utf8'),/export const/);
});
test('#16 first command and entire visible installation block have distinct exact contracts',async t=>{
 const {repo,work}=await fixture(t);const block='git clone https://example.com/demo\ncd demo';
 await write(path.join(repo,'README.md'),'# Digest\n\nCreate a digest.\n\n```sh\n'+block+'\n```');
 const install={block,firstCommand:'git clone https://example.com/demo'};
 const r=await firstScreen({repo,work,offline:true,install});assert.equal(r.viewports.desktop.install,block);assert.equal(r.viewports.desktop.checks.install,true);
 assert.equal(scoreAnswers({install},{firstCommand:install.firstCommand}).checks.firstCommand,true);
 for(const firstCommand of ['cd demo',block,'git clone https://example.com/demo extra'])assert.equal(scoreAnswers({install},{firstCommand}).checks.firstCommand,false);
 const legacy={install:{command:block}};assert.equal(scoreAnswers(legacy,{firstCommand:install.firstCommand}).checks.firstCommand,true);
});
test('V8 accepts an explicit timeout and rejects invalid timeout values',async t=>{
 const {repo,work}=await fixture(t);await write(path.join(repo,'README.md'),'# Digest');
 for(const timeoutMs of [120000,0,-1,'bad']){
  await write(path.join(work,'command-plan.json'),{blocks:[],projectTests:{command:'echo tests',timeoutMs}});
  const r=await verify({repo,work,offline:true});const v=r.checks.find(c=>c.id==='V8');
  assert.equal(v.status,timeoutMs===120000?'pass':'fail');
  if(timeoutMs===120000)assert.equal(v.results[0].timeoutMs,timeoutMs);
 }
});
test('execution allows an explicitly configured run beyond sixty seconds',async t=>{
 const {repo}=await fixture(t);const r=await runCopy(repo,'sleep 60.1; echo complete',{timeoutMs:65000});
 assert.equal(r.timedOut,false);assert.equal(r.exitCode,0);assert.match(r.stdout,/complete/);
});
test('#14 language directories preserve existing filenames and reject wrong-language images',async t=>{
 const {repo}=await fixture(t);
 for(const [file,lang] of [['README.md','zh'],['README.en.md','en']])await write(path.join(repo,file),'# Demo\n\n![Result](docs/images/'+lang+'/hero-light.png)\n');
 for(const lang of ['en','zh'])await write(path.join(repo,'docs/images/'+lang+'/hero-light.png'),'image');
 let c=await staticChecks(repo,facts,{readmes:{'README.md':'zh-CN','README.en.md':'en'}});
 assert.equal(c.find(c=>c.id==='V4').status,'pass');
 await write(path.join(repo,'README.md'),'# Demo\n\n![结果](docs/images/en/hero-light.png)\n');
 c=await staticChecks(repo,facts,{readmes:{'README.md':'zh-CN','README.en.md':'en'}});
 assert.equal(c.find(c=>c.id==='V4').status,'fail');
});
test('#15 real credential files remain outside disposable execution copies',async t=>{
 const {repo}=await fixture(t);
 for(const f of ['.npmrc','.netrc','.pypirc','.ssh/id_ed25519','.aws/credentials'])await write(path.join(repo,f),'synthetic secret');
 const r=await runCopy(repo,'test ! -e .npmrc && test ! -e .netrc && test ! -e .pypirc && test ! -e .ssh && test ! -e .aws');
 assert.equal(r.exitCode,0);
});
test('#14 every present language variant participates in structural checks',async t=>{
 const {repo}=await fixture(t);
 await write(path.join(repo,'README.md'),'# Demo\n\n## Quick start\n');
 await write(path.join(repo,'README.zh-CN.md'),'# 示例\n\n## 快速开始\n');
 await write(path.join(repo,'README.en.md'),'# Demo\n\n## Quick start\n\n## Unexpected\n');
 const c=await staticChecks(repo,facts,{readmes:{'README.md':'en','README.zh-CN.md':'zh-CN','README.en.md':'en'}});
 assert.equal(c.find(c=>c.id==='V7').status,'fail');
});
test('#14 an English primary README with a Chinese navigation link keeps its language',async t=>{
 const {repo}=await fixture(t);
 await write(path.join(repo,'README.md'),'# Demo\n\nCreate a digest.\n\n[简体中文](README.zh-CN.md)\n\n![Demo](docs/hero-light.png)\n');
 await write(path.join(repo,'README.zh-CN.md'),'# 示例\n\n生成摘要。\n\n![示例](docs/hero-light.zh-CN.png)\n');
 for(const f of ['docs/hero-light.png','docs/hero-light.zh-CN.png'])await write(path.join(repo,f),'image');
 const c=await staticChecks(repo,facts,{});assert.equal(c.find(c=>c.id==='V4').status,'pass');
});
test('#16 contradictory firstCommand and installation block are rejected',()=>{
 assert.throws(()=>scoreAnswers({install:{block:'echo first\necho second',firstCommand:'echo second'}},{firstCommand:'echo second'}),/firstCommand.*first line/);
});
