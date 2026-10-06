/* Deterministic real-Chrome integration tests. No npm dependencies or live arXiv calls.
 * Run: node tests/reader-browser.cjs [checkout-path]
 * Requires Node >=22 and Google Chrome (CHROME_BIN can override its executable).
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const chinese = fs.readFileSync(path.join(root, 'js/data-config.js'), 'utf8').includes("repoName: 'hepstoday-cn'");
const language = chinese ? 'Chinese' : 'English';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heps-reader-browser-'));
const shotDir = process.env.HEPS_SCREENSHOTS || tmp;
fs.mkdirSync(shotDir, { recursive: true });
const sample = (id, title) => ({ id, title, authors: ['Alice Smith', 'Bob Jones'], categories: ['hep-th', 'hep-ph'],
  abs: 'https://arxiv.org/abs/' + id, summary: 'Original abstract: integration-by-parts and two-loop integrals.',
  AI: { tldr: title + ': a numerical and analytical study.', motivation: 'Understand the integral.', method: 'Differential equations.', result: 'An explicit solution.', conclusion: 'Reusable reduction method.' } });
const data = {
  '2026-10-05': [sample('2610.00001', 'Canonical differential equations for Feynman integrals'),
    sample('2610.00002', 'Dark matter production'), sample('2610.00003', '<img src=x onerror=alert(1)> Literal title')],
  '2026-10-03': [sample('2610.00001', 'Canonical differential equations for Feynman integrals'), sample('2610.00004', 'Tensor networks')]
};
let failed = new Set(), malformed = new Set(), delay = new Map(), noManifest = false;
const counts = {};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__manifest') {
    res.writeHead(noManifest ? 503 : 200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end(noManifest ? 'Unavailable' : Object.keys(data).map(date => `${date}_AI_enhanced_${language}.jsonl`).join('\n')); return;
  }
  if (url.pathname.startsWith('/__data/')) {
    const date = url.pathname.slice('/__data/'.length); counts[date] = (counts[date] || 0) + 1;
    if (delay.get(date)) await new Promise(resolve => setTimeout(resolve, delay.get(date)));
    if (failed.has(date)) { res.writeHead(503); res.end('Unavailable'); return; }
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    res.end((data[date] || []).map(row => JSON.stringify(row)).join('\n') + (malformed.has(date) ? '\n{broken' : '')); return;
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const content = fs.readFileSync(file);
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, socket, session, nextId = 0;
const pending = new Map(), errors = [];
function send(method, params = {}, sid = session) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function waitFor(expression, message, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(50); }
  throw new Error('Timeout: ' + message + '\nPage: ' + await evaluate('document.body.innerText.slice(0, 1800)'));
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = value => evaluate(`(() => { const input=document.getElementById('textSearchInput'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
async function navigate(url) {
  await send('Page.navigate', { url });
  await waitFor('!!document.getElementById("readerMode")', 'reader mounts');
  await waitFor('!!document.getElementById("readerCount")?.textContent', 'initial data/empty state rendered');
  await sleep(100);
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(shotDir, `${language.toLowerCase()}-${name}.png`), Buffer.from(result.data, 'base64'));
}
function ok(name) { console.log('PASS ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + path.join(tmp, 'profile'), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Chrome did not start: ' + output)), 15000);
    chrome.once('error', reject); chrome.stderr.on('data', chunk => {
      output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const task = pending.get(message.id); if (!task) return;
      clearTimeout(task.timer); pending.delete(message.id);
      message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const operation = request.url.startsWith(origin) ? send('Fetch.continueRequest', { requestId }, message.sessionId)
        : send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: '' }, message.sessionId);
      operation.catch(error => errors.push(error.message));
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('assets/file-list.txt')) return realFetch(location.origin + '/__manifest', options);
      const match = url.match(/data\\/(\\d{4}-\\d{2}-\\d{2})_AI_enhanced_/);
      if (match) return realFetch(location.origin + '/__data/' + match[1], options);
      if (url.includes('api.github.com')) return Promise.resolve(new Response(JSON.stringify({ stargazers_count: 1, forks_count: 1 })));
      return realFetch(input, options);
    };` });
  await navigate(origin + '/');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 3);
  assert.equal(await evaluate('document.documentElement.lang'), chinese ? 'zh-CN' : 'en');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards img").length'), 0);
  assert.match(await evaluate('document.getElementById("readerStatus").textContent'), /1\/1/);
  ok('initial load, localized labels, honest completeness and HTML-safe rendering');
  await fill('canonical');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 3);
  await evaluate('document.getElementById("readerMode").value="filter"; document.getElementById("readerMode").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 1);
  ok('matching-first versus matching-only');
  await click('.reader-paper-title');
  assert.equal(await evaluate('document.getElementById("paperModal").classList.contains("active")'), true);
  assert.equal(await evaluate('document.querySelectorAll("#modalBody iframe").length'), 0);
  assert.equal(await evaluate('localStorage.getItem("heps.reader.v1")'), null);
  await click('.reader-pdf button');
  assert.equal(await evaluate('document.querySelectorAll("#modalBody iframe").length'), 1);
  await click('#closeModal');
  await waitFor('!document.getElementById("paperModal").classList.contains("active") && document.querySelectorAll(".reader-cards .paper-card").length===1', 'back from modal restores filtered list');
  assert.equal(await evaluate('document.getElementById("textSearchInput").value'), 'canonical');
  ok('opening does not mark read; PDF is opt-in; modal Back restores view');
  await click('.reader-cards [data-mark="star"]');
  await click('.reader-cards [data-mark="later"]');
  await click('.reader-cards [data-mark="read"]');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("heps.reader.v1")).entries["2610.00001"].read'), true);
  await click('[data-reading="unread"]');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 0);
  await click('[data-reading="star"]');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 1);
  await evaluate('loadPapersByDate("2026-10-03")'); await sleep(220);
  await navigate(await evaluate('location.href'));
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 1);
  ok('independent reading marks, cross-date saved list and refresh persistence');
  await navigate(origin + '/?date=2026-10-05&paper=2610.00002');
  await waitFor('document.getElementById("paperModal").classList.contains("active")', 'permalink opens exact paper');
  assert.match(await evaluate('document.getElementById("modalTitle").textContent'), /Dark matter/);
  await click('#closeModal');
  ok('standalone paper permalinks');
  failed.add('2026-10-03');
  await navigate(origin + '/?from=2026-10-03&to=2026-10-05');
  await waitFor('document.getElementById("readerStatus").textContent.includes("2026-10-03") && document.querySelector(".reader-status-warning")', 'visible partial-load warning');
  const successfulCount = counts['2026-10-05'];
  failed.clear(); await click('#readerStatus button');
  await waitFor('document.getElementById("readerStatus").textContent.includes("2/2")', 'failed day retried');
  assert.equal(counts['2026-10-05'], successfulCount);
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 4);
  ok('partial loads are visible, retry only fetches failures, cross-day deduplication');
  assert.equal(await evaluate('document.querySelector("[data-category=all] .category-count").textContent'), '4');
  assert.equal(await evaluate('document.querySelector("[data-category=hep-ph] .category-count").textContent'), '4');
  await click('[data-category="hep-ph"]');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 4);
  await click('[data-category="all"]');
  ok('category counts use unique IDs and include cross-listed papers');
  await screenshot('desktop');
  malformed.add('2026-10-03');
  await navigate(origin + '/?from=2026-10-03&to=2026-10-05');
  await waitFor('!!document.querySelector(".reader-status-warning")', 'malformed file is a failure, not a partial success');
  malformed.clear(); ok('truncated JSONL cannot masquerade as a complete day');
  delay.set('2026-10-03', 600);
  await navigate(origin + '/');
  await evaluate('loadPapersByDate("2026-10-03"); setTimeout(() => loadPapersByDate("2026-10-05"), 20)');
  await sleep(900);
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 3);
  assert.equal(await evaluate('currentDate'), '2026-10-05');
  delay.clear(); ok('late responses cannot overwrite a newer date selection');
  await evaluate('loadPapersByDate("2026-10-01")');
  assert.match(await evaluate('document.getElementById("readerStatus").textContent'), /0\/0/);
  ok('unindexed dates are not presented as verified no-announcement days');
  await navigate(origin + '/');
  const beforeImport = await evaluate('localStorage.getItem("heps.reader.v1")');
  await evaluate(`(() => { const dt=new DataTransfer(); dt.items.add(new File(['{"schema":7,"entries":{}}'], 'bad.json', {type:'application/json'})); const input=document.getElementById('readerImport'); input.files=dt.files; input.dispatchEvent(new Event('change')); })()`);
  await waitFor('!!document.getElementById("readerNotice").textContent', 'invalid import reports failure');
  assert.equal(await evaluate('localStorage.getItem("heps.reader.v1")'), beforeImport);
  ok('invalid imports preserve the existing reading list');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('window.scrollTo(0, 0)'); await sleep(100);
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'Mobile page has horizontal overflow');
  await screenshot('mobile');
  await click('.reader-paper-title');
  assert(await evaluate('document.getElementById("paperModal").getBoundingClientRect().width <= window.innerWidth + 1'));
  await screenshot('mobile-modal'); await click('#closeModal');
  ok('390px mobile layout and dialog stay within viewport');
  noManifest = true;
  await navigate(origin + '/?reading=star');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 1);
  assert.match(await evaluate('document.getElementById("readerStatus").textContent'), chinese ? /索引/ : /index/);
  noManifest = false; ok('saved reading list remains accessible when the manifest is unavailable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const get=Storage.prototype.getItem, set=Storage.prototype.setItem;
    Storage.prototype.getItem=function(key) { if(key==='heps.reader.v1') throw new DOMException('Blocked','SecurityError'); return get.call(this,key); };
    Storage.prototype.setItem=function(key,value) { if(key==='heps.reader.v1') throw new DOMException('Blocked','SecurityError'); return set.call(this,key,value); };` });
  await navigate(origin + '/');
  await click('.reader-cards [data-mark="star"]');
  await click('[data-reading="star"]');
  assert.equal(await evaluate('document.querySelectorAll(".reader-cards .paper-card").length'), 1);
  assert.match(await evaluate('document.getElementById("readerStorage").textContent'), chinese ? /不可用/ : /unavailable/);
  ok('blocked storage degrades to session-only state with a warning');
  assert.deepEqual(errors, [], 'Unexpected browser exceptions');
  console.log(`All browser checks passed for ${language}. Screenshots: ${shotDir}`);
})().catch(error => { console.error(error.stack || error); console.error('Browser exceptions:', errors); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (chrome) { chrome.kill('SIGTERM'); await sleep(300); if (chrome.exitCode === null) chrome.kill('SIGKILL'); }
  await new Promise(resolve => server.close(resolve));
  for (const task of pending.values()) clearTimeout(task.timer);
  try { fs.rmSync(path.join(tmp, 'profile'), { recursive: true, force: true }); } catch {}
});
