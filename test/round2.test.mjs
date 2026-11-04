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
