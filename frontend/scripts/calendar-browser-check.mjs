// Native FullCalendar fixture, not a logged-in App/backend E2E.
// Uses the installed Vite, Node's WebSocket and local Edge; no new dependencies.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function assertCards(cards) {
  if (cards.length !== 3 || cards.some(card =>
    card.start !== '04:00 PM' || card.end !== '04:30 PM' ||
    card.crossed || card.clipped || parseFloat(card.font) <= 0 ||
    card.topStart > card.height / 2 || card.bottomEnd > card.height / 2 ||
    card.startLeft < 0 || card.startLeft > card.width / 2 ||
    card.endLeft < 0 || card.endLeft > card.width / 2)) {
    throw new Error('Expected three legible AM/PM cards anchored at upper/lower left');
  }
  if (cards.some((box, index) => cards.slice(index + 1).some(other =>
    box.left < other.right - 0.5 && other.left < box.right - 0.5 &&
    box.top < other.bottom - 0.5 && other.top < box.bottom - 0.5))) {
    throw new Error('Appointments do not have independent event boxes');
  }
}

const script = `
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import FullCalendar from '@fullcalendar/react';
import timeGrid from '@fullcalendar/timegrid';
import interaction from '@fullcalendar/interaction';
import {CalendarEventBox,CalendarFrame,centerCurrentTime} from '/src/calendar-presentation.tsx';
import {deriveCalendarBusinessHours,deriveCalendarDisplayWindow,normalizeCalendarWindowSettings} from '/src/calendar-time-window.ts';
import '/src/styles.css';
const businessWindow=normalizeCalendarWindowSettings();
const displayWindow=deriveCalendarDisplayWindow(businessWindow);
const RealDate=Date; const fixed=new RealDate(); fixed.setHours(16,15,0,0);
window.Date=class extends RealDate {
  constructor(...args){super(...(args.length?args:[fixed.getTime()]));}
  static now(){return fixed.getTime();}
  static [Symbol.hasInstance](value){return value instanceof RealDate;}
};
const H=React.createElement;
function Fixture(){
  const ref=useRef(null), consumed=useRef(false);
  const [business,setBusiness]=useState(businessWindow);
  const displayWindow=deriveCalendarDisplayWindow(business);
  const [ready,setReady]=useState(false), [view,setView]=useState('timeGridThreeDay'), [shown,setShown]=useState(true);
  window.consumed=consumed; window.changeView=setView; window.showCalendar=setShown; window.setBusiness=setBusiness;
  useEffect(()=>{const timer=setTimeout(()=>setReady(true),120);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{if(ref.current)window.api=ref.current.getApi();},[ready,view,shown]);
  const events=Array.from({length:3},(_,i)=>({
    id:String(i),title:'Employee Name • Customer Name',
    start:new Date(fixed.getFullYear(),fixed.getMonth(),fixed.getDate(),16,0),
    end:new Date(fixed.getFullYear(),fixed.getMonth(),fixed.getDate(),16,30),
    extendedProps:{note:'Complete long appointment note'},backgroundColor:'#234567'
  }));
  const content=({event})=>H(CalendarEventBox,{start:event.start,end:event.end,locale:'en-US',
    title:event.title,note:event.extendedProps.note});
  return shown ? H(CalendarFrame,{ready,layoutKey:view,...displayWindow,consumed},
    H(FullCalendar,{ref,key:view,plugins:[timeGrid,interaction],initialView:view,initialDate:fixed,
      views:{timeGridThreeDay:{type:'timeGrid',duration:{days:3}}},
      nowIndicator:true,now:fixed,allDaySlot:false,
      businessHours:ready?deriveCalendarBusinessHours(business):false,selectable:true,
      slotMinTime:ready?displayWindow.slotMinTime:'07:00:00',slotMaxTime:ready?displayWindow.slotMaxTime:'23:00:00',
      slotDuration:'00:30:00',slotEventOverlap:false,eventMinHeight:22,height:500,headerToolbar:false,
      rerenderDelay:40,
      eventContent:content,events,datesSet:()=>{window.api=ref.current?.getApi();}})) : null;
}
createRoot(document.getElementById('root')).render(H(Fixture));
const compactStyle=document.createElement('style');
compactStyle.textContent='.compact .fc .fc-timegrid-slot {height:1em}';
document.head.append(compactStyle);
window.measure=()=>{
  const root=document.getElementById('root');
  const s=root.querySelector('.fc-timegrid-slots tr').closest('.fc-scroller');
  const sr=s.getBoundingClientRect(), line=root.querySelector('.fc-timegrid-now-indicator-line');
  const lr=line?.getBoundingClientRect();
  const slots=[...root.querySelectorAll('.fc-timegrid-slots .fc-timegrid-slot-lane[data-time]')];
  return {consumed:window.consumed.current,scrollTop:s.scrollTop,
    configuredSlotMin:window.api.getOption('slotMinTime'),
    configuredSlotMax:window.api.getOption('slotMaxTime'),
    firstSlot:slots[0]?.dataset.time,lastSlot:slots.at(-1)?.dataset.time,
    centerError:lr?Math.abs(lr.top-(sr.top+s.clientTop+s.clientHeight/2)):null,
    lineCount:root.querySelectorAll('.fc-timegrid-now-indicator-line').length,
    cards:[...root.querySelectorAll('.fc-timegrid-event')].map(e=>{
      const a=e.querySelector('.calendar-event-start'),b=e.querySelector('.calendar-event-end');
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(),er=e.getBoundingClientRect();
      return {start:a.textContent,end:b.textContent,width:er.width,height:er.height,
        topStart:ar.top-er.top,bottomEnd:er.bottom-br.bottom,left:er.left,right:er.right,top:er.top,bottom:er.bottom,
        crossed:ar.bottom>br.top+.1,clipped:a.scrollWidth>a.clientWidth || b.scrollWidth>b.clientWidth,
        startLeft:ar.left-er.left,endLeft:br.left-er.left,
        font:getComputedStyle(a).fontSize,details:getComputedStyle(e.querySelector('.calendar-event-details')).visibility};
    })};
};
window.boundary=(hour,minute=0,second=0)=>{
  const root=document.getElementById('root'),s=root.querySelector('.fc-timegrid-slots tr').closest('.fc-scroller');
  const t=new RealDate(fixed);t.setHours(hour,minute,second,0);
  centerCurrentTime(root,displayWindow.slotMinTime,displayWindow.slotMaxTime,t);
  return {scrollTop:s.scrollTop,max:s.scrollHeight-s.clientHeight};
};
window.repeat=()=>{
  const s=document.querySelector('.fc-timegrid-slots tr').closest('.fc-scroller');
  s.scrollTop=123; window.api.getEvents()[0].setProp('title','Refreshed');
};
window.shading=()=>{
  const root=document.getElementById('root');
  const slots=[...root.querySelectorAll('.fc-timegrid-slots .fc-timegrid-slot-lane[data-time]')];
  const minutes=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};
  const min=minutes(window.api.getOption('slotMinTime')),max=minutes(window.api.getOption('slotMaxTime'));
  const business=window.api.getOption('businessHours');
  const start=minutes(business.startTime),end=minutes(business.endTime);
  const first=slots[0].getBoundingClientRect(),last=slots.at(-1).getBoundingClientRect();
  const y=m=>first.top+(last.bottom-first.top)*(m-min)/(max-min);
  const expected=[[min,start],[end,max]].filter(([a,b])=>b>a).map(([a,b])=>({top:y(a),bottom:y(b)}));
  const columns=[...root.querySelectorAll('.fc-timegrid-col[data-date]')].map(col=>{
    const bands=[...col.querySelectorAll('.fc-non-business')].map(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      return {top:r.top,bottom:r.bottom,pattern:s.backgroundImage,color:s.backgroundColor,
        opacity:s.opacity,pointerEvents:s.pointerEvents};
    }).sort((a,b)=>a.top-b.top);
    const midpoint=y((start+end)/2);
    return {date:col.dataset.date,bands,inside:bands.filter(r=>r.top<midpoint&&r.bottom>midpoint).length,
      columnBackground:getComputedStyle(col).backgroundImage};
  });
  const scroller=slots[0].closest('.fc-scroller'),saved=scroller.scrollTop;
  let backgroundHit=false;
  for(const band of root.querySelector('.fc-timegrid-col[data-date]').querySelectorAll('.fc-non-business')){
    const before=band.getBoundingClientRect(),viewport=scroller.getBoundingClientRect();
    scroller.scrollTop+=before.top-viewport.top-scroller.clientHeight/2+before.height/2;
    const r=band.getBoundingClientRect(),sr=scroller.getBoundingClientRect();
    const py=(Math.max(r.top,sr.top)+Math.min(r.bottom,sr.bottom))/2;
    backgroundHit ||= !!document.elementFromPoint(r.left+r.width/2,py)?.closest('.fc-non-business');
    scroller.scrollTop=saved;
  }
  const card=root.querySelector('.fc-timegrid-event');
  let eventHit=false;
  if(card){
    const r=card.getBoundingClientRect(),sr=scroller.getBoundingClientRect();
    scroller.scrollTop+=r.top-sr.top-scroller.clientHeight/2+r.height/2;
    const visible=card.getBoundingClientRect();
    eventHit=!!document.elementFromPoint(visible.left+visible.width/2,visible.top+visible.height/2)?.closest('.fc-timegrid-event');
    scroller.scrollTop=saved;
  }
  return {expected,columns,backgroundHit,business,events:window.api.getEvents().length,
    eventHit,
    nowPointer:!!root.querySelector('.fc-timegrid-now-indicator-arrow'),
    todayHeader:getComputedStyle(root.querySelector('.fc-col-header-cell.fc-day-today')||root).backgroundImage};
};
`;

function assertShading(result, columnCount) {
  if (result.columns.length !== columnCount || result.backgroundHit || result.events !== 3 ||
    JSON.stringify(result.business.daysOfWeek) !== '[0,1,2,3,4,5,6]') {
    throw new Error('Background wiring, pointer hit-through or appointment list changed: ' + JSON.stringify(result));
  }
  for (const column of result.columns) {
    if (column.inside !== 0 || column.bands.length !== result.expected.length) {
      throw new Error('Business interior/weekend was shaded: ' + JSON.stringify(column));
    }
    column.bands.forEach((band, i) => {
      const expected = result.expected[i];
      if (Math.abs(band.top - expected.top) > 2 || Math.abs(band.bottom - expected.bottom) > 2 ||
        !band.pattern.includes('repeating-linear-gradient') || band.color !== 'rgb(13, 18, 25)' ||
        band.opacity !== '0.3' || band.pointerEvents !== 'none') {
        throw new Error('Before/after business geometry or computed style incorrect: ' + JSON.stringify({band, expected}));
      }
    });
  }
}

const server = await createServer({
  server: { host: '127.0.0.1', port: 5186, strictPort: true },
  plugins: [{
    name: 'calendar-geometry-fixture',
    resolveId(id) { if (id === '/geometry-check.js') return id; },
    load(id) { if (id === '/geometry-check.js') return script; },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/geometry-check') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/geometry-check', '<html><body style="margin:0"><div id="root"></div><script type="module" src="/geometry-check.js"></script></body></html>'));
      });
    },
  }],
});
const profile = await mkdtemp(path.join(os.tmpdir(), 'shop-calendar-geometry-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let edge;
let ws;
try {
  await server.listen();
  edge = spawn(process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9337', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  edge.on('error', error => console.error('Edge launch failed:', error.message));
  let targets;
  for (let i = 0; i < 100; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9337/json')).json();
      if (targets.length) break;
    } catch { /* wait for DevTools readiness */ }
    await sleep(100);
  }
  if (!targets?.length) throw new Error('Edge DevTools did not become ready');
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(message.error);
      else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      console.error('Browser exception:', message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  for (const width of [1280, 390]) {
    let viewScenarios = 0;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:5186/geometry-check' });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      ready = await evaluate('Boolean(window.measure && window.consumed?.current)');
      if (ready) break;
    }
    if (!ready) throw new Error('Fixture not ready: ' + await evaluate('document.body.innerText'));
    await sleep(300);
    const measured = await evaluate('window.measure()');
    console.log(JSON.stringify({ width, ...measured }));
    if (measured.centerError === null || measured.centerError > 3) {
      throw new Error('Geometry assertion failed');
    }
    assertCards(measured.cards);
    const shading = await evaluate('window.shading()');
    assertShading(shading, 3);
    if (!shading.nowPointer || !shading.todayHeader.includes('linear-gradient') ||
      !shading.columns.some(col => col.columnBackground.includes('linear-gradient')) || !shading.eventHit) {
      throw new Error('Today highlighting/now pointer lost');
    }
    console.log('nativeShading', JSON.stringify({width, ...shading}));
    viewScenarios += 1;
    if (measured.configuredSlotMin !== '08:00:00' || measured.configuredSlotMax !== '22:00:00' ||
      measured.firstSlot !== '08:00:00' || measured.lastSlot !== '21:30:00') {
      throw new Error('Expanded default 08:00–22:00 native FullCalendar slots were not rendered');
    }
    const boundaries = await evaluate('[window.boundary(7),window.boundary(23,59,59)]');
    console.log('boundaries', JSON.stringify(boundaries));
    if (boundaries[0].scrollTop !== 0 || boundaries[1].scrollTop !== boundaries[1].max) {
      throw new Error('Boundary clamp failed');
    }
    await evaluate('window.repeat()');
    await sleep(250);
    const repeat = await evaluate('window.measure().scrollTop');
    console.log('refreshScrollTop', repeat);
    if (repeat !== 123) throw new Error('Refresh stole scroll');
    await evaluate('window.api.next()');
    await sleep(250);
    const lines = await evaluate('window.measure().lineCount');
    console.log('otherDateLineCount', lines);
    if (lines !== 0) throw new Error('Fake now indicator');
    await evaluate('window.api.prev()');
    await sleep(250);
    if (await evaluate('window.measure().lineCount') !== 1) throw new Error('Now indicator did not return on the current date');
    for (const view of ['timeGridDay', 'timeGridThreeDay']) {
      await evaluate(`window.changeView('${view}')`);
      await sleep(250);
      const result = await evaluate('window.measure()');
      console.log('rebuiltView', view, JSON.stringify(result));
      assertCards(result.cards);
      const shade = await evaluate('window.shading()');
      assertShading(shade, view === 'timeGridDay' ? 1 : 3);
      if (!shade.eventHit) throw new Error('Appointment not visible/hittable above background');
      if (result.lineCount !== 1 || result.centerError === null || result.centerError < 3) throw new Error('View rebuild unexpectedly centered again');
      viewScenarios += 1;
    }
    // Saturday and Sunday must have the same two short bands, never all-day shading.
    await evaluate("window.api.gotoDate(new Date(2026,10,7))");
    await sleep(250);
    const weekend = await evaluate('window.shading()');
    assertShading(weekend, 3);
    if (!weekend.columns.some(col => col.date === '2026-11-08')) throw new Error('Sunday not exercised');
    console.log('weekendShading', JSON.stringify({width, dates:weekend.columns.map(col=>col.date)}));
    await evaluate('window.api.gotoDate(new Date())');
    await sleep(250);
    // Simulate saved settings rerender, including both midnight clamps; keep valid 16:00 cards.
    for (const [start,end] of [['11:30:00','19:30:00'],['00:30:00','23:30:00'],['00:00:00','20:00:00']]) {
      await evaluate(`window.setBusiness({slotMinTime:'${start}',slotMaxTime:'${end}'})`);
      await sleep(250);
      for (const view of ['timeGridDay','timeGridThreeDay']) {
        await evaluate(`window.changeView('${view}')`);
        await sleep(250);
        const shade = await evaluate('window.shading()');
        assertShading(shade, view === 'timeGridDay' ? 1 : 3);
        if (!shade.eventHit) throw new Error('Saved-window appointment obscured');
        if (shade.business.startTime !== start || shade.business.endTime !== end) throw new Error('Saved business hours stale');
        assertCards((await evaluate('window.measure()')).cards);
        console.log('updatedShading', JSON.stringify({width,view,start,end,bands:shade.expected.length}));
      }
    }
    await evaluate("window.setBusiness({slotMinTime:'10:00:00',slotMaxTime:'20:00:00'})");
    await sleep(250);
    await evaluate(`window.api.select({start:new Date(new Date().setHours(15,0,0,0)),end:new Date(new Date().setHours(16,0,0,0))})`);
    await sleep(250);
    const selection = await evaluate(`(()=>{const e=document.querySelector('.fc-timegrid .fc-highlight');return e&&{
      color:getComputedStyle(e).backgroundColor,height:e.getBoundingClientRect().height};})()`);
    if (!selection || selection.height <= 0 || selection.color !== 'rgba(59, 130, 246, 0.25)') throw new Error('Selection highlight changed');
    await evaluate('window.api.unselect()');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    const forced = await evaluate(`({
      active:matchMedia('(forced-colors: active)').matches,
      adjustment:getComputedStyle(document.querySelector('.fc-non-business')).forcedColorAdjust,
      pointerEvents:getComputedStyle(document.querySelector('.fc-non-business')).pointerEvents,
      eventHit:window.shading().eventHit
    })`);
    if (!forced.active || forced.adjustment !== 'auto' || forced.pointerEvents !== 'none' || !forced.eventHit) {
      throw new Error('Native forced-colors adjustment or event access broken: ' + JSON.stringify(forced));
    }
    await send('Emulation.setEmulatedMedia', { features: [] });
    console.log('PASS native forced-colors auto adjustment and appointment hit-through width=' + width);
    await evaluate('window.showCalendar(false)');
    await sleep(100);
    await evaluate('window.showCalendar(true)');
    await sleep(250);
    const remount = await evaluate('window.measure()');
    console.log('remountScrollTop', remount.scrollTop, 'consumed', remount.consumed);
    if (remount.centerError < 3) throw new Error('Remount unexpectedly centered again');
    await evaluate("window.showCalendar(false); document.getElementById('root').classList.add('compact')");
    await sleep(100);
    await evaluate('window.showCalendar(true)');
    await sleep(250);
    const compact = await evaluate('window.measure()');
    console.log('shortCards', JSON.stringify(compact.cards));
    assertCards(compact.cards);
    if (compact.cards.some(card => card.height > 24)) throw new Error('Compact fixture did not exercise short cards');
    console.log(`PASS width=${width}: ${viewScenarios} day/three-day layouts; center error=${measured.centerError.toFixed(2)}px; boundaries, refresh, other-date indicator, remount and compact labels passed`);
  }
  console.log('PASS total: 6 baseline + 12 updated native FullCalendar day/three-day viewport layouts; exact before/after bands, unshaded interiors, 2 weekend ranges, 2 selection highlights, pointer hit-through, midnight clamps, 4 boundary checks, 2 each refresh/other-date/remount/compact checks. Fixture only, not App E2E or physical phone keyboard testing.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  ws?.close();
  if (edge?.pid && edge.exitCode === null) {
    edge.kill();
    await Promise.race([new Promise(resolve => edge.once('exit', resolve)), sleep(3000)]);
  }
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log('CLEANUP: ephemeral fixture server closed, Edge exited, temporary profile removed');
}
