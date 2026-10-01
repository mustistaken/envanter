const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness() {
  const scope = 'https://mustistaken.github.io/envanter/';
  const handlers = new Map(), records = new Map(), writes = [];
  const key = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const cache = {
    async match(request) { return records.get(key(request))?.clone(); },
    async put(request, response) { writes.push(key(request)); records.set(key(request), response); }
  };
  const context = vm.createContext({
    URL, Response, AbortController, setTimeout, clearTimeout,
    self: { location: {origin:new URL(scope).origin}, registration:{scope}, addEventListener:(name,fn)=>handlers.set(name,fn) },
    caches: {open:async()=>cache}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','service-worker.js'),'utf8'),context);
  function request(url, mode='cors') {
    let promise;
    handlers.get('fetch')({request:{method:'GET',url:new URL(url,scope).href,mode},respondWith:value=>{promise=value;}});
    return promise;
  }
  return {context,records,writes,request,scope};
}

test('cached versioned assets load without another network request', async () => {
  const h=harness();
  h.records.set(h.scope+'app.js?v=14.37',new Response('current app'));
  h.context.fetch=()=>assert.fail('Cached app should load locally');
  const response=await h.request('app.js?v=14.37');
  assert.equal(await response.text(),'current app');
});

test('offline requests cannot substitute a different JS release', async () => {
  const h=harness();
  h.records.set(h.scope+'app.js?v=14.37',new Response('current app'));
  h.context.fetch=async()=>{throw new Error('offline');};
  const response=await h.request('app.js?v=14.35');
  assert.equal(response.status,503);
});

test('failed navigation falls back to the saved application', async () => {
  const h=harness();
  h.records.set(h.scope+'index.html',new Response('saved app'));
  h.context.fetch=async()=>new Response('server error',{status:503});
  const response=await h.request('./','navigate');
  assert.equal(response.status,200);
  assert.equal(await response.text(),'saved app');
  assert.equal(h.writes.length,0);
});

test('navigation timeout covers a stalled HTML body and uses the saved app', async () => {
  const h=harness();
  h.records.set(h.scope+'index.html',new Response('saved app'));
  let expire, started;
  const bodyStarted=new Promise(resolve=>{started=resolve;});
  h.context.setTimeout=fn=>{expire=fn;return 1;};
  h.context.clearTimeout=()=>{};
  h.context.fetch=async(url,{signal})=>({ok:true,clone:()=>({arrayBuffer:()=>{
    started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  }})});
  const navigation=h.request('./','navigate');
  await bodyStarted;
  expire();
  const response=await navigation;
  assert.equal(await response.text(),'saved app');
});

test('Google Sheets requests are not intercepted or cached', () => {
  const h=harness();
  assert.equal(h.request('https://docs.google.com/spreadsheets/d/example/gviz/tq'),undefined);
  assert.equal(h.writes.length,0);
});
