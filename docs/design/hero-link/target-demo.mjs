import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {serve} from '../../test/helpers/serve.mjs';
const run=promisify(execFile), dir='docs/readme/run';
const source=await serve(path.resolve('test/fixtures'));
try {
 const cmd=(...a)=>run(process.execPath,['scripts/run.mjs',...a]);
 await cmd('extract','--url',source.url+'/site-a/','--out',dir);
 await fs.mkdir(dir+'/labels',{recursive:true});
 await fs.writeFile(dir+'/labels/a.json',JSON.stringify({siteId:'a',color:{text:'c1',surface:'c2',border:'c3',accent:'c6',subtle:'c5'},fontFamily:{body:'f3'},shadow:{card:'sh1'},components:{card:'cmp1',button:'cmp2'},styleSummary:'Original fixture, semantic names selected from existing evidence IDs.'}));
 await cmd('tokens','--out',dir);
 const tokens=JSON.parse(await fs.readFile(dir+'/tokens.json','utf8'));
 const sources=JSON.parse(await fs.readFile(dir+'/sources.json','utf8'));
 const verified=JSON.parse(await fs.readFile(dir+'/verify-report.json','utf8'));
 const keys=['color.accent','color.text','color.border','fontSize.xl','radius.lg','shadow.card'];
 const show=v=>typeof v==='string'?v:v&&typeof v==='object'&&'offsetY' in v?`0 ${v.offsetY.value}px ${v.blur.value}px`:v&&typeof v==='object'&&'value' in v?v.value+v.unit:String(v);
 const entries=Object.keys(sources).map(name=>{const e=sources[name].evidence.find(e=>e.line!=null);return {name,value:show(sources[name].value),line:e?.line||0,evidence:e?.authoredValue||''};});
 await fs.writeFile(dir+'/token-rows.json',JSON.stringify({entries,total:Object.keys(sources).length},null,2));
 await fs.writeFile(dir+'/status.json',JSON.stringify({...verified,message:`${verified.passed}/${verified.sampled} sampled sources still match`}));
 console.log('tokens.json · '+Object.keys(sources).length+' design tokens');
 console.log('tokens.css · CSS variables emitted');
 console.log('sources.json · selectors and CSS line:column');
 console.log(`${verified.passed}/${verified.sampled} sampled sources still match`);
} finally {await source.close();}
