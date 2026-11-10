import path from 'node:path';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {readmeDocuments,write,json,hash,exists} from './io.mjs';
import {images} from './markdown.mjs';
import {firstScreen} from './screen.mjs';
const baselineFile=opts=>path.join(opts.work,'images-only-baseline.json');
export async function prepareImagesOnly(opts){
  if(await exists(baselineFile(opts))) throw Error('Images-only baseline already frozen; use a new work directory');
  const documents=await readmeDocuments(opts.repo);
  if(!documents.length) throw Error('No README to preserve');
  const baseline={readmes:documents.map(({file,text,language})=>({file,text,language,sha256:hash(text)}))};
  await write(baselineFile(opts),baseline);
  return baseline;
}
function additions(spec,baseline){
  if(!spec?.readmes || !Object.keys(spec.readmes).length) throw Error('Images-only needs image insertions');
  const result=new Map();
  for(const [file,parts] of Object.entries(spec.readmes)){
    const original=baseline.readmes.find(r=>r.file===file);
    if(!original || !Array.isArray(parts) || !parts.length) throw Error('Images-only must preserve existing README files');
    let text=original.text;
    for(const part of parts){
      if(typeof part.after!=='string'||!part.after||text.split(part.after).length!==2) throw Error('Insertion anchor must occur exactly once');
      const block=part.block;
      const imgs=typeof block==='string'?images(block):[];
      const caption=typeof block==='string'?block.replace(/<picture\b[^>]*>|<\/picture>|<(?:img|source)\b[^>]*>|!\[[^\]]*\]\([^\n)]+\)/gi,'').trim():'';
      if(!imgs.length || !imgs.some(i=>!i.source&&i.alt?.trim()) || caption.length>400 || /[<>]|```|~~~|^\s*#|^\s*[-*] |\n\s*\n/m.test(caption) || !/^\s*\n/.test(block))
        throw Error('Only image markup and one short caption are allowed; no shell or prose rewrite');
      for(const img of imgs) if(!img.src || /^(?:https?:|data:|\/)/.test(img.src)||img.src.split(/[\\/]/).includes('..')) throw Error('New images must be local repository files');
      text=text.replace(part.after,part.after+block);
    }
    result.set(file,text);
  }
  return result;
}
export async function applyImagesOnly(opts){
  const baseline=await json(baselineFile(opts));
  if(!baseline) throw Error('Missing frozen images-only baseline');
  const spec=typeof opts.spec==='object'?opts.spec:await json(opts.spec);
  const rendered=additions(spec,baseline);
  // Validate every file before making the first write.
  for(const old of baseline.readmes) if(hash(await fs.readFile(path.join(opts.repo,old.file)))!==old.sha256) throw Error('README changed after baseline');
  for(const [file,text] of rendered) await write(path.join(opts.repo,file),text);
  await write(path.join(opts.work,'images-only-insertions.json'),spec);
  return {mode:'images-only',files:[...rendered.keys()]};
}
export async function checkImagesOnly(opts){
  const issues=[];
  try{
    const baseline=await json(baselineFile(opts)),spec=await json(path.join(opts.work,'images-only-insertions.json'));
    if(!baseline || !spec) throw Error('Missing frozen baseline or image insertions');
    const rendered=additions(spec,baseline);
    const current=await readmeDocuments(opts.repo);
    if(current.length!==baseline.readmes.length) throw Error('README file set changed');
    for(const old of baseline.readmes){
      if(hash(old.text)!==old.sha256) throw Error('Corrupt baseline');
      if(await fs.readFile(path.join(opts.repo,old.file),'utf8')!==(rendered.get(old.file)??old.text)) issues.push(`${old.file}: original bytes changed outside image insertions`);
    }
  }catch(e){issues.push(e.message);}
  return {id:'I1',status:issues.length?'fail':'pass',issues};
}
export async function verifyImagesOnly(opts){
  const checks=[await checkImagesOnly(opts)];
  const baseline=await json(baselineFile(opts));
  const brief=await json(opts.brief||path.join(opts.work,'brief.json'),{});
  const spec=await json(path.join(opts.work,'images-only-insertions.json'));
  const imageIssues=[],screenIssues=[],provenanceIssues=[];
  const manifest=await json(path.join(opts.repo,'docs/readme/art-manifest.json'));
  let primary;
  if(!manifest?.files?.length) provenanceIssues.push('Missing or empty art manifest');
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    for(const old of baseline?.readmes||[]){
      const screen=await firstScreen({...opts,readme:old.file,install:brief.install,work:old.file==='README.md'?opts.work:path.join(opts.work,old.file+'-screen')});
      if(old.file==='README.md')primary=screen;
      for(const theme of ['desktop','desktop-dark'])for(const [k,v] of Object.entries(screen.viewports[theme].checks))if(!v)screenIssues.push(`${old.file} ${theme}: ${k} is not fully visible`);
      for(const part of spec?.readmes?.[old.file]||[])for(const img of images(part.block)){
        const full=path.resolve(opts.repo,img.src);
        const real=await fs.realpath(full).catch(()=>null);
        if(!real?.startsWith((await fs.realpath(opts.repo))+path.sep)){imageIssues.push(`Missing or escaping image ${img.src}`);continue;}
        const bytes=await fs.readFile(real);
        const data='data:image/png;base64,'+bytes.toString('base64');
        const size=await page.evaluate(src=>new Promise(r=>{const i=new Image();i.onload=()=>r({width:i.naturalWidth,height:i.naturalHeight});i.onerror=()=>r(null);i.src=src;}),data);
        if(!size || size.width<400 || size.height<100)imageIssues.push(`Invalid or undersized image ${img.src}`);
        const entry=manifest?.files?.find(f=>'docs/readme/'+f.file===img.src);
        if(!entry || entry.sha256!==hash(bytes)){provenanceIssues.push(`Missing manifest/hash mismatch ${img.src}`);continue;}
        const capture=await json(path.join(opts.repo,'docs/readme/captures',entry.captureId+'.json'));
        const output=capture?.outputs?.find(o=>o.sha256===entry.sourceSha256 || o.sha256===entry.sha256);
        if(!capture || capture.role!=='core' || capture.exitCode!==0 || capture.timedOut || !capture.usedFiles?.length || !output)
          provenanceIssues.push(`Missing successful sourced core capture ${img.src}`);
        for(const used of capture?.usedFiles||[]){
          // Web sources refer to project files; command input copies live beside captures.
          const root=capture.kind==='web-run'?opts.repo:path.join(opts.repo,'docs/readme');
          const p=path.resolve(root,used.file), realUsed=await fs.realpath(p).catch(()=>null);
          if(!realUsed?.startsWith((await fs.realpath(root))+path.sep) || hash(await fs.readFile(p))!==used.sha256)provenanceIssues.push(`Changed capture source ${used.file}`);
        }
        for(const source of capture?.outputs||[]){
          const p=path.resolve(opts.repo,'docs/readme',source.file);
          const realSource=await fs.realpath(p).catch(()=>null);
          if(!realSource?.startsWith((await fs.realpath(path.join(opts.repo,'docs/readme')))+path.sep) || hash(await fs.readFile(p))!==source.sha256)provenanceIssues.push(`Changed capture output ${source.file}`);
        }
      }
    }
  }finally{await browser.close();}
  for(const [id,issues,extra] of [['I2',imageIssues,{}],['V2',screenIssues,{screen:primary}],['I3',provenanceIssues,{}]])checks.push({id,status:issues.length?'fail':'pass',issues,...extra});
  const r={mode:'images-only',scope:'Original README bytes, added images, capture provenance and first screen; existing text/commands are not re-evaluated',ok:checks.every(c=>c.status==='pass'),checks,score:Math.round(100*checks.filter(c=>c.status==='pass').length/checks.length)};
  await write(path.join(opts.work,'verify.json'),r);
  await write(path.join(opts.work,'verify.md'),`# Images-only verification\n\n${r.scope}\n\n${checks.map(c=>`${c.id}: ${c.status} ${c.issues.join('; ')}`).join('\n\n')}\n`);
  return r;
}
