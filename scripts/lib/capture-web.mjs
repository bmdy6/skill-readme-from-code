import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {runCopy} from './execute.mjs';
import {json, write, hash} from './io.mjs';

export async function captureWeb(opts) {
  if (!/^[\w-]+$/.test(opts.id || '')) throw Error('capture-web requires a safe --id');
  const plan = typeof opts.plan === 'object' ? opts.plan : await json(opts.plan);
  const url = new URL(plan?.url);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password)
    throw Error('capture-web requires an HTTP loopback URL');
  if (!plan.command || !plan.sourceFiles?.length || !Array.isArray(plan.steps) || !plan.steps.length)
    throw Error('Web plan needs command, sourceFiles and core-action steps');
  const timeoutMs = Number(opts['timeout-ms'] ?? 60000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3600000) throw Error('Invalid timeout-ms');
  const base = await fs.realpath(opts.repo), usedFiles = [];
  for (const file of plan.sourceFiles) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw Error('Web source escapes repository');
    const full = await fs.realpath(path.resolve(base,file));
    if (!full.startsWith(base + path.sep)) throw Error('Web source escapes repository');
    usedFiles.push({file,sha256:hash(await fs.readFile(full))});
  }
  for (const step of plan.steps)
    if (!['fill','click','text','visible','press'].includes(step.action) || !step.selector || (['fill','text','press'].includes(step.action) && typeof step.value !== 'string'))
      throw Error('Invalid web action');
  // Refuse an already running service: this capture must start the named app.
  try { await fetch(url, {signal:AbortSignal.timeout(400)}); throw Error('Web capture port is already in use'); }
  catch (e) { if (e.message === 'Web capture port is already in use') throw e; }
  const file = path.posix.join('capture-files',opts.id,'screen.png');
  const screenshot = path.join(opts.work,file);
  await fs.mkdir(path.dirname(screenshot),{recursive:true});
  const started = Date.now();
  const run = await runCopy(opts.repo,plan.command,{timeoutMs,observe:async()=>{
    const deadline = started + timeoutMs;
    let ready = false;
    while (Date.now()<deadline) {
      try { const r=await fetch(url,{signal:AbortSignal.timeout(Math.min(400,Math.max(1,deadline-Date.now())))});if(r.ok){ready=true;break;} } catch {}
      await new Promise(r=>setTimeout(r,50));
    }
    if (!ready) throw Error('Web app readiness timeout');
    const browser=await chromium.launch();
    try {
      const page=await browser.newPage({viewport:plan.viewport || {width:1000,height:600},serviceWorkers:'block'});
      page.setDefaultTimeout(Math.max(1,deadline-Date.now()));
      // Synthetic local apps only; no remote API/model/telemetry requests.
      await page.route('**/*',route=>{
        const u=new URL(route.request().url());
        return ['http:','ws:'].includes(u.protocol) && ['127.0.0.1','localhost','[::1]'].includes(u.hostname) ? route.continue() : route.abort();
      });
      await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:Math.max(1,deadline-Date.now())});
      const steps=[];
      for(const step of plan.steps){
        page.setDefaultTimeout(Math.max(1,deadline-Date.now()));
        const target=page.locator(step.selector);
        if(step.action==='fill') await target.fill(step.value);
        if(step.action==='click') await target.click();
        if(step.action==='press') await target.press(step.value);
        if(step.action==='visible') await target.waitFor({state:'visible'});
        if(step.action==='text') {
          await page.waitForFunction(({selector,value})=>document.querySelector(selector)?.textContent.includes(value),step,{timeout:Math.max(1,deadline-Date.now())});
        }
        steps.push({...step,status:'pass'});
      }
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:screenshot,animations:"disabled"});
      return {steps,visibleText:await page.locator('body').innerText(),url:page.url(),viewport:page.viewportSize()};
    } finally {await browser.close();}
  }});
  const ok=run.observation?.ok && !run.timedOut;
  const result={...run,id:opts.id,kind:'web-run',role:opts.role || 'supporting',plan,usedFiles,
    serverExitCode:run.exitCode,exitCode:ok?0:1,error:run.observation?.error,
    ...run.observation?.value,outputs:ok?[{file,sha256:hash(await fs.readFile(screenshot))}]:[],
    provenance:{method:'Playwright Chromium; started in disposable copy',capturedAt:new Date().toISOString(),network:'loopback only',data:plan.data || 'synthetic'}};
  delete result.observation;
  await write(path.join(opts.work,'captures',opts.id+'.json'),result);
  if(ok){
    const manifestFile=path.join(opts.work,'art-manifest.json');
    const manifest=await json(manifestFile,{files:[]});
    manifest.files=(manifest.files||[]).filter(f=>f.file!==file);
    manifest.files.push({file,sha256:result.outputs[0].sha256,captureId:opts.id,template:'web-screenshot',kind:'web-run',width:result.viewport.width,height:result.viewport.height});
    await write(manifestFile,manifest);
  }
  return result;
}
