// Real App on the existing dev server, mocked API only. Native Edge/CDP; no new dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = 'http://localhost:5173';
const profile = await mkdtemp(path.join(os.tmpdir(), 'shop-calendar-input-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let edge, ws;
try {
  const hot = await fetch(`${origin}/src/App.tsx`);
  assert.equal(hot.status, 200);
  const appSource = await hot.text();
  assert.match(appSource, /rejectedStartTimeInputRef/);
  assert.match(appSource, /NativeDateChooser/);
  assert.match(appSource, /handleCalendarDateChoose/);
  assert.match(appSource, /dateAlignment: "day"/);
  const chooserSource = await fetch(`${origin}/src/NativeDateChooser.tsx`);
  assert.equal(chooserSource.status, 200);
  const liveChooser = await chooserSource.text();
  assert.match(liveChooser, /control\.showPicker\(\)/);
  assert.match(liveChooser, /useId/);
  const hotStyles = await fetch(`${origin}/src/styles.css`);
  assert.equal(hotStyles.status, 200);
  assert.match(await hotStyles.text(), /body\.theme-dark \.native-date-panel/);
  console.log('PASS dev5173 HTTP 200; hot App/chooser/CSS contain header/date-alignment/useId/scoped-dark implementation (API fully mocked; no backend prerequisite)');
  edge = spawn(process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9338', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  edge.on('error', error => console.error(error));
  let targets;
  for (let n = 0; n < 100; n++) {
    try { targets = await (await fetch('http://127.0.0.1:9338/json')).json(); if (targets.length) break; } catch { /* readiness */ }
    await sleep(100);
  }
  assert.ok(targets?.length, 'Edge readiness');
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(message.error); else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await sleep(50); }
    throw new Error(`Timed out: ${expression}`);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear(); localStorage.setItem('shop-calendar-locale','en');
    window.writes=[]; window.mockWindow={slotMinTime:'08:00:00',slotMaxTime:'20:00:00'};
    const historyStart=new Date();historyStart.setHours(21,30,17,123);
    window.historyStart=historyStart.toISOString();
    const historyRecord={id:'fixture-history',employeeId:'fixture-employee',startAt:window.historyStart,
      endAt:new Date(historyStart.getTime()+3600000).toISOString(),phone:'3125551234',price:'80.00',status:'SCHEDULED'};
    const user={id:'browser-admin',username:'fixture',displayName:'Fixture Admin',role:'ADMIN',status:'ACTIVE'};
    const auth={accessToken:'fixture-token',refreshToken:'fixture-refresh',tokenType:'Bearer',user,activeShopId:'fixture-shop'};
    window.EventSource=class {addEventListener(){} removeEventListener(){} close(){}};
    window.fetch=async (url,init={})=>{
      const u=String(url),method=init.method||'GET'; let body={};
      if(u.includes('/auth/')) body=auth;
      else if(u.includes('/system-settings/calendar-window')) body=window.mockWindow;
      else if(u.endsWith('/users/staff')) body=[{id:'fixture-employee',username:'staff',displayName:'Fixture Staff',role:'EMPLOYEE',status:'ACTIVE',color:'#60a5fa'}];
      else if(u.endsWith('/users')) body=[user,{id:'fixture-employee',username:'staff',displayName:'Fixture Staff',role:'EMPLOYEE',status:'ACTIVE',color:'#60a5fa'}];
      else if(u.endsWith('/shops')) body=[{id:'fixture-shop',name:'Fixture Shop'}];
      else if(u.includes('customer-lookup')) body={};
      else if(u.includes('/appointments') && method==='GET') body=[historyRecord];
      else if(u.endsWith('/cancel') && method==='POST') body={success:true};
      else if(u.includes('/appointments')) window.writes.push(JSON.parse(init.body));
      else throw new Error('Unexpected mocked request: '+u);
      return new Response(JSON.stringify(body),{status:200});
    };
    window.setField=(selector,value)=>{
      const el=document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    };
    window.setLabel=(text,value)=>{
      const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes(text));
      const el=label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    };
    window.timeState=()=>{const e=document.querySelector('#appointment-start-time');return {
      value:e.value,start:e.selectionStart,end:e.selectionEnd,invalid:e.getAttribute('aria-invalid'),
      error:document.querySelector('#start-time-error')?.textContent,modal:!!document.querySelector('dialog[open]')
    }};
  ` });
  await send('Page.navigate', { url: origin });
  await wait('!!document.querySelector("input[type=password]")');
  await evaluate(`setField('form input:not([type])','fixture')`);
  await evaluate(`setField('input[type=password]','fixture')`);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await wait('!!document.querySelector("#appointment-start-time")');
  await sleep(250);
  const key = async (key, text, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text, modifiers,
      windowsVirtualKeyCode: ({ Backspace:8, Delete:46, Tab:9, Enter:13, Escape:27, ArrowUp:38 })[key] ?? key.toUpperCase().charCodeAt(0) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
  };
  const selectTime = async () => { await evaluate(`document.querySelector('#appointment-start-time').focus()`); await key('a', undefined, 2); };
  const fillTime = async text => { await selectTime(); await send('Input.insertText', { text }); };
  const blur = () => evaluate(`document.querySelector('#appointment-start-time').blur()`);
  for (const [digits, normalized, hours, minutes] of [['2','2:00',14,0],['10','10:00',10,0],['230','2:30',14,30],['0930','9:30',9,30],['1030','10:30',10,30]]) {
    await evaluate(`setField('input[aria-label="Start date in MM/DD/YYYY format"]','11/02/2026');setLabel('Phone','3125551234')`);
    await fillTime(digits); assert.equal((await evaluate('timeState()')).value, digits);
    await blur(); assert.equal((await evaluate('timeState()')).value, normalized);
    await evaluate(`setLabel('Price','70')`);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Create appointment').click()`);
    await wait('writes.length>0');
    const payload = await evaluate('writes.pop()');
    assert.equal(payload.startAt, await evaluate(`new Date(2026,10,2,${hours},${minutes}).toISOString()`));
  }
  console.log('PASS native digit editing/blur + mocked save payload: 2/10/230/0930/1030');
  await fillTime('23'); assert.equal((await evaluate('timeState()')).invalid, null);
  await key('0', '0'); assert.equal((await evaluate('timeState()')).value, '230');
  await blur(); assert.equal((await evaluate('timeState()')).value, '2:30');
  await fillTime('0930');
  await evaluate(`document.querySelector('#appointment-start-time').setSelectionRange(2,2)`);
  await key('-', '-'); assert.equal((await evaluate('timeState()')).value, '0930');
  assert.equal((await evaluate('timeState()')).start, 2);
  await key('5','5'); assert.equal((await evaluate('timeState()')).value, '0930');
  await evaluate(`document.querySelector('#appointment-start-time').setSelectionRange(0,1)`);
  await key('1','1'); assert.equal((await evaluate('timeState()')).value, '1930');
  await selectTime(); await key('Backspace'); assert.equal((await evaluate('timeState()')).value, '');
  await send('Input.insertText',{text:'930'});
  for (const expected of ['93','9','']) { await key('Backspace'); assert.equal((await evaluate('timeState()')).value, expected); }
  console.log('PASS native incomplete typing, nonnumeric/length guards, selection/caret, continuous deletion');
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite','clipboardSanitizedWrite'] });
  for (const text of ['-2','abc230','14:30','12345']) {
    await fillTime('230'); await selectTime();
    await evaluate(`navigator.clipboard.writeText(${JSON.stringify(text)})`);
    await key('v',undefined,2); await sleep(80);
    const state = await evaluate('timeState()');
    assert.equal(state.value,'230'); assert.equal(state.invalid,'true');
    assert.deepEqual([state.start,state.end],[0,3]);
    await blur(); assert.equal((await evaluate('timeState()')).invalid,'true');
  }
  console.log('PASS native Ctrl+V rejects nonnumeric/overlong paste without changing value or selection');
  await selectTime();
  await evaluate(`navigator.clipboard.writeText('0930')`);
  await key('v',undefined,2); await sleep(80);
  assert.equal((await evaluate('timeState()')).value,'0930');
  assert.equal((await evaluate('timeState()')).invalid,null);
  for (const invalid of ['23', '2500']) {
    await fillTime(invalid); await blur();
    const state = await evaluate('timeState()');
    assert.equal(state.value, invalid);
    assert.equal(state.invalid, 'true');
    assert.match(state.error, /1–4 digits/);
    assert.equal(state.modal, false);
  }
  await evaluate(`setField('input[aria-label="Start date in MM/DD/YYYY format"]','11/02/2026');setLabel('Phone','3125551234')`);
  await evaluate(`setLabel('Price','70')`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Create appointment').click()`);
  assert.equal((await evaluate('timeState()')).modal,true);
  assert.equal(await evaluate('writes.length'),0);
  await evaluate(`document.querySelector('dialog[open] button').click()`);
  console.log('PASS native invalid blur inline + save modal, zero API writes; valid leading-zero paste recovers');
  const button = 'button[aria-label="Start time input help"]';
  await evaluate(`document.querySelector(${JSON.stringify(button)}).focus()`);
  assert.equal(await evaluate(`document.querySelector('#start-time-help').hidden`),false);
  await key('Escape'); assert.equal(await evaluate(`document.querySelector('#start-time-help').hidden`),true);
  await evaluate(`document.querySelector(${JSON.stringify(button)}).blur()`);
  const rect = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(button)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...rect});
  assert.equal(await evaluate(`document.querySelector('#start-time-help').hidden`),false);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
  assert.equal(await evaluate(`document.querySelector('#start-time-help').hidden`),true);
  await send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rect]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(80);
  assert.equal(await evaluate(`document.querySelector('#start-time-help').hidden`),false);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rect]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(80);
  assert.equal(await evaluate(`document.querySelector('#start-time-help').hidden`),true);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rect]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(80);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:1,y:1}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(80);
  assert.equal(await evaluate(`document.querySelector('#start-time-help').hidden`),true);
  console.log('PASS real tooltip focus/Escape/hover/touch/outside dismissal; blur error is inline, not modal');
  await send('Emulation.setTouchEmulationEnabled',{enabled:false});

  await evaluate(`setLabel('Party size','3')`);
  assert.equal(await evaluate(`document.querySelector('.party-size-control button')`),null);
  assert.match(await evaluate(`document.querySelector('#employee-help').textContent`),/3 "pending"/);
  const partyStyle = await evaluate(`(()=>{const e=document.querySelector('.party-size-control input');return {
    min:e.min,max:e.max,appearance:getComputedStyle(e).appearance,
    spinnerRule:[...document.styleSheets].flatMap(s=>[...s.cssRules]).some(r=>
      r.selectorText?.includes('.party-size-control input::-webkit-inner-spin-button') &&
      r.style?.webkitAppearance==='none'),
    duration:getComputedStyle(document.querySelector('#appointment-duration')).appearance
  }})()`);
  assert.deepEqual([partyStyle.min,partyStyle.max],['1','99']);
  assert.equal(partyStyle.appearance,'textfield');
  // Chromium omits this pseudo-element when the parent is a textfield;
  // getComputedStyle(pseudo) then returns the parent's appearance instead.
  assert.equal(partyStyle.spinnerRule,true);
  assert.notEqual(partyStyle.duration,'textfield');
  await evaluate(`setLabel('Party size','100');document.querySelector('.party-size-control input').focus()`);
  await key('Tab');
  assert.equal(await evaluate(`document.querySelector('.party-size-control input').value`),'99');
  await evaluate(`setLabel('Party size','0');document.querySelector('.party-size-control input').focus()`);
  await key('Tab');
  assert.equal(await evaluate(`document.querySelector('.party-size-control input').value`),'1');
  assert.equal(await evaluate(`document.querySelector('.employee-field > .hint')`),null);
  assert.equal(await evaluate(`[...document.querySelectorAll('.hint')].some(e=>/End preview will appear|Use MM\\/DD\\/YYYY/.test(e.textContent))`),false);
  for (const id of ['employee-help','start-date-help','duration-help']) {
    await evaluate(`document.querySelector('button[aria-controls="${id}"]').focus()`);
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),false);
    await key('Escape');
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),true);
    await evaluate(`document.activeElement.blur()`);
    const helpRect=await evaluate(`(()=>{const r=document.querySelector('button[aria-controls="${id}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...helpRect});
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),false);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),true);
    await send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[helpRect]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(80);
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),false);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:1,y:1}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(80);
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),true);
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  }
  console.log('PASS B number-only scoped spinner CSS, min/max native Tab blur, dynamic help; all 3 help focus/hover/touch/Escape/outside');

  await evaluate(`setField('#appointment-start-date','11/02/2026');setLabel('Customer name','Keep Customer');setLabel('Duration','60')`);
  await fillTime('1030'); await blur();
  const preservedTime=await evaluate(`document.querySelector('#appointment-start-time').value`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.hint')].some(e=>e.textContent.includes('Derived end:'))`),true);
  await evaluate(`setLabel('Duration','900')`);
  assert.match(await evaluate(`document.querySelector('.duration-preview-error').textContent`),/Derived end:/);
  await evaluate(`setLabel('Duration','');`);
  assert.equal(await evaluate(`!!document.querySelector('.duration-preview-error')`),false);
  assert.equal(await evaluate(`[...document.querySelectorAll('.hint')].some(e=>e.textContent.includes('End preview will appear'))`),false);
  await evaluate(`setLabel('Duration','60')`);
  console.log('PASS real App valid derived end and cross-day warning remain inline; invalid duration placeholder only in help');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.quick-date-shortcuts button')].map(e=>e.textContent)`),['Today','Choose date']);
  await evaluate(`window.originalShowPicker=HTMLInputElement.prototype.showPicker;window.pickerCalls=[];
    HTMLInputElement.prototype.showPicker=function(){window.pickerCalls.push({active:navigator.userActivation.isActive,visible:this.getBoundingClientRect().width>0,focused:document.activeElement===this});return window.originalShowPicker.call(this)}`);
  const clickChoose = async (selector = '.quick-date-shortcuts .native-date-chooser button') => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});
    await sleep(100);
  };
  await clickChoose();
  assert.deepEqual(await evaluate('pickerCalls'),[{active:true,visible:true,focused:true}]);
  assert.equal(await evaluate(`!!document.querySelector('.quick-date-shortcuts [role=status]')`),false);
  assert.equal(await evaluate(`document.querySelector('.quick-date-shortcuts input[type=date]').hasAttribute('min')`),false);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.quick-date-shortcuts input[type=date]')).colorScheme`),'dark');
  assert.notEqual(await evaluate(`getComputedStyle(document.body).colorScheme`),'dark');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#appointment-start-time')).colorScheme`),'dark');
  await key('Escape');
  // OS-native popup is outside the page DOM; headless CDP cannot prove visual popup navigation.
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.activeElement.textContent`),'Choose date');
  console.log('PASS native Edge showPicker invoked successfully by real activated click, visible/focused input; LIMIT headless native popup visual/navigation not fully verified');

  for (const mode of ['unsupported','NotAllowedError']) {
    await evaluate(mode==='unsupported'
      ? `HTMLInputElement.prototype.showPicker=undefined`
      : `HTMLInputElement.prototype.showPicker=function(){throw new DOMException('fixture known case','NotAllowedError')}`);
    await clickChoose();
    assert.equal(await evaluate(`document.activeElement===document.querySelector('.quick-date-shortcuts input[type=date]')`),true);
    assert.match(await evaluate(`document.querySelector('.quick-date-shortcuts [role=status]').textContent`),/could not open automatically/);
    const nativeState=await evaluate(`(()=>{const e=document.querySelector('.quick-date-shortcuts input[type=date]'),r=e.getBoundingClientRect();return {width:r.width,height:r.height,tabIndex:e.tabIndex,min:e.getAttribute('min')}})()`);
    assert.ok(nativeState.width>0 && nativeState.height>0);
    assert.equal(nativeState.tabIndex,0); assert.equal(nativeState.min,null);
    await key('Escape');
    assert.equal(await evaluate(`document.activeElement.textContent`),'Choose date');
  }
  await clickChoose();
  await key('ArrowUp');
  await wait(`!document.querySelector('.quick-date-shortcuts input[type=date]')`);
  assert.notEqual(await evaluate(`document.querySelector('#appointment-start-date').value`),'11/02/2026');
  assert.equal(await evaluate(`document.activeElement.textContent`),'Choose date');
  console.log('PASS actual Edge unsupported/known-exception visible fallback + Escape focus; native date ArrowUp changes form');
  await clickChoose();
  await evaluate(`setField('.quick-date-shortcuts input[type=date]','2028-01-02')`);
  assert.equal(await evaluate(`document.querySelector('#appointment-start-date').value`),'01/02/2028');
  assert.equal(await evaluate(`document.querySelector('#appointment-start-time').value`),preservedTime);
  assert.equal(await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Customer name'));return l.querySelector('input').value})()`),'Keep Customer');
  await evaluate(`setField('#appointment-start-date','12/31/2027')`);
  await clickChoose();
  assert.equal(await evaluate(`document.querySelector('.quick-date-shortcuts input[type=date]').value`),'2027-12-31');
  await key('Escape');
  await evaluate(`document.querySelector('.quick-date-shortcuts > button').click()`);
  assert.equal(await evaluate(`document.querySelector('#appointment-start-date').value`),await evaluate(`(()=>{const d=new Date();return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+d.getFullYear()})()`));
  await evaluate(`HTMLInputElement.prototype.showPicker=window.originalShowPicker`);

  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const mobileLayout=await evaluate(`(()=>{const group=document.querySelector('.quick-date-shortcuts'),p=document.querySelector('.party-size-control input');return {
    wrap:getComputedStyle(group).flexWrap,party:getComputedStyle(p).appearance,
    buttons:[...group.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return {width:r.width,right:r.right,left:r.left}}),
    rowWrap:getComputedStyle(document.querySelector('.party-employee-row')).flexWrap
  }})()`);
  assert.equal(mobileLayout.wrap,'wrap');assert.equal(mobileLayout.rowWrap,'wrap');assert.equal(mobileLayout.party,'textfield');
  assert.ok(mobileLayout.buttons.every(b=>b.width>40 && b.left>=0 && b.right<=390));
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('PASS App date future/year boundary/manual round-trip/local Today preserves time/customer; real 390px scoped no-spinner + wrapped buttons layout');

  // Inspect the real mounted FullCalendar instance (not a calendar mock).
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`{
    const el=document.querySelector('.fc'),key=Object.keys(el).find(k=>k.startsWith('__reactFiber'));
    let fiber=el[key];while(fiber && typeof fiber.stateNode?.getApi!=='function')fiber=fiber.return;
    if(!fiber)throw new Error('Mounted FullCalendar instance missing');
    window.calendarApi=fiber.stateNode.getApi();window.gotoCalls=[];
    const original=calendarApi.gotoDate.bind(calendarApi);
    calendarApi.gotoDate=d=>{gotoCalls.push([d.getFullYear(),d.getMonth()+1,d.getDate(),d.getHours()]);original(d)};
    window.headerState=()=>{const b=document.querySelector('.date-strip-label'),api=window.calendarApi;
      return {label:b.textContent,name:b.getAttribute('aria-label'),anchor:[api.getDate().getFullYear(),api.getDate().getMonth()+1,api.getDate().getDate()],
        days:[...document.querySelectorAll('.fc-col-header-cell[data-date]')].map(e=>e.dataset.date),
        view:api.view.type}};
    window.draftState=()=>[...document.querySelectorAll('.appointment-form input,.appointment-form select,.appointment-form textarea')].map(e=>e.value);
    window.scrollGrid=()=>document.querySelector('.fc-timegrid-slot-lane').closest('.fc-scroller');
    window.consumedRef=()=>{const e=document.querySelector('.calendar-frame');let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber'))];
      while(f && !f.memoizedProps?.consumed)f=f.return;return f.memoizedProps.consumed};
    window.initialConsumed=consumedRef();
  }`);
  // The existing form class can vary; use the start-date control's owning form.
  await evaluate(`window.draftState=()=>[...document.querySelector('#appointment-start-date').form.querySelectorAll('input,select,textarea')].map(e=>e.value)`);
  const draftBeforeHeader = await evaluate('draftState()');
  await evaluate(`document.querySelectorAll('.legend-filter-button')[1].click()`);
  const filterBeforeHeader = await evaluate(`[...document.querySelectorAll('.legend-filter-button')].map(e=>e.getAttribute('aria-pressed'))`);
  // Bound the real App calendar viewport for measurable native scroll behavior.
  // This is browser-test-only; production calendar sizing is unchanged.
  await evaluate(`calendarApi.setOption('height',500)`);
  await sleep(150);
  await evaluate(`scrollGrid().scrollTop=123`);
  // FullCalendar's normal scrollTimeReset resets scroll on navigation. It is
  // not the App's once-current-time centering; do not require preserved scroll.
  assert.equal(await evaluate('consumedRef()===initialConsumed'),true);
  assert.equal(await evaluate('consumedRef().current'),true);
  await evaluate(`pickerCalls=[];HTMLInputElement.prototype.showPicker=function(){
    pickerCalls.push({active:navigator.userActivation.isActive,visible:this.getBoundingClientRect().width>0,focused:document.activeElement===this});
    return originalShowPicker.call(this)}`);
  await clickChoose('.date-strip-label');
  assert.deepEqual(await evaluate('pickerCalls'),[{active:true,visible:true,focused:true}]);
  const headerNative = await evaluate(`(()=>{const b=document.querySelector('.date-strip-label'),p=document.getElementById(b.getAttribute('aria-controls')),e=p.querySelector('input'),r=e.getBoundingClientRect();
    return {tag:b.tagName,name:b.getAttribute('aria-label'),label:b.textContent,expanded:b.getAttribute('aria-expanded'),
      panel:p.id,input:e.id,dark:getComputedStyle(e).colorScheme,position:getComputedStyle(p).position,width:r.width,height:r.height,fallback:!!p.querySelector('[role=status]')}})()`);
  assert.equal(headerNative.tag,'BUTTON');assert.equal(headerNative.name,headerNative.label);
  assert.equal(headerNative.expanded,'true');assert.equal(headerNative.dark,'dark');
  assert.equal(headerNative.position,'absolute');assert.ok(headerNative.width>0 && headerNative.height>0);assert.equal(headerNative.fallback,false);
  await evaluate(`document.body.classList.remove('theme-dark')`);
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.calendar-date-chooser input')).colorScheme`),'dark');
  await evaluate(`document.body.classList.add('theme-dark')`);
  await key('Escape');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('.date-strip-label')`),true);
  console.log('PASS real Edge header activated native showPicker, button name/panel relation, visible focused dark input and absolute panel; editor/global/time computed scope verified');
  const headerPick = async iso => {
    await clickChoose('.date-strip-label');
    await evaluate(`setField('.calendar-date-chooser input[type=date]',${JSON.stringify(iso)})`);
    // FullCalendar defers DOM updates; wait for the chosen range rather than a fixed delay.
    try {
      await wait(`document.querySelector('.fc-col-header-cell[data-date]')?.dataset.date===${JSON.stringify(iso)}`);
    } catch (error) {
      throw new Error(`Header pick ${iso} did not update the calendar: ${JSON.stringify(await evaluate('headerState()'))}`, { cause: error });
    }
    assert.equal(await evaluate(`!!document.querySelector('.calendar-date-chooser input')`),false);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('.date-strip-label')`),true);
  };
  for (const [timezone, iso, anchor, days] of [
    ['America/Los_Angeles','2027-12-31',[2027,12,31],['2027-12-31','2028-01-01','2028-01-02']],
    ['Asia/Tokyo','2028-02-29',[2028,2,29],['2028-02-29','2028-03-01','2028-03-02']],
  ]) {
    await send('Emulation.setTimezoneOverride',{timezoneId:timezone});
    await evaluate(`HTMLInputElement.prototype.showPicker=undefined`);
    await headerPick(iso);
    assert.deepEqual((await evaluate('headerState()')).anchor,anchor);
    assert.deepEqual((await evaluate('headerState()')).days,days);
    assert.deepEqual(await evaluate('gotoCalls.at(-1)'),[...anchor,0]);
    assert.deepEqual(await evaluate('draftState()'),draftBeforeHeader);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.legend-filter-button')].map(e=>e.getAttribute('aria-pressed'))`),filterBeforeHeader);
    assert.equal(await evaluate('consumedRef()===initialConsumed && consumedRef().current'),true);
  }
  await send('Emulation.setTimezoneOverride',{timezoneId:''});
  await headerPick('2027-12-31');
  for (const [action, anchor, days] of [
    ['next',[2028,1,3],['2028-01-03','2028-01-04','2028-01-05']],
    ['prev',[2027,12,31],['2027-12-31','2028-01-01','2028-01-02']],
  ]) {
    await evaluate(`document.querySelectorAll('.date-strip-actions button')[${action==='next'?2:0}].click()`);
    await sleep(150);
    const state=await evaluate('headerState()');assert.deepEqual(state.anchor,anchor);assert.deepEqual(state.days,days);
    await clickChoose('.date-strip-label');
    assert.equal(await evaluate(`document.querySelector('.calendar-date-chooser input').value`),days[0]);
    assert.equal(await evaluate(`document.querySelector('.calendar-date-chooser [role=status]').id===document.querySelector('.calendar-date-chooser input').getAttribute('aria-describedby')`),true);
    await key('Escape');
  }
  // Select a different visible day/time cell with genuine browser pointer events.
  await evaluate(`scrollGrid().scrollIntoView({block:'center'});
    scrollGrid().scrollTop+=document.querySelector('.fc-timegrid-slot-lane[data-time="10:00:00"]').getBoundingClientRect().top-scrollGrid().getBoundingClientRect().top-100`);
  const slotPoint = await evaluate(`(()=>{const col=document.querySelector('.fc-timegrid-col[data-date="2028-01-01"]'),slot=document.querySelector('.fc-timegrid-slot-lane[data-time="10:00:00"]');
    const c=col.getBoundingClientRect(),r=slot.getBoundingClientRect();return {x:c.x+c.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...slotPoint});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...slotPoint});
  await sleep(150);
  assert.equal(await evaluate(`document.querySelector('#appointment-start-date').value`),'01/01/2028');
  assert.deepEqual((await evaluate('headerState()')).anchor,[2027,12,31]);
  const labelBeforeSwitch=(await evaluate('headerState()')).label;
  await evaluate(`[...document.querySelectorAll('.toggle-row button')].find(b=>b.textContent==='Day').click()`);
  await sleep(200);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.fc-col-header-cell[data-date]')].map(e=>e.dataset.date)`),['2027-12-31']);
  assert.equal(await evaluate(`document.querySelector('.date-strip-label').textContent`),labelBeforeSwitch);
  assert.equal(await evaluate('consumedRef()===initialConsumed && consumedRef().current'),true);
  // Reacquire after the view-key remount.
  await evaluate(`{const e=document.querySelector('.fc');let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber'))];
    while(f && typeof f.stateNode?.getApi!=='function')f=f.return;window.calendarApi=f.stateNode.getApi();void 0}`);
  await headerPick('2020-02-29');
  assert.deepEqual((await evaluate('headerState()')).days,['2020-02-29']);
  await evaluate(`document.querySelectorAll('.date-strip-actions button')[1].click()`);
  const todayIso=await evaluate(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`);
  await wait(`document.querySelector('.fc-col-header-cell[data-date]')?.dataset.date===${JSON.stringify(todayIso)}`);
  assert.deepEqual((await evaluate('headerState()')).days,[todayIso]);
  await clickChoose('.date-strip-label');
  assert.equal(await evaluate(`document.querySelector('.calendar-date-chooser input').value`),todayIso);
  await key('Escape');
  console.log('PASS real FullCalendar local gotoDate midnight in LA/Tokyo, exact cross-year/leap-month 3-day ranges, prev/next/today, slot draft only, Day remount anchor, past navigation, preserved draft/filter/once-consumed ref (native scrollTimeReset unchanged)');

  for (const selector of ['.quick-date-shortcuts .native-date-chooser button','.date-strip-label']) {
    await clickChoose(selector);
    const fallbackIds=await evaluate(`(()=>{const e=document.querySelector('input[type=date]');return [e.id,e.getAttribute('aria-describedby'),e.closest('.native-date-panel').id]})()`);
    if(selector.startsWith('.quick')) {
      assert.notEqual(fallbackIds[0],headerNative.input);assert.notEqual(fallbackIds[2],headerNative.panel);
    }
    assert.match(await evaluate(`document.querySelector('.native-date-panel [role=status]').textContent`),/could not open automatically/);
    await key('Escape');
  }
  await evaluate(`HTMLInputElement.prototype.showPicker=function(){throw new Error('fixture unexpected header picker failure')}`);
  await clickChoose('.date-strip-label');
  assert.match(await evaluate(`document.querySelector('dialog[open]').textContent`),/fixture unexpected header picker failure/);
  assert.equal(await evaluate(`!!document.querySelector('.calendar-date-chooser input')`),false);
  await evaluate(`document.querySelector('dialog[open] button').click();HTMLInputElement.prototype.showPicker=undefined`);
  console.log('PASS unexpected header picker failure appears in the standard operation-error dialog, not silent fallback');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await clickChoose('.date-strip-label');
  const layout=await evaluate(`(()=>{const p=document.querySelector('.calendar-date-chooser .native-date-panel'),r=p.getBoundingClientRect(),e=p.querySelector('input'),b=document.querySelector('.date-strip');
    return {left:r.left,right:r.right,inputWidth:e.getBoundingClientRect().width,height:b.getBoundingClientRect().height,dark:getComputedStyle(e).colorScheme}})()`);
  assert.ok(layout.left>=0 && layout.right<=390 && layout.inputWidth>0);assert.equal(layout.dark,'dark');
  await key('Escape');
  const closedHeight=await evaluate(`document.querySelector('.date-strip').getBoundingClientRect().height`);
  assert.equal(layout.height,closedHeight);
  await evaluate(`document.querySelector('.date-strip-label').focus()`);
  await key('Enter','\r');
  assert.equal(await evaluate(`!!document.querySelector('.calendar-date-chooser input')`),true);
  await evaluate(`document.querySelector('.date-strip-actions button').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  assert.equal(await evaluate(`!!document.querySelector('.calendar-date-chooser input')`),false);
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`HTMLInputElement.prototype.showPicker=originalShowPicker;
    document.querySelector('.legend-filter-button').click()`);
  console.log('PASS dual-instance unique fallback/input/panel IDs; 390px panel fits viewport without nav growth; Enter/Escape/outside dismissal. LIMIT OS-native popup visual selection remains unverified in headless Edge');

  await evaluate(`document.querySelector('.fc-event').click()`);
  await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Update appointment')`);
  for(let i=0;i<3;i++){
    await evaluate(`document.querySelector('#appointment-start-time').focus()`);
    assert.equal((await evaluate('timeState()')).value,'930');
    await blur(); assert.equal((await evaluate('timeState()')).value,'9:30');
    assert.equal((await evaluate('timeState()')).invalid,null);
  }
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Update appointment').click()`);
  await wait('writes.length>0');
  assert.equal(await evaluate('writes.pop().startAt'),await evaluate('window.historyStart'));
  assert.equal(await evaluate(`document.querySelector('.fc-timegrid-slot[data-time]')?.dataset.time`),'06:00:00');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Admin').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('input[type=time]').length`),2);
  assert.equal(await evaluate(`[...document.querySelectorAll('input[type=time]')].some(e=>getComputedStyle(e).colorScheme==='dark')`),false);
  console.log('PASS native historical focus/blur/save preserves exact outside-window timestamp; padding and business type=time unchanged');
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  ws?.close();
  if (edge?.pid && edge.exitCode === null) {
    // Kill only this helper's known PID; never touch shared dev/backend services.
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${edge.pid} -ErrorAction SilentlyContinue`]);
    await Promise.race([new Promise(resolve => edge.once('exit', resolve)), sleep(3000)]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
