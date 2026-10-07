/* Diagnostic smoke check against the actual public sites.
 * No fixtures, local server, request interception or injected application code.
 * Run: node tests/reader-live.cjs [cn|en|both]
 * Evidence is saved outside the checkout in an OS temporary directory.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heps-live-'));
const evidence = process.env.HEPS_EVIDENCE || tmp;
fs.mkdirSync(evidence, { recursive: true });
let chrome, socket, next = 0;
const pending = new Map(), pages = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
  });
}
async function value(sid, expression) {
  const r = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, userGesture: true}, sid);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function click(sid, selector) {
  await value(sid, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center'})`);
  await sleep(400);
  const point = await value(sid, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,visible:e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),hit:e===hit||e.contains(hit),blocking:hit?.outerHTML.slice(0,200)};})()`);
  if(!point.visible || !point.hit) throw new Error('Cannot click '+selector+': '+JSON.stringify(point));
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1},sid);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1},sid);
}
const snapshot = `(() => ({url:location.href,ready:document.readyState,title:document.title,lang:document.documentElement.lang,
 status:document.getElementById('readerStatus')?.innerText,count:document.getElementById('readerCount')?.innerText,
 cards:document.querySelectorAll('.paper-card').length,firstId:document.querySelector('.paper-card')?.dataset.id,
 firstTitle:document.querySelector('.paper-card h3')?.innerText,body:document.body?.innerText.slice(0,2800),
 scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src),
 dates:typeof availableDates==='undefined'?null:availableDates.slice(0,10),
 functions:{reader:typeof window.HepsReader,core:typeof window.HepsReaderCore,load:typeof loadPapersByDate,render:typeof renderPapers},
 viewport:{width:innerWidth,scrollWidth:document.documentElement.scrollWidth},
 calendar:{modal:document.getElementById('datePickerModal')?.className,visible:document.querySelector('.flatpickr-calendar')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),parent:document.querySelector('.flatpickr-calendar')?.parentElement.className},
 ui:{search:document.getElementById('textSearchInput')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),panel:document.querySelector('.reader-panel')?.getBoundingClientRect().toJSON()}
}))()`;
async function shot(sid, name) {
  try {
    const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));
  } catch(error) {
    const info=pages.get(sid); (info.screenshotErrors ||= []).push({name,error:error.message});
    console.warn('Screenshot capture failed:', name, error.message);
  }
}
async function check(site) {
  const target=await send('Target.createTarget',{url:'about:blank'});
  const sid=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  const info={site,started:new Date().toISOString(),exceptions:[],consoleErrors:[],failed:[],responses:[],requests:{},snapshots:[]};
  pages.set(sid,info);
  await send('Page.enable',{},sid); await send('Runtime.enable',{},sid); await send('Network.enable',{},sid);
  await send('Log.enable',{},sid);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false},sid);
  try {
  await send('Page.navigate',{url:`https://${site}.heps.today/`},sid);
  for (const wait of [5000,15000,20000]) {
    await sleep(wait);
    const s=await value(sid,snapshot); info.snapshots.push(s);
    console.log(JSON.stringify({site,observed:new Date().toISOString(),cards:s.cards,status:s.status,count:s.count,exceptions:info.exceptions,calendar:s.calendar}));
    if(s.cards>0) break;
  }
  await shot(sid,site+'-desktop');
  const current=info.snapshots.at(-1);
  if(current.cards>0) {
    const id=current.firstId;
    await value(sid,`(()=>{const el=document.getElementById('textSearchInput');el.value=${JSON.stringify('id:'+id)};el.dispatchEvent(new Event('input',{bubbles:true}));const mode=document.getElementById('readerMode');mode.value='filter';mode.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await sleep(400);
    info.search=await value(sid,snapshot);
    await click(sid,'.paper-card .reader-paper-title');
    await sleep(500);
    info.detail=await value(sid,"({open:document.getElementById('paperModal').classList.contains('active'),title:document.getElementById('modalTitle').innerText,text:document.getElementById('modalBody').innerText.slice(0,1800),pdfFrames:document.querySelectorAll('iframe').length,url:location.href})");
    await shot(sid,site+'-detail');
    await click(sid,'#closeModal');
    await sleep(300);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sid);
    await sleep(400); await shot(sid,site+'-mobile');
    info.mobile=await value(sid,"({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll('.paper-card').length})");
    await click(sid,'.paper-card [data-mark="star"]');
    await click(sid,'[data-reading="star"]');
    info.saved=await value(sid,"({count:document.getElementById('readerCount').innerText,pressed:document.querySelector('.paper-card [data-mark=star]')?.getAttribute('aria-pressed'),stored:!!localStorage.getItem('heps.reader.v1')})");
    await click(sid,'#calendarButton');
    await sleep(400); await shot(sid,site+'-calendar');
    info.calendarOpen=await value(sid,"({active:document.getElementById('datePickerModal').classList.contains('active'),calendarVisible:document.querySelector('.flatpickr-calendar')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),days:document.querySelectorAll('.flatpickr-day:not(.flatpickr-disabled)').length})");
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sid);
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sid);
    await sleep(400);
    await click(sid,'#textSearchClear');
    await value(sid,"document.addEventListener('heps:load-status',e=>window.__auditLoad=e.detail)");
    for(const range of (process.env.HEPS_FULL_HISTORY === '1' ? ['week','history'] : ['week'])) {
      await value(sid,'window.__auditLoad=null');
      await click(sid,`[data-range="${range}"]`);
      const start=Date.now();let done=false;
      while(Date.now()-start<90000) {
        const status=await value(sid,'window.__auditLoad');
        if(status && !status.loading){done=true;break;}
        await sleep(500);
      }
      info[range]={done,load:await value(sid,'window.__auditLoad'),count:await value(sid,"document.getElementById('readerCount').innerText")};
      console.log('RANGE '+JSON.stringify({site,range,...info[range]}));
      await shot(sid,site+'-'+range);
      if(!done)process.exitCode=1;
    }
  }
  if(!current.cards || info.exceptions.length || !info.detail?.open || info.search?.cards !== 1 || info.saved?.pressed !== 'true' || !info.calendarOpen?.active || info.mobile?.scrollWidth > info.mobile?.viewport) throw new Error('One or more live reader checks failed');
  } catch(error) {
    info.checkError=error.message; process.exitCode=1;
    console.error('LIVE CHECK FAILED',site,error.message);
  }
  info.finished=new Date().toISOString();
  const output={...info}; delete output.requests;
  fs.writeFileSync(path.join(evidence,site+'-report.json'),JSON.stringify(output,null,2));
  console.log('RESULT '+JSON.stringify({site,search:info.search?.count,detailOpen:info.detail?.open,mobile:info.mobile,saved:info.saved,calendarOpen:info.calendarOpen,exceptions:info.exceptions,failed:info.failed}));
  if(info.exceptions.length || info.checkError || info.week?.load?.failed?.length) process.exitCode=1;
}
(async()=>{
  chrome=spawn(process.env.CHROME_BIN||'google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(tmp,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Chrome did not start: '+output)),15000);
    chrome.once('error',reject);chrome.stderr.on('data',chunk=>{output+=chunk;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
  });
  socket=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const m=JSON.parse(String(event.data));
    if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}
    const info=pages.get(m.sessionId);if(!info)return;
    if(m.method==='Runtime.exceptionThrown')info.exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.method==='Runtime.consoleAPICalled'&&['error','warning','warn'].includes(m.params.type))info.consoleErrors.push(m.params.args.map(a=>a.value||a.description).join(' '));
    if(m.method==='Network.requestWillBeSent')info.requests[m.params.requestId]=m.params.request.url;
    if(m.method==='Network.loadingFailed')info.failed.push({url:info.requests[m.params.requestId],error:m.params.errorText,cors:m.params.corsErrorStatus});
    if(m.method==='Network.responseReceived'){
      const r=m.params.response;
      if(/heps\.today|file-list|AI_enhanced|runtime-fixes|reader/.test(r.url)||r.status>=400)info.responses.push({url:r.url,status:r.status,type:m.params.type,cache:r.fromDiskCache||false});
    }
    if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')info.consoleErrors.push(m.params.entry.text);
  });
  const arg=process.argv[2]||'both';
  if(!['cn','en','both'].includes(arg)) throw new Error('Usage: node tests/reader-live.cjs [cn|en|both]');
  await Promise.all((arg==='both'?['cn','en']:[arg]).map(check));
  console.log('EVIDENCE '+evidence);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome?.kill();for(const p of pending.values())clearTimeout(p.timer);});
