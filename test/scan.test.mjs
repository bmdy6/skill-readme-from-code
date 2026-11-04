import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scan} from '../scripts/lib/scan.mjs';
for (const type of ['cli-tool','library','web-app','agent-skill','clean']) {
  test(`scan ${type} is deterministic and sourced`, async()=>{
    const a=await scan(`evals/fixtures/${type}`,{github:false});
    assert.deepEqual(a,await scan(`evals/fixtures/${type}`,{github:false}));
    assert.equal(a.projectType, type==='cli-tool'?'cli':type==='clean'?'library':type);
    assert.ok(a.facts.length>2);
    for(const f of a.facts) assert.match(f.source, /:\d+$/);
  });
}
test('detects tests locking README',async()=>{
  const a=await scan('evals/fixtures/agent-skill',{github:false});
  assert.equal(a.readmeTests.length,1);
});
