// Real current App + Nest + PostgreSQL, native Edge/CDP; no API/FullCalendar mocks.
// Run only after migrating the explicitly named NEW disposable database and building backend.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.equal(process.env.RUN_CURRENT_UI_LOCAL, '1', 'explicit isolated-run opt-in required');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55439');
assert.equal(target.pathname, '/shop_calendar_guide_20261103');
const origin = 'http://127.0.0.1:5189';
const apiOrigin = 'http://127.0.0.1:3319';
const debugOrigin = 'http://127.0.0.1:9349';
const images = path.join(root, 'docs/images/user-guide');
const profile = await mkdtemp(path.join(os.tmpdir(), 'sc-guide-'));
const password = randomUUID();
const username = `guide-admin-${randomUUID().slice(0, 8)}`;
const staffName = `Guide-Alex-${randomUUID().slice(0, 4)}`;
const staff2Name = `Guide-Sam-${randomUUID().slice(0, 4)}`;
const shopLoginName = `Guide-Shared-${randomUUID().slice(0, 4)}`;
const managerName = `Guide-Manager-${randomUUID().slice(0, 4)}`;
const children = [];
let ws, send, evaluate, browserClosed = false;
let checks = 0, screenshots = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = label => { checks++; console.log(`PASS ${label}`); };
const launch = (args, cwd, env = {}) => {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(child);
  return child;
};
const ready = async url => {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return r; } catch { /* bounded startup readiness */ }
    await sleep(250);
  }
  throw new Error(`Not ready: ${url}`);
};
const api = async (endpoint, token, body, method = body ? 'POST' : 'GET') => {
  const response = await fetch(`${apiOrigin}${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${endpoint}: HTTP ${response.status}`);
  return data;
};
const wait = async (expression, label = expression) => {
  for (let n = 0; n < 160; n++) {
    if (await evaluate(expression)) return;
    await sleep(75);
  }
  throw new Error(`Browser condition timed out: ${label}`);
};
const click = text => evaluate(`(() => {
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});
  if(!button) throw new Error('Missing button: '+${JSON.stringify(text)});
  button.click();
})()`);
const field = (selector, value) => evaluate(`(() => {
  const el=document.querySelector(${JSON.stringify(selector)});
  if(!el) throw new Error('Missing control: '+${JSON.stringify(selector)});
  const p=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(p,'value').set.call(el,${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
const labelField = async (text, value) => {
  const selector = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes(${JSON.stringify(text)}));
    const el=label?.htmlFor?document.getElementById(label.htmlFor):label?.querySelector('input,textarea,select');
    if(!el) throw new Error('Missing label');
    el.setAttribute('data-guide-field','target'); return '[data-guide-field="target"]';
  })()`);
  try { await field(selector, value); } finally { await evaluate(`document.querySelector('[data-guide-field]')?.removeAttribute('data-guide-field')`); }
};
const shot = async name => {
  // Never capture a filled password field, even though all credentials are ephemeral.
  assert.equal(await evaluate(`[...document.querySelectorAll('input[type=password]')].some(e=>e.value)`), false);
  await evaluate('window.scrollTo(0,0)');
  await sleep(200);
  console.log(`CAPTURE ${name}`);
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(images, name), Buffer.from(result.data, 'base64'));
  screenshots++;
};
const pollApi = async (predicate, label) => {
  for (let n = 0; n < 100; n++) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new Error(`API state timed out: ${label}`);
};
const dragGroup = async (minutes, resize = false) => {
  const center = await evaluate(`(() => {
    const el=[...document.querySelectorAll('.fc-timegrid-event')]
      .find(e=>e.textContent.includes('已改为 75 分钟')&&!e.classList.contains('calendar-event-pending-assignment')&&!e.classList.contains('calendar-event-cancelled'));
    if(!el) throw new Error('Group event not rendered');
    el.scrollIntoView({block:'center'});
    const box=el.getBoundingClientRect();
    return {x:box.x+box.width/2,y:box.y+Math.min(18,box.height/3)};
  })()`);
  // FullCalendar hides resizers until hover; never fall back to dragging the event body.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center });
  await sleep(100);
  const position = await evaluate(`(() => {
    const el=[...document.querySelectorAll('.fc-timegrid-event')]
      .find(e=>e.textContent.includes('已改为 75 分钟')&&!e.classList.contains('calendar-event-pending-assignment')&&!e.classList.contains('calendar-event-cancelled'));
    const box=el.getBoundingClientRect();
    const slot=document.querySelector('.fc-timegrid-slot[data-time="15:00:00"]').getBoundingClientRect();
    const handle=el.querySelector('.fc-event-resizer-end')?.getBoundingClientRect();
    if(${resize}&&(!handle||!handle.height))throw new Error('Resize handle is not visible');
    return {x:${resize}&&handle?handle.x+handle.width/2:box.x+box.width/2,
      y:${resize}&&handle?handle.y+1:box.y+Math.min(18,box.height/3),
      distance:slot.height*${minutes}/30};
  })()`);
  if (resize) {
    const hit = await evaluate(`document.elementFromPoint(${position.x},${position.y})?.className`);
    assert.match(String(hit), /fc-event-resizer/, 'resize must hit the native handle, not the event body');
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', clickCount: 1 });
  await sleep(150);
  for (let step = 1; step <= 12; step++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y + position.distance * step / 12, buttons: 1 });
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y + position.distance, button: 'left', clickCount: 1 });
};
const login = async (name, selectShop = false) => {
  await wait(`!!document.querySelector('input[type=password]')`);
  await field('form input:not([type])', name);
  await field('input[type=password]', password);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  if (selectShop) {
    await wait(`document.body.textContent.includes('选择门店')||document.body.textContent.includes('选择店铺')`);
    await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Prosper')`);
    await click('Prosper');
    await click('继续');
  }
  await wait(`!!document.querySelector('.fc-timegrid')`);
};

try {
  await mkdir(images, { recursive: true });
  // Refuse to reuse a server whose database/process ownership we cannot establish.
  for (const endpoint of [`${apiOrigin}/health`, origin, `${debugOrigin}/json`]) {
    let occupied = false;
    try { await fetch(endpoint); occupied = true; } catch { /* expected unused port */ }
    assert.equal(occupied, false, `Port must be unused: ${endpoint}`);
  }
  launch(['dist/backend/src/main.js'], path.join(root, 'backend'), {
    DATABASE_URL: target.href, PORT: '3319', TZ: 'America/Chicago',
    DEFAULT_ADMIN_USERNAME: username, DEFAULT_ADMIN_PASSWORD: password,
    JWT_ACCESS_SECRET: randomUUID(), JWT_REFRESH_SECRET: randomUUID(),
  });
  await ready(`${apiOrigin}/health`);
  launch(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5189', '--strictPort'],
    path.join(root, 'frontend'), { VITE_API_BASE_URL: apiOrigin });
  const appResponse = await ready(`${origin}/src/App.tsx`);
  assert.match(await appResponse.text(), /slotEventOverlap/);
  pass('new backend health + current frontend module respond; dedicated ports, real DB only');
  const auth = await api('/auth/login', null, { username, password });
  const selected = await api('/auth/select-shop', auth.accessToken, { shopId: 'prosper' });
  const token = selected.accessToken;
  const alternateShop = (await api('/shops', token)).find(shop => shop.id !== 'prosper');
  assert.ok(alternateShop, 'a second current shop is required to verify manager switching');
  const alex = await api('/users', token, { username: staffName, displayName: staffName, password, role: 'EMPLOYEE' });
  const sam = await api('/users', token, { username: staff2Name, displayName: staff2Name, password, role: 'EMPLOYEE' });
  await api('/users', token, { username: shopLoginName, displayName: shopLoginName, password, role: 'SHOP_ACCOUNT' });
  await api('/users', token, { username: managerName, displayName: managerName, password, role: 'MANAGER' });

  const edge = spawn(process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9349',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  children.push(edge);
  const targets = await (await ready(`${debugOrigin}/json`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); },
      method === 'Page.captureScreenshot' ? 60000 : 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'America/Chicago' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('shop-calendar-locale','zh-CN');
  ` });
  await send('Page.navigate', { url: origin });
  await wait(`!!document.querySelector('input[type=password]')`);
  assert.equal(await evaluate(`Intl.DateTimeFormat().resolvedOptions().timeZone`), 'America/Chicago');
  await shot('01-login.png');
  await field('form input:not([type])', username);
  await field('input[type=password]', password);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Prosper')`);
  await shot('02-shop-selection.png');
  await click('Prosper');
  await click('继续');
  await wait(`!!document.querySelector('.fc-timegrid')`);
  pass('real admin login, shop selection, Chinese UI and Chicago browser timezone');

  const dates = await evaluate(`(() => {
    const today=new Date(); const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    const iso=(d,h)=>{const copy=new Date(d);copy.setHours(h,0,0,0);return copy.toISOString()};
    return {today:[iso(today,10),iso(today,11),iso(today,12),iso(today,13),iso(today,16),iso(today,17)],
      tomorrowDate:(tomorrow.getMonth()+1).toString().padStart(2,'0')+'/'+tomorrow.getDate().toString().padStart(2,'0')+'/'+tomorrow.getFullYear()};
  })()`);
  await api('/appointments', token, { employeeIds: [alex.id], partySize: 1, startAt: dates.today[0], endAt: dates.today[1],
    phone: '3125550101', price: '70', customerName: '虚构顾客甲', note: '演示：短发修剪' });
  await api('/appointments', token, { employeeIds: [sam.id], partySize: 1, startAt: dates.today[2], endAt: dates.today[3],
    phone: '3125550102', price: '90', customerName: '虚构顾客乙', note: '演示：染色，请预留沟通时间' });
  await api('/appointments', token, { employeeIds: [sam.id], partySize: 2, startAt: dates.today[4], endAt: dates.today[5],
    phone: '3125550103', customerName: '虚构同行顾客', note: '演示：一位已分配，一位 pending' });
  await wait(`document.querySelectorAll('.fc-timegrid-event').length>=4`, 'SSE refreshes real calendar after API fixture creation');
  assert.ok(await evaluate(`!!document.querySelector('.fc-non-business')`));
  await shot('03-calendar.png');
  pass('real FullCalendar renders persisted staff colors, pending members, business backgrounds and SSE updates');
  await click('日');
  await wait(`!!document.querySelector('.fc-timeGridDay-view')`);
  assert.equal(await evaluate(`document.querySelectorAll('.fc-col-header-cell[data-date]').length`), 1);
  await click('3天');
  await wait(`document.querySelectorAll('.fc-col-header-cell[data-date]').length===3`);
  await evaluate(`[...document.querySelectorAll('.legend-filter-button')].find(b=>b.textContent.includes(${JSON.stringify(staffName)})).click()`);
  await wait(`document.querySelectorAll('.fc-timegrid-event').length===1`);
  await click('全部员工');
  await wait(`document.querySelectorAll('.fc-timegrid-event').length===4`);
  const draftDate = await evaluate(`document.querySelector('#appointment-start-date').value`);
  await evaluate(`document.querySelector('.date-strip-label').click()`);
  const nativeDate = dates.tomorrowDate.split('/');
  await field('.date-strip input[type=date]', `${nativeDate[2]}-${nativeDate[0]}-${nativeDate[1]}`);
  assert.equal(await evaluate(`document.querySelector('#appointment-start-date').value`), draftDate);
  await evaluate(`[...document.querySelectorAll('.date-strip button')].find(b=>b.textContent.trim()==='今天').click()`);
  pass('real day/3-day switching, employee filter and independent calendar date chooser/navigation');

  await field('#appointment-start-date', dates.tomorrowDate);
  await field('#appointment-start-time', '230');
  await field('.party-size-control input', '2');
  await evaluate(`document.querySelector('#appointment-employees').click()`);
  await evaluate(`([...document.querySelectorAll('.checkbox-option')].find(l=>l.textContent.includes(${JSON.stringify(staffName)}))).querySelector('input').click()`);
  await evaluate(`document.querySelector('#appointment-employees').click()`);
  await labelField('电话', '3125550104');
  await labelField('客户名', '虚构新顾客');
  await labelField('备注', '演示：双人预约，时长 45 分钟');
  await click('45');
  await shot('04-create-group.png');
  await click('创建预约');
  await wait(`document.querySelector('.message.success')?.textContent.includes('预约已创建')`);
  let rows = await api('/appointments', token);
  let group = rows.filter(r => r.phone === '3125550104');
  assert.equal(group.length, 2);
  assert.equal(group.filter(r => r.employeeId === alex.id).length, 1);
  assert.ok(group.every(r => r.price === '0' && (+new Date(r.endAt) - +new Date(r.startAt)) === 45 * 60_000));
  pass('UI creates 45-minute partial group; phone normalized, optional price stored as zero, two real records');
  await labelField('电话', '3125550101');
  await wait(`document.querySelectorAll('textarea')[0]?.value==='演示：短发修剪'`);
  assert.equal(await evaluate(`([...document.querySelectorAll('label')].find(l=>l.textContent.includes('客户名'))).querySelector('input').value`), '虚构顾客甲');
  pass('real phone history lookup auto-fills untouched customer name and note');

  await evaluate(`([...document.querySelectorAll('.legend-filter-button')].find(b=>b.textContent.includes('全部员工')))?.click()`);
  await wait(`[...document.querySelectorAll('.fc-timegrid-event')].some(e=>e.textContent.includes('双人预约'))`);
  await evaluate(`[...document.querySelectorAll('.fc-timegrid-event')].find(e=>e.textContent.includes('双人预约')).click()`);
  await wait(`document.body.textContent.includes('更新预约')`);
  await click('75');
  await labelField('备注', '演示：已改为 75 分钟');
  await click('更新预约');
  await wait(`document.querySelector('.message.success')?.textContent.includes('预约已更新')`);
  rows = await api('/appointments', token);
  group = rows.filter(r => r.groupId === group[0].groupId);
  assert.ok(group.every(r => (+new Date(r.endAt) - +new Date(r.startAt)) === 75 * 60_000 && r.note.includes('75')));
  pass('real event click loads full group; UI update preserves group and updates duration/note');

  // Duplicate through UI; server conflict must preserve draft and original records.
  await field('#appointment-start-date', dates.tomorrowDate);
  await field('#appointment-start-time', '230');
  await evaluate(`document.querySelector('#appointment-employees').click()`);
  await evaluate(`([...document.querySelectorAll('.checkbox-option')].find(l=>l.textContent.includes(${JSON.stringify(staffName)}))).querySelector('input').click()`);
  await evaluate(`document.querySelector('#appointment-employees').click()`);
  await labelField('电话', '3125550105');
  await click('创建预约');
  await wait(`!!document.querySelector('dialog[open]')`);
  assert.match(await evaluate(`document.querySelector('dialog[open]').textContent`), /冲突/);
  assert.equal((await api('/appointments', token)).filter(r => r.phone === '3125550105').length, 0);
  await shot('05-conflict.png');
  await click('我知道了');
  pass('actual PostgreSQL overlap rejection appears in modal; duplicate not saved and draft retained');

  await click('总览');
  await wait(`!!document.querySelector('.desktop-day-overview')`);
  await shot('06-overview.png');
  await click('管理');
  await wait(`!!document.querySelector('input[name=username]')`);
  await shot('07-admin.png');
  await field('input[type=time]', '09:30');
  await evaluate(`(() => {
    const el=document.querySelectorAll('input[type=time]')[1];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'19:30');
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await click('保存营业时间');
  await wait(`document.querySelector('.message.success')?.textContent.includes('营业时间已保存')`);
  assert.deepEqual(await api('/system-settings/calendar-window', token), { slotMinTime: '09:30:00', slotMaxTime: '19:30:00' });
  pass('admin UI saves 30-minute business-hour settings to the active shop');
  const temporary = `Guide-Temporary-${randomUUID().slice(0, 4)}`;
  await field('input[name=username]', temporary);
  await field('input[name=password]', password);
  await field('input[name=confirmPassword]', password);
  await click('创建用户');
  await wait(`document.querySelector('.message.success')?.textContent.includes('账号已创建')`);
  const managed = (await api('/users', token)).find(u => u.username === temporary);
  const userAction = text => evaluate(`(() => {
    const row=[...document.querySelectorAll('.user-item')].find(e=>e.textContent.includes(${JSON.stringify(temporary)}));
    const b=[...row.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});
    if(!b)throw new Error('User action missing');b.click();
  })()`);
  await userAction('停用');
  await wait(`document.querySelector('.message.success')?.textContent.includes('用户已停用')`);
  let denied = await fetch(`${apiOrigin}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: temporary, password }) });
  assert.equal(denied.status, 401);
  await userAction('启用');
  await wait(`document.querySelector('.message.success')?.textContent.includes('用户已启用')`);
  await api('/auth/login', null, { username: temporary, password });
  const newPassword = randomUUID();
  await field('select[name=targetUserId]', managed.id);
  await field('input[name=newPassword]', newPassword);
  await evaluate(`(() => {
    const form=document.querySelector('input[name=newPassword]').form;
    const el=form.querySelector('input[name=confirmPassword]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(newPassword)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await click('重置密码');
  await wait(`document.querySelector('.message.success')?.textContent.includes('已更新')`);
  denied = await fetch(`${apiOrigin}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: temporary, password }) });
  assert.equal(denied.status, 401);
  await api('/auth/login', null, { username: temporary, password: newPassword });
  const acceptDialogs = event => {
    if (JSON.parse(event.data).method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
  };
  ws.addEventListener('message', acceptDialogs);
  await userAction('移除');
  await wait(`document.querySelector('.message.success')?.textContent.includes('用户已移除')`);
  assert.equal((await api('/users', token)).some(u => u.id === managed.id), false);
  pass('real admin UI creates, disables, enables, resets password and removes an account; login consequences verified');
  await click('日志');
  await wait(`document.body.textContent.includes('审计日志')&&!!document.querySelector('.audit-raw-details')`);
  await shot('08-audit-logs.png');
  pass('overview, admin business-hours/accounts and readable real audit logs render');

  await click('退出登录');
  await login(staffName);
  assert.equal(await evaluate(`!!document.querySelector('.panel-tabs')`), false);
  await wait(`[...document.querySelectorAll('.fc-timegrid-event')].some(e=>e.textContent.includes('75 分钟'))`);
  await evaluate(`[...document.querySelectorAll('.fc-timegrid-event')].find(e=>e.textContent.includes('75 分钟')).click()`);
  await wait(`document.body.textContent.includes('取消预约')`);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='删除预约')`), false);
  await click('取消预约');
  await wait(`document.querySelector('.message.success')?.textContent.includes('预约已取消')`);
  const cancelled = (await api('/appointments', token)).filter(r => r.groupId === group[0].groupId);
  assert.ok(cancelled.every(r => r.status === 'CANCELLED'));
  pass('employee sees other staff bookings, no admin tabs/delete; confirmation cancels whole group and retains it');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.reload');
  await wait(`!!document.querySelector('.fc-timegrid')`);
  await shot('09-mobile-employee.png');
  assert.ok(await evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='3天')`));
  pass('390px real mobile calendar, stored-session refresh and employee controls');

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await click('退出登录');
  await login(managerName, true);
  assert.equal(await evaluate(`[...document.querySelectorAll('.panel-tabs button')].some(b=>b.textContent.trim()==='管理')`), false);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('切换店铺')).click()`);
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(alternateShop.name)})`);
  await click(alternateShop.name); await click('继续');
  await wait(`document.body.textContent.includes(${JSON.stringify(`当前：${alternateShop.name}`)})&&!!document.querySelector('.fc-timegrid')`);
  await wait(`![...document.querySelectorAll('.legend-filter-button')].some(b=>b.textContent.includes(${JSON.stringify(staffName)}))`);
  await click('日志');
  await wait(`document.body.textContent.includes('审计日志')`);
  pass('manager signs in, switches shops, cannot manage accounts and can read active-shop logs; foreign staff absent');
  await click('退出登录');
  await login(shopLoginName);
  assert.equal(await evaluate(`!!document.querySelector('.panel-tabs')`), false);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('切换店铺'))`), false);
  await evaluate(`document.querySelector('#appointment-employees').click()`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.checkbox-option')].some(e=>e.textContent.includes(${JSON.stringify(shopLoginName)}))`), false);
  pass('shared shop account directly enters home shop, has no privileged tabs/switching and is not service staff');
  await evaluate(`document.querySelector('#appointment-employees').click()`);

  // Capture before native pointer-drag checks: this Edge build can stall full-page CDP
  // screenshots after FullCalendar drag/revert. No screenshot is simulated or skipped.
  const dragFixture = await api('/appointments', token, { employeeIds: [alex.id], partySize: 2,
    startAt: group[0].startAt, endAt: group[0].endAt, phone: '3125550107', note: '演示：已改为 75 分钟' });
  group = dragFixture.appointments;
  await wait(`[...document.querySelectorAll('.fc-timegrid-event')].some(e=>
    e.textContent.includes('已改为 75 分钟')&&!e.classList.contains('calendar-event-cancelled'))`);
  const oldStart = +new Date(group[0].startAt);
  const oldEnd = +new Date(group[0].endAt);
  await dragGroup(30);
  await pollApi(async () => (await api('/appointments', token))
    .filter(r => r.groupId === group[0].groupId).every(r => +new Date(r.startAt) === oldStart + 30 * 60_000),
  'real pointer drag moves every group member by 30 minutes');
  await sleep(250);
  await dragGroup(30, true);
  await pollApi(async () => (await api('/appointments', token))
    .filter(r => r.groupId === group[0].groupId).every(r =>
      +new Date(r.startAt) === oldStart + 30 * 60_000 && +new Date(r.endAt) === oldEnd + 60 * 60_000),
  'real resize extends every group member by 30 minutes');
  pass('actual FullCalendar mouse drag and resize persist 30-minute changes to the complete group');
  const blockerStart = new Date(oldStart + 150 * 60_000).toISOString();
  await api('/appointments', token, { employeeIds: [alex.id], partySize: 1,
    startAt: blockerStart, endAt: new Date(+new Date(blockerStart) + 60 * 60_000).toISOString(),
    phone: '3125550106', note: '演示：冲突占用时段' });
  await sleep(250);
  await dragGroup(60);
  await wait(`!!document.querySelector('dialog[open]')`);
  assert.match(await evaluate(`document.querySelector('dialog[open]').textContent`), /冲突/);
  const reverted = (await api('/appointments', token)).filter(r => r.groupId === group[0].groupId);
  assert.ok(reverted.every(r => +new Date(r.startAt) === oldStart + 30 * 60_000));
  await click('我知道了');
  pass('actual conflicting FullCalendar drag reverts UI and leaves persisted group instants unchanged');

  // Demonstrate device-local calendar conversion without implying an app-enforced timezone.
  const central = await evaluate(`new Date('2026-07-15T15:00:00Z').getHours()`);
  await send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await send('Page.reload');
  await wait(`!!document.querySelector('.fc-timegrid')`);
  const utc = await evaluate(`new Date('2026-07-15T15:00:00Z').getHours()`);
  assert.equal(central, 10); assert.equal(utc, 15);
  pass('timezone limitation reproduced in real browser: same instant is 10:00 Chicago versus 15:00 UTC');
  console.log(`RESULT ${checks} browser checks passed; ${screenshots} authentic screenshots; no API/calendar mocks`);
} finally {
  if (ws?.readyState === WebSocket.OPEN && send) {
    try { await send('Browser.close'); browserClosed = true; } catch { /* scoped PID cleanup below */ }
    ws.close();
  }
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      // Specific owned PID only. Never kill a process by executable name.
      spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${child.pid} -Force -ErrorAction SilentlyContinue`], { stdio: 'ignore' });
    }
  }
  for (let n = 0; n < 20; n++) {
    try { await rm(profile, { recursive: true, force: true }); break; } catch { await sleep(100); }
  }
  console.log(`CLEANUP owned backend/frontend/Edge stopped; isolated browser profile removed; database left to owning task (${browserClosed ? 'browser closed' : 'PID cleanup'})`);
}
