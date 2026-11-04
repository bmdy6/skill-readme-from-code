import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {write} from '../scripts/lib/io.mjs';
import {heroRelevance} from '../scripts/lib/evidence.mjs';
async function heroFixture(capture){
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-core-'));
 await write(path.join(repo,'docs/readme/art.json'),{images:[{id:'hero',template:'hero-terminal',captureId:'demo'}]});
 await write(path.join(repo,'docs/readme/captures/demo.json'),capture);
 return repo;
}
const core={what:'Produce a digest',input:'Original notes',command:'node index.mjs',output:{description:'A daily digest',keywords:['digest']},factIds:['entry-0']};
for(const [name,capture,issue] of [
 ['installation',{role:'core',command:'npm install moss',stdout:'Installed'},/install/i],
 ['checks',{role:'core',command:'python3 scripts/check.py sample.txt',stdout:'100'},/check/i],
 ['README text',{role:'core',command:'node scripts/preview.mjs',stdout:'# readme-from-code\n## Quick start'},/README/i],
 ['supporting capture',{role:'supporting',command:'node index.mjs',stdout:'Digest written'},/role/i],
])test(`V10 rejects ${name}`,async()=>{
 const r=await heroRelevance(await heroFixture(capture),{coreAction:core});assert.equal(r.status,'fail');assert.match(r.issues.join(' '),issue);
});
test('V10 accepts real core output',async()=>{
 const r=await heroRelevance(await heroFixture({role:'core',command:'node index.mjs',stdout:'Daily digest written.'}),{coreAction:core});assert.equal(r.status,'pass');
});
import {staticChecks} from '../scripts/lib/verify.mjs';
for(const text of ['Help writers polish drafts.','A tool that writes a README.','An agent skill that writes a README.','This project writes a README.','帮助你写 README。','一个写 README 的工具。','Get a README using an agent skill.','Work smarter every day.'])test(`V6 rejects generic position: ${text}`,async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-position-'));await write(path.join(repo,'README.md'),'# Moss\n\n'+text+'\n');
 const r=await staticChecks(repo,{facts:[],manifest:{},images:[],workflows:[]},{});assert.equal(r.find(c=>c.id==='V6').status,'fail');
});
import {retentionCheck} from '../scripts/lib/evidence.mjs';
import {scan} from '../scripts/lib/scan.mjs';
test('V11 catches a missing integration and old H2',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-retain-'));await write(path.join(repo,'README.md'),'# Moss\n\nPolish a draft.\n');
 await write(path.join(repo,'docs/readme/baseline.json'),{integrations:[{id:'agent-codex',kind:'integration',value:'Codex'}],readmes:[{file:'README.md',headings:['Supported tools']}]});
 const r=await retentionCheck(repo,{});assert.equal(r.status,'fail');assert.equal(r.issues.length,2);
 await write(path.join(repo,'docs/compatibility.md'),'## Supported tools\n\nCodex\n');
 await write(path.join(repo,'README.md'),'# Moss\n\nPolish a draft.\n\n[Compatibility](docs/compatibility.md)\n');assert.equal((await retentionCheck(repo,{})).status,'pass');
});
test('V11 requires a reason for an intentional deletion',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-delete-'));await write(path.join(repo,'README.md'),'# Moss\n');await write(path.join(repo,'docs/readme/baseline.json'),{integrations:[],readmes:[{file:'README.md',headings:['Alternatives']}]});
 await write(path.join(repo,'docs/readme/retention.json'),{intentionalDeletions:[{id:'heading:README.md:Alternatives',reason:''}]});assert.equal((await retentionCheck(repo,{})).status,'fail');
 await write(path.join(repo,'docs/readme/retention.json'),{intentionalDeletions:[{id:'heading:README.md:Alternatives',reason:'Remove unsupported competitor comparisons.'}]});assert.equal((await retentionCheck(repo,{})).status,'pass');
});
test('V6 allows integrations but rejects alternatives',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-kinds-'));await write(path.join(repo,'README.md'),'# Moss\n\nPolish drafts with Codex.\n');
 const f={facts:[{kind:'integration',value:'Codex'}],manifest:{},images:[],workflows:[]};assert.equal((await staticChecks(repo,f,{})).find(c=>c.id==='V6').status,'pass');
 f.facts[0].kind='alternative';assert.equal((await staticChecks(repo,f,{})).find(c=>c.id==='V6').status,'fail');
});
test('scan keeps typed integration and H2 baseline evidence',async()=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'rfc-snapshot-'));await write(path.join(repo,'README.md'),'# Moss\n\nPolish drafts with Codex.\n\n## Supported tools\n\nClaude Code, Codex, Cursor, pi.\n');
 const r=await scan(repo,{github:false});assert.ok(r.facts.some(f=>f.kind==='integration'&&f.value==='Codex'));assert.deepEqual(r.readmeSnapshot.readmes[0].headings,['Supported tools']);
});
