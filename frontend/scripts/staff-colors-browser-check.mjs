// Real Edge + FullCalendar with the production allocator, no DB access.
// API is mocked here; NOT production E2E.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";

const backend = path.resolve("../backend");
const verification = spawnSync(
  process.execPath,
  ["scripts/palette-preview.cjs"],
  {
    cwd: backend,
    encoding: "utf8",
  },
);
assert.equal(verification.status, 0, verification.stderr);
const fixture = JSON.parse(verification.stdout);
const assigned = fixture.staff.filter(
  (u) => !u.username.startsWith("pending_assignment"),
);
assert.equal(assigned.length, 5);
assert.equal(new Set(fixture.families).size, 5);
const requireBackend = createRequire(path.join(backend, "package.json"));
const ts = requireBackend("typescript");
const sharedBundle = ts.transpileModule(
  await readFile(
    path.join(backend, "../shared/calendar-colors.ts"),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const paletteBundle = ts.transpileModule(
  await readFile(
    path.join(backend, "src/staff-colors/color-palette.ts"),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const profile = await mkdtemp(path.join(os.tmpdir(), "shop-calendar-color-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const vite = await createServer({
  configFile: path.resolve("vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
let edge;
let ws;
try {
  await vite.listen();
  const appPort = vite.httpServer.address().port;
  const cdpPort = await freePort();
  edge = spawn(
    process.env.EDGE_PATH ||
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let targets;
  for (let i = 0; i < 100; i++) {
    try {
      targets = await (
        await fetch(`http://127.0.0.1:${cdpPort}/json`)
      ).json();
      if (targets.length) break;
    } catch {
      /* readiness */
    }
    await sleep(100);
  }
  assert.ok(targets?.length);
  ws = new WebSocket(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) =>
    ws.addEventListener("open", resolve, { once: true }),
  );
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(message.error);
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, { resolve, reject });
      ws.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error("Browser evaluation failed");
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await sleep(50);
    }
    throw new Error(`Timeout: ${expression}`);
  };
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    window.palette=(()=>{const shared={};
      new Function('exports',${JSON.stringify(sharedBundle)})(shared);
      const require=()=>shared, exports={};${paletteBundle};return exports;})();
    localStorage.clear();localStorage.setItem('shop-calendar-locale','en');
    const staff=${JSON.stringify(fixture.staff)}, assigned=${JSON.stringify(assigned)};
    const user={id:'fixture-admin',username:'fixture',displayName:'Fixture Admin',role:'ADMIN',status:'ACTIVE'};
    const auth={accessToken:'fixture-token',refreshToken:'fixture-refresh',tokenType:'Bearer',user,activeShopId:'fixture-shop'};
    window.EventSource=class{addEventListener(){} removeEventListener(){} close(){}};
    window.fetch=async(url,init={})=>{
      const u=String(url);if(init.method && init.method!=='GET' && !u.includes('/auth/'))throw Error('No business writes permitted');
      let body;
      if(u.includes('/auth/'))body=auth;
      else if(u.endsWith('/users/staff'))body=staff;
      else if(u.endsWith('/users'))body=[user,...staff];
      else if(u.includes('/system-settings/calendar-window'))body={slotMinTime:'08:00:00',slotMaxTime:'23:00:00'};
      else if(u.endsWith('/shops'))body=[{id:'fixture-shop',name:'Fixture Shop'}];
      else if(u.includes('/appointments')){
        const start=new Date();start.setHours(16,0,0,0);
        body=assigned.map((s,i)=>({id:'booking-'+i,employeeId:s.id,employeeColor:s.color,employeeDisplayName:s.displayName,
          startAt:start.toISOString(),endAt:new Date(start.getTime()+3600000).toISOString(),phone:'3125551234',price:'70',status:'SCHEDULED'}));
      }else throw Error('Unexpected fixture API');
      return new Response(JSON.stringify(body),{status:200});
    };
    window.setField=(selector,value)=>{const e=document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);
      e.dispatchEvent(new Event('input',{bubbles:true}));};
  `,
  });
  await send("Page.navigate", { url: `http://127.0.0.1:${appPort}` });
  await wait('!!document.querySelector("input[type=password]")');
  await evaluate(
    `setField('form input:not([type])','fixture');setField('input[type=password]','fixture');document.querySelector('form').requestSubmit()`,
  );
  await wait('document.querySelectorAll(".fc-timegrid-event").length===5');
  const result = await evaluate(`(()=>{
    const pixel=(color)=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');
      x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3);};
    const lum=(rgb)=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const cards=[...document.querySelectorAll('.fc-timegrid-event')].map(e=>{
      const s=getComputedStyle(e),t=getComputedStyle(e.querySelector('.calendar-event-start'));
      const a=lum(pixel(s.backgroundColor)),b=lum(pixel(t.color));
      return {border:pixel(s.borderTopColor),background:pixel(s.backgroundColor),
        leftBorderWidth:s.borderLeftWidth,computedBackground:s.backgroundColor,
        textContrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),font:parseFloat(t.fontSize)};
    });
    const hex=rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
    const min=colors=>Math.min(...colors.flatMap((c,i)=>colors.slice(i+1).map(d=>palette.colorDistance(hex(c),hex(d)))));
    const old=${JSON.stringify(fixture.before)}.map(c=>pixel('color-mix(in srgb, #0f172a 60%, '+c+' 40%)'));
    return {dark:document.body.classList.contains('theme-dark'),cards,
      families:cards.map(c=>palette.colorFamily(hex(c.border))),
      beforeMixed:old,beforeMixedMinDeltaE76:min(old),
      afterMixedMinDeltaE76:min(cards.map(c=>c.background)),
      legend:[...document.querySelectorAll('.legend-swatch')].map(e=>pixel(getComputedStyle(e).backgroundColor))};
  })()`);
  assert.equal(result.dark, true);
  const rgb = (hex) =>
    [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  for (const staff of assigned) {
    const card = result.cards.find(
      (c) => JSON.stringify(c.border) === JSON.stringify(rgb(staff.color)),
    );
    assert.ok(card);
    const expected = rgb(staff.color).map((v, i) =>
      Math.round([15, 23, 42][i] * 0.6 + v * 0.4),
    );
    assert.deepEqual(
      card.background,
      expected,
      "computed color-mix must match actual 40% sRGB formula",
    );
    assert.equal(card.leftBorderWidth, "4px");
    assert.ok(
      result.legend.some(
        (c) => JSON.stringify(c) === JSON.stringify(rgb(staff.color)),
      ),
    );
  }
  assert.ok(result.cards.every((c) => c.textContrast >= 4.5 && c.font > 0));
  assert.equal(new Set(result.families).size, 5);
  assert.ok(result.afterMixedMinDeltaE76 > result.beforeMixedMinDeltaE76 + 1);
  console.log(
    JSON.stringify({
      pass: true,
      productionAllocatorUsed: true,
      apiMocked: true,
      realEdgeAppCards: result.cards.length,
      colors: assigned.map((s) => s.color),
      families: result.families,
      computedBackgrounds: result.cards.map((c) => c.computedBackground),
      mixedRGB: result.cards.map((c) => c.background),
      beforeMixedMinDeltaE76: result.beforeMixedMinDeltaE76,
      afterMixedMinDeltaE76: result.afterMixedMinDeltaE76,
      legendAndAppointmentBordersMatch: true,
      minRenderedTextContrast: Math.min(
        ...result.cards.map((c) => c.textContrast),
      ),
      limitation:
        "5-person focused browser check; 12-person before/after screenshots are separate",
    }),
  );
} finally {
  if (ws) ws.close();
  if (edge?.pid)
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Stop-Process -Id ${edge.pid} -ErrorAction SilentlyContinue`,
      ],
      { stdio: "ignore" },
    );
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
  await vite.close();
}
