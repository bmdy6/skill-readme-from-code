import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {audit,verify,staticChecks} from '../scripts/lib/verify.mjs';
import {shellBlocks} from '../scripts/lib/markdown.mjs';
import {runCopy} from '../scripts/lib/execute.mjs';
test('shell fences include tilde and bare blocks',()=>assert.equal(shellBlocks('~~~bash\necho a\n~~~\n\n```\necho b\n```').length,2));
for(const name of ['cli-tool','library','web-app','agent-skill','clean'])test(`audit fixture ${name}`,async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-audit-'));
 const r=await audit({repo:path.resolve(`evals/fixtures/${name}`),work,local:true});
 const expected=JSON.parse(await fs.readFile(`evals/fixtures/${name}/expected.json`));
 for(const id of expected.fail)assert.equal(r.checks.find(c=>c.id===id).status,'fail',id);
 if(name==='clean')assert.equal(r.checks.filter(c=>c.status==='fail').length,0);
});
test('execution changes only a disposable copy',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-copy-'));await fs.writeFile(path.join(repo,'keep'),'original');
 const r=await runCopy(repo,'echo changed > keep; printf "\\033[32mready\\033[0m"');
 assert.equal(r.exitCode,0);assert.match(r.stdout,/\x1b\[32m/);assert.equal(await fs.readFile(path.join(repo,'keep'),'utf8'),'original');
});
test('timeout is recorded',async()=>{const r=await runCopy('evals/fixtures/clean','sleep 3',{timeoutMs:50});assert.equal(r.timedOut,true);});
test('unplanned command fails V1',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-verify-'));
 const r=await verify({repo:path.resolve('evals/fixtures/clean'),work,local:true});
 assert.equal(r.checks.find(c=>c.id==='V1').status,'fail');
});
test('Chinese anchors follow heading slugs',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-anchor-'));
 await fs.writeFile(path.join(repo,'README.md'),'# Notes\n\n[中文](#中文标题)\n\n## 中文标题\n');
 const r=await staticChecks(repo,{facts:[],manifest:{},images:[],workflows:[]},{});
 assert.equal(r.find(x=>x.id==='V3').status,'pass');
});
test('badge mismatch, claims and denied words fail independently',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-truth-'));
 await fs.writeFile(path.join(repo,'README.md'),'# Moss\n\n![license](https://img.shields.io/badge/license-Apache--2.0-blue)\n\nA forbidden feature.\n');
 await fs.writeFile(path.join(repo,'claims.json'),JSON.stringify([{claim:'A forbidden feature.',factIds:['unknown']}])) ;
 const deny=path.join(repo,'deny.txt');await fs.writeFile(deny,'forbidden');
 const r=await staticChecks(repo,{facts:[],manifest:{},images:[],workflows:[],spdx:'MIT'},{},{'deny-words':deny});
 assert.equal(r.find(x=>x.id==='V5').status,'fail');assert.equal(r.find(x=>x.id==='V6').status,'fail');
});
test('V9 rejects changed image bytes',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-hash-')),work=path.join(repo,'work');
 await fs.cp('evals/fixtures/clean',repo,{recursive:true});await fs.mkdir(path.join(repo,'docs/readme'),{recursive:true});
 await fs.writeFile(path.join(repo,'docs/readme/a.png'),'changed');
 await fs.writeFile(path.join(repo,'docs/readme/art-manifest.json'),JSON.stringify({files:[{file:'a.png',sha256:'wrong',checks:{overflow:'pass',fontSize:'pass',contrast:'pass',fields:'pass',size:'pass'}}]}));
 const r=await verify({repo,work,local:true});assert.match(r.checks.find(c=>c.id==='V9').issues.join(' '),/Hash mismatch/);
});
