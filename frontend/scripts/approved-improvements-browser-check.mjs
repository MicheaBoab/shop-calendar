// Real Edge / FullCalendar interaction checks. All API requests are isolated
// in browser memory; never connect to a backend or database.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";

const evidence = "C:\\Users\\MicheaBoab\\.copilot\\session-state\\b841f4ee-76c5-4d53-b67a-5c63965e2be8\\files";
const backend = path.resolve("../backend");
const ts = createRequire(path.join(backend, "package.json"))("typescript");
const transpile = async (file) => ts.transpileModule(await readFile(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const shared = await transpile(path.join(backend, "../shared/calendar-colors.ts"));
const palette = await transpile(path.join(backend, "src/staff-colors/color-palette.ts"));
const profile = await mkdtemp(path.join(os.tmpdir(), "shop-calendar-approved-"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const vite = await createServer({
  configFile: path.resolve("vite.config.ts"), logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const freePort = async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
let edge, ws;
try {
  await mkdir(evidence, { recursive: true });
  await vite.listen();
  const appPort = vite.httpServer.address().port;
  assert.equal((await fetch(`http://127.0.0.1:${appPort}`)).status, 200);
  const port = await freePort();
  edge = spawn(process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert.ok(targets?.length, "Edge readiness");
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request.reject(message.error); else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); }
    throw new Error(`Timeout: ${expression}`);
  };
  const click = async text => {
    assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`), true, text);
    await sleep(100);
  };
  const screenshot = async name => {
    await sleep(150);
    const data = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(evidence, name), Buffer.from(data.data, "base64"));
  };
  await send("Page.enable");
  await send("Emulation.setTimezoneOverride", { timezoneId: "America/Chicago" });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.clear();localStorage.setItem('shop-calendar-locale','zh-CN');
    window.palette=(()=>{const shared={};new Function('exports',${JSON.stringify(shared)})(shared);
      const require=()=>shared,exports={};${palette};return exports;})();
    const user={id:'test-admin',username:'test',displayName:'测试管理员',role:'ADMIN',status:'ACTIVE'};
    const auth={accessToken:'memory-token',refreshToken:'memory-refresh',tokenType:'Bearer',user,activeShopId:'test-shop'};
    const staff=[
      {id:'emp-1',username:'anna',displayName:'测试员工甲',role:'EMPLOYEE',status:'ACTIVE',color:'#fb923c'},
      {id:'emp-2',username:'ben',displayName:'测试员工乙',role:'EMPLOYEE',status:'ACTIVE',color:'#4ade80'},
      {id:'manager-1',username:'manager',displayName:'测试经理',role:'MANAGER',status:'ACTIVE',color:'#facc15'}
    ];
    const now=new Date(),day=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const at=(offset,h,m=0)=>new Date(day.getFullYear(),day.getMonth(),day.getDate()+offset,h,m);
    window.fixtureDate={today:at(0,0),tomorrow:at(1,0)};
    let bookings=[
      {id:'appt-1',employeeId:'emp-1',employeeDisplayName:'测试员工甲',employeeColor:'#fb923c',startAt:at(0,14).toISOString(),endAt:at(0,15).toISOString(),price:'80.00',phone:'3125550101',customerName:'今天预约',status:'ACTIVE'},
      {id:'appt-2',employeeId:'emp-2',employeeDisplayName:'测试员工乙',employeeColor:'#4ade80',startAt:at(0,16).toISOString(),endAt:at(0,17).toISOString(),price:'45.00',phone:'3125550102',customerName:'已取消预约',status:'CANCELLED'},
      {id:'tomorrow',employeeId:'emp-1',employeeDisplayName:'测试员工甲',employeeColor:'#fb923c',startAt:at(1,0).toISOString(),endAt:at(1,0,30).toISOString(),price:'40.00',phone:'3125550103',customerName:'明天零点预约',status:'ACTIVE'},
      {id:'yesterday',employeeId:'emp-1',employeeDisplayName:'测试员工甲',employeeColor:'#fb923c',startAt:at(-1,23,30).toISOString(),endAt:at(0,0).toISOString(),price:'90.00',phone:'3125550104',customerName:'昨天跨天预约',status:'ACTIVE'}
    ];
    window.businessWrites=[];window.candidateHistory=[];window.fixtureConflict=false;
    const tokens=new Map();
    window.EventSource=class{addEventListener(){}removeEventListener(){}close(){}};
    window.confirm=()=>true;
    window.fetch=async(input,init={})=>{
      const url=new URL(String(input),location.href),u=url.pathname,method=init.method||'GET';let body;
      const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
      if(u.includes('/auth/'))return response(auth);
      if(method!=='GET')window.businessWrites.push({path:u,method,body:JSON.parse(init.body||'{}')});
      if(u.endsWith('/emp-1/color-preview')){
        const excluded=url.searchParams.get('excluded')?.split(',')||[];
        const candidateColor=palette.chooseColor(staff.map(s=>s.color),'#94a3b8',excluded);
        const previewToken='memory-'+tokens.size;
        body={currentColor:staff[0].color,candidateColor,previewToken};
        tokens.set(previewToken,body);window.candidateHistory.push(candidateColor);
      }else if(u.endsWith('/emp-1/color')&&method==='PATCH'){
        const dto=JSON.parse(init.body),preview=tokens.get(dto.previewToken);
        if(window.fixtureConflict||!preview||preview.currentColor!==staff[0].color||preview.candidateColor!==dto.candidateColor)
          return response({message:'预览已失效，请重新预览后确认。'},409);
        staff[0].color=dto.candidateColor;bookings.forEach(b=>{if(b.employeeId==='emp-1')b.employeeColor=dto.candidateColor;});
        body={id:'emp-1',color:dto.candidateColor};
      }else if(u.endsWith('/users/staff'))body=staff;
      else if(u.endsWith('/users'))body=[user,...staff];
      else if(u.includes('/system-settings/calendar-window'))body={slotMinTime:'08:00:00',slotMaxTime:'23:00:00'};
      else if(u.endsWith('/shops'))body=[{id:'test-shop',name:'隔离测试门店'}];
      else if(u.includes('/audit/logs'))body={items:[],total:0};
      else if(u.includes('/appointments')){
        if(method==='DELETE')bookings=bookings.filter(b=>!u.endsWith('/'+b.id));
        else if(method==='PATCH'){const dto=JSON.parse(init.body);bookings=bookings.map(b=>u.endsWith('/'+b.id)?{...b,...dto}:b);}
        else if(method!=='GET')throw Error('Unexpected appointment write');
        body=method==='GET'?bookings:{success:true};
      }else throw Error('Unexpected isolated API: '+u);
      return response(body);
    };
    window.setField=(selector,value)=>{const e=document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
  ` });
  await send("Page.navigate", { url: `http://127.0.0.1:${appPort}` });
  await wait('!!document.querySelector("input[type=password]")');
  await evaluate(`setField('form input:not([type])','test');setField('input[type=password]','test');document.querySelector('form').requestSubmit()`);
  await wait('document.querySelectorAll(".fc-timegrid-event").length===2');
  assert.equal(await evaluate('!!document.querySelector(".day-agenda")'), false);
  await click("总览");
  assert.equal(await evaluate('document.querySelectorAll(".appointment-item").length'), 2);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".summary-pill strong")].slice(0,2).map(e=>e.textContent)'), ["2", "$125.00"]);
  await screenshot("approved-01-overview-today-desktop.png");
  // OS picker is unnecessary: use the actual native date input's change event.
  await evaluate(`HTMLInputElement.prototype.showPicker=function(){};document.querySelector('button[aria-label="选择总览日期"]').click()`);
  await evaluate(`(()=>{const d=fixtureDate.tomorrow;setField('input[type=date]',d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))})()`);
  await wait('document.querySelectorAll(".appointment-item").length===1');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".summary-pill strong")].slice(0,2).map(e=>e.textContent)'), ["1", "$40.00"]);
  await screenshot("approved-02-overview-selected-date-desktop.png");
  await click("今日安排");
  assert.equal(await evaluate('document.querySelectorAll(".agenda-item").length'), 2);
  assert.equal(await evaluate('!!document.querySelector(".fc")'), false);
  await click("按员工");
  await screenshot("approved-03-agenda-independent-tab-desktop.png");
  await evaluate('document.querySelector(".agenda-item").click()');
  await wait('document.querySelectorAll(".calendar-event-editing").length===1');
  const selectedBefore = await evaluate(`(()=>{const e=document.querySelector('.calendar-event-editing');return {border:getComputedStyle(e).borderLeftColor,outline:getComputedStyle(e).outlineWidth,text:e.textContent}})()`);
  assert.equal(selectedBefore.border, "rgb(251, 146, 60)");
  assert.equal(selectedBefore.outline, "2px");
  assert.ok(selectedBefore.text.includes("正在编辑"));
  await evaluate(`document.querySelector(".calendar-event-editing").scrollIntoView({block:'center'})`);
  await screenshot("approved-04-calendar-editing-desktop.png");
  await click("取消");
  await wait('!document.querySelector(".calendar-event-editing")');
  await click("管理");
  assert.equal(await evaluate('document.querySelectorAll(".staff-color-card").length'), 2);
  assert.equal(await evaluate('/#[0-9a-f]{6}/i.test(document.querySelector(".staff-color-list").textContent)'), false);
  await click("重新分配");
  await click("换一个颜色");
  await click("换一个颜色");
  assert.equal(await evaluate('new Set(candidateHistory).size'), 3);
  assert.equal(await evaluate('businessWrites.length'), 0);
  await evaluate('document.querySelector(".staff-color-list").scrollIntoView({block:"center"})');
  await screenshot("approved-05-color-preview-fixed-actions-desktop.png");
  await click("取消");
  assert.equal(await evaluate('businessWrites.length'), 0);
  await click("重新分配");
  await click("换一个颜色");
  const chosen = await evaluate('candidateHistory.at(-1)');
  await click("确认使用");
  await wait('!document.querySelector(".staff-color-preview")');
  assert.equal(await evaluate('businessWrites.at(-1).body.candidateColor'), chosen);
  await click("日历");
  await wait('document.querySelectorAll(".fc-timegrid-event").length===2');
  assert.equal(await evaluate(`getComputedStyle([...document.querySelectorAll('.fc-timegrid-event')].find(e=>e.textContent.includes('今天预约'))).borderLeftColor`),
    await evaluate(`(()=>{const e=document.createElement('span');e.style.color=${JSON.stringify(chosen)};document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c})()`));
  await click("管理"); await click("重新分配");
  await evaluate('window.fixtureConflict=true');
  await click("确认使用");
  await wait('!!document.querySelector("dialog[open]")');
  assert.equal(await evaluate('!!document.querySelector(".staff-color-preview")'), false);
  await evaluate('document.querySelector("dialog button").click();window.fixtureConflict=false');
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click("重新分配");
  await evaluate('document.querySelector(".staff-color-list").scrollIntoView({block:"center"})');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true, "mobile color layout");
  await screenshot("approved-06-color-preview-mobile.png");
  await click("今日安排");
  await evaluate('window.scrollTo(0,0)');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true, "mobile tab layout");
  await screenshot("approved-07-agenda-mobile.png");
  await evaluate('document.querySelector(".agenda-item").click()');
  await wait('!!document.querySelector(".calendar-event-editing")');
  await evaluate('document.querySelector(".calendar-event-editing").scrollIntoView({block:"center"})');
  await screenshot("approved-08-calendar-editing-mobile.png");
  await click("删除预约");
  await wait('!document.querySelector(".calendar-event-editing")');
  console.log(JSON.stringify({
    pass: true, apiMocked: true, realDatabaseAccess: false, timezone: "America/Chicago",
    checks: ["overview local midnight/date switch", "agenda independent tab/group/edit", "distinct production allocator candidates",
      "cancel without writes", "confirm exact candidate and snapshots", "stale preview error", "employee color preserved",
      "highlight cancel/delete/navigation", "390px responsive tabs/colors"],
    screenshots: 8, evidence, cleanup: "temporary Edge profile and owned processes closed in finally",
  }));
} finally {
  if (ws) ws.close();
  if (edge?.pid) spawnSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${edge.pid} -ErrorAction SilentlyContinue`], { stdio: "ignore" });
  await vite.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
