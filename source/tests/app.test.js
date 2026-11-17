'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname, '../app/src/main/assets/www');
const C = require(path.join(base, 'core.js'));
const decode = text => String(text).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Small event/field DOM adapter, not a browser renderer. The app is executed
// unchanged; tests operate its public controls, never export private functions.
class MiniNode {
  constructor(doc, tag, attrs = {}, parent = null) {
    this.doc = doc; this.tagName = tag.toUpperCase(); this.attrs = attrs;
    this.parent = parent; this.value = attrs.value || ''; this.style = {};
    this.listeners = {}; this._html = ''; this._text = ''; this.dataset = {};
    this.classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = { contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, force) => { const active = force == null ? !this.classes.has(name) : force; active ? this.classes.add(name) : this.classes.delete(name); return active; } };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())] = value;
    doc.nodes.push(this);
  }
  set value(value) { this._value=String(value); }
  get value() { return this._value||''; }
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  set innerHTML(html) { this.doc.nodes = this.doc.nodes.filter(n => n === this || !this.contains(n)); this._html = String(html); this._text = ''; this.doc.parse(this, this._html); }
  get innerHTML() { return this._html; }
  insertAdjacentHTML(position,html){this._html=position==='afterbegin'?String(html)+this._html:this._html+String(html);this.doc.parse(this,String(html));}
  set textContent(text) { this._text = String(text); }
  get textContent() { return this._text || decode(this._html.replace(/<[^>]*>/g, '')); }
  get innerText() { return this.textContent; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {} }); }
  click() { this.dispatch('click'); }
  focus() { this.doc.activeElement = this; this.dispatch('focus'); }
  scrollIntoView() {}
  querySelector(selector) { return this.doc.find(selector, this)[0] || null; }
  querySelectorAll(selector) { return this.doc.find(selector, this); }
}
class MiniDocument {
  constructor() {
    this.nodes = []; this.body = new MiniNode(this, 'body');new MiniNode(this,'header',{class:'app-header'},this.body);
    for (const id of ['main', 'modal-title', 'modal-body', 'modal-close', 'add-event', 'toast']) new MiniNode(this, id.includes('close') || id === 'add-event' ? 'button' : 'div', { id }, this.body);
    new MiniNode(this, 'div', { id: 'modal', class: 'hidden' }, this.body);
    new MiniNode(this, 'div', { id: 'photo-lightbox', class: 'lightbox hidden' }, this.body);
    new MiniNode(this, 'div', { class: 'sheet' }, this.body);
    const nav = new MiniNode(this, 'nav', { id: 'nav' }, this.body);
    for (const tab of ['home', 'records', 'stats', 'photos', 'backup']) new MiniNode(this, 'button', { 'data-tab': tab }, nav);
  }
  matches(node, selector) {
    if (selector.startsWith('#')) return node.attrs.id === selector.slice(1);
    if (selector.startsWith('.')) return node.classes.has(selector.slice(1));
    const attr = /^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(selector);
    if (attr) return Object.hasOwn(node.attrs, attr[1]) && (attr[2] == null || node.attrs[attr[1]] === attr[2]);
    return node.tagName.toLowerCase() === selector;
  }
  find(selector, within) {
    const parts = selector.trim().split(/\s+/), last = parts.pop();
    return this.nodes.filter(node => (!within || within.contains(node)) && this.matches(node, last) && parts.every(part => { for (let p = node.parent; p; p = p.parent) if (this.matches(p, part)) return true; return false; }));
  }
  getElementById(id){return this.querySelector('#'+id);}
  querySelector(selector) { return this.find(selector)[0] || null; }
  querySelectorAll(selector) { return this.find(selector); }
  parse(parent, html) {
    for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
      const attrs = {};
      for (const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      if (!attrs.id && !Object.keys(attrs).some(k => k.startsWith('data-'))) continue;
      const node = new MiniNode(this, match[1], attrs, parent);
      const rest = html.slice(match.index + match[0].length);
      if (match[1] === 'textarea') node.value = decode(rest.split('</textarea>')[0]);
      if (match[1] === 'select') {
        const options = rest.split('</select>')[0];
        const chosen = /<option\b[^>]*value="([^"]*)"[^>]*\bselected[^>]*>/.exec(options) || /<option\b[^>]*value="([^"]*)"[^>]*>/.exec(options);
        node.value = chosen ? decode(chosen[1]) : '';
      }
    }
  }
}
function fixture(records) { return { ...C.createEmptyState(), records }; }
function event(id = 'event-1', interactions = []) { return { id, date: '2026-10-28', event_type: 'performance', event_name: '测试演出', city: '测试城市', venue: '测试场地', ticket_fee: 0, drink_fee: 0, interactions }; }
function launch(input, options = {}) {
  const document = new MiniDocument(), writes = [], exports = [], photoRequests=[], savedPhotos=[];
  const bridge = {
    readState: () => JSON.stringify(input),
    pickPhoto: token=>photoRequests.push(token),
    savePhotoToGallery: src=>savedPhotos.push(src),
    lastExportTime:()=>options.lastExportTime||0,
    writeState: text => { writes.push(JSON.parse(text)); return '{"ok":true}'; },
    exportBackup: text => { if (Buffer.byteLength(text) > 50 * 1024 * 1024) throw new Error('数据超过 10 MB'); exports.push(text); },
    readPreviousState: () => options.previous || '', importBackup() {}
  };
  let sequence=0;
  const sandbox = { document, AndroidBridge: bridge, console, confirm: () => true, setTimeout: () => 1, clearTimeout() {}, scrollTo() {}, crypto: { randomUUID: () => '01234567-89ab-cdef-0123-'+String(++sequence).padStart(12,'0') } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(base, 'core.js'), 'utf8'), sandbox);
  // Statistics rendering has its own tests. This widget invokes the exact
  // public callback the real ranked-name button uses, with core-derived names.
  sandbox.IdolStats = {
    render: () => '<button id="review-ranked-name">查看成员</button>',
    renderFootprints: () => '',
    bind: ctx => document.querySelector('#review-ranked-name')?.addEventListener('click', () => { const row = ctx.C.stats(ctx.records).ranking[0]; ctx.onMember(row.name, row.kind); })
  };
  vm.runInContext(fs.readFileSync(path.join(base, 'people.js'), 'utf8'), sandbox);
  for(const name of ['extras.js','photos.js'])vm.runInContext(fs.readFileSync(path.join(base,name),'utf8'),sandbox);
  vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8'), sandbox);
  const get = selector => { const node = document.querySelector(selector); assert.ok(node, 'Missing control: ' + selector); return node; };
  return { document, sandbox, writes, exports, photoRequests, savedPhotos, get, click: selector => get(selector).click() };
}

test('UI export preserves a valid near-limit state without pretty-print expansion', () => {
  const item = { id: 'item-a', type: 'cheki', cheki_type: 'individual', member: '甲', benefit_format: 'cheki', price_per_ticket: 1, tickets: 1, total_cost: 1, note: '备注' };
  const records = Array.from({ length: 22000 }, (_, i) => ({ ...event('id-' + i, [item]), created_at: '2026-10-28T12:00:00' }));
  const input = fixture(records);
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 10 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(input, null, 2)) > 10 * 1024 * 1024);
  const app = launch(input);
  app.click('#nav [data-tab=backup]'); app.click('#export-full');
  assert.equal(app.exports.length, 1, 'valid saved data must remain exportable');
  assert.ok(Buffer.byteLength(app.exports[0]) < 50 * 1024 * 1024);
  assert.equal(JSON.parse(app.exports[0]).records.length, records.length);
});

test('numeric legacy member names open the same totals shown by rankings', () => {
  const app = launch(fixture([event('numeric-member', [{ type: 'individual', member: 42, tickets: 1, total_cost: 10 }])]));
  app.click('#nav [data-tab=records]'); app.click('[data-period=all]'); app.click('#nav [data-tab=stats]'); app.click('[data-stats-section=overview]'); app.click('[data-period=all]'); app.click('#review-ranked-name');
  assert.match(app.get('#modal-body').innerHTML, /1 张/);
  assert.match(app.get('#modal-body').innerHTML, /¥10\.00/);
});

test('backup and detail UI contain no image controls or image retention claims', () => {
  const input = fixture([event('old-picture', [{ type: 'individual', member: '测试成员', tickets: 1, total_cost: 10, image: 'legacy.jpg' }])]);
  input.assets = { images: { 'legacy.jpg': 'data:image/jpeg;base64,AAAA' } };
  const app = launch(input);
  app.click('[data-event]');
  assert.doesNotMatch(app.get('#modal-body').innerHTML, /<img\b|附图|记录附图/);
  app.click('#modal-close'); app.click('#nav [data-tab=backup]');
  assert.doesNotMatch(app.get('#main').innerHTML, /张图片|包含图片|预算与图片|活动和图片/);
  app.click('#export-full');
  const exported = app.exports[0];
  assert.ok(exported);
  assert.doesNotMatch(exported, /legacy\.jpg|data:image/);
});


test('editing notes keeps discounted totals; changing quantity updates only the same activity', () => {
  const app = launch(fixture([event('discounted', [{ id: 'discount-item', type: 'cheki', cheki_type: 'individual', member: '测试成员', benefit_format: 'cheki', price_per_ticket: 50, tickets: 2, total_cost: 90, note: '原备注' }])]));
  app.click('[data-event]'); app.click('[data-edit-item]');
  app.get('#i-note').value = '修改备注'; app.click('#save-item');
  assert.equal(app.writes.at(-1).records[0].interactions[0].total_cost, 90);
  app.click('[data-edit-item]'); app.get('#i-qty').value = '3'; app.get('#i-qty').dispatch('input'); app.click('#save-item');
  const saved = app.writes.at(-1);
  assert.equal(saved.records.length, 1); assert.equal(saved.records[0].id, 'discounted');
  assert.equal(saved.records[0].interactions[0].total_cost, 150);
  assert.equal(saved.records[0].interactions[0].id, 'discount-item');
});

test('invalid backup does not write data and a damaged startup can restore the previous state', () => {
  const current = fixture([event('preserved')]);
  const app = launch(current);
  app.sandbox.onNativeImport('{"records":42}');
  assert.equal(app.writes.length, 0);
  app.click('#nav [data-tab=backup]'); app.click('#export-full');
  assert.equal(JSON.parse(app.exports[0]).records[0].id, 'preserved');
  const recovering = launch({ __storageError: '主数据损坏' }, { previous: JSON.stringify(current) });
  recovering.click('#error-previous');
  assert.equal(recovering.writes.length, 0, 'preview must not change data');
  recovering.click('#replace-import');
  assert.equal(recovering.writes.length, 1);
  assert.equal(recovering.writes[0].records[0].id, 'preserved');
  assert.doesNotMatch(recovering.get('#main').innerHTML, /数据需要恢复/);
});


test('custom activity names survive Chinese composition without native suggestion popups', () => {
  const app = launch(fixture([event()]));
  app.click('#add-event');
  const name = app.get('#e-name');
  assert.equal(name.attrs.list, undefined);
  assert.equal(name.attrs.autocomplete, 'off');
  assert.doesNotMatch(app.get('#modal-body').innerHTML, /<datalist|\slist=/);
  assert.equal(app.document.querySelector('#event-names-picker'),null);
  name.focus(); name.dispatch('compositionstart');
  name.value = 'xin huo dong'; name.dispatch('input');
  assert.equal(name.value, 'xin huo dong');
  name.value = '新活动 自定义名称'; name.dispatch('compositionend'); name.dispatch('input');
  assert.equal(app.writes.length, 0);
  app.click('#save-event');
  const saved = app.writes.at(-1);
  assert.equal(saved.records.length, 2);
  assert.equal(saved.records.find(row => row.id !== 'event-1').event_name, '新活动 自定义名称');
});

test('activity name is free text without a history picker',()=>{
 const app=launch(fixture([event()]));app.click('#add-event');
 assert.equal(app.document.querySelector('#event-names-picker'),null);
 app.get('#e-name').value='自定义新名称';app.click('#save-event');
 assert.equal(app.writes.at(-1).records.find(row=>row.id!=='event-1').event_name,'自定义新名称');
});

test('city history refreshes venue choices and item history still triggers matching price suggestions', () => {
  const app = launch(fixture([event('event-1', [{type:'cheki',member:'示例成员',tickets:1,price_per_ticket:25,total_cost:25}])]));
  app.click('#add-event');
  app.click('#cities [data-history-index]');
  assert.equal(app.get('#e-city').value, '测试城市');
  app.click('#venues [data-history-index]');
  assert.equal(app.get('#e-venue').value, '测试场地');
  app.click('#modal-close'); app.click('[data-event]'); app.click('#add-item');
  assert.equal(app.get('#i-name').attrs.list, undefined);
  app.click('#names [data-history-index]');
  assert.equal(app.get('#i-name').value, '示例成员');
  app.click('[data-price]');
  app.click('#save-item');
  assert.equal(app.writes.at(-1).records[0].interactions.length, 2);
  assert.equal(app.writes.at(-1).records[0].interactions[1].total_cost, 25);
});


test('member profile editor persists social accounts, multiple groups, color and avatar via normal controls', () => {
  const app=launch(fixture([event('event-1',[{member:'甲',tickets:1,total_cost:10}])]));
  app.click('#nav [data-tab=stats]');app.click('[data-stats-section=members]');app.click('[data-period=all]');
  app.click('[data-member-profile]');app.click('#edit-profile');
  app.get('#profile-r').value='18';app.get('#profile-g').value='52';app.get('#profile-b').value='86';app.get('#profile-groups').value='团A，团B';
  app.click('#add-social');app.get('#social-platform-0').value='自选平台';app.get('#social-account-0').value='自选账号';
  app.sandbox.onNativeAvatar(app.get('#save-profile').dataset.token,'data:image/png;base64,AAAA');
  app.click('#save-profile');
  const saved=app.writes.at(-1);
  assert.equal(saved.members[0].avatar,'data:image/png;base64,AAAA');
  assert.equal(saved.members[0].groups.join(','),'团A,团B');
  assert.equal(saved.members[0].social_accounts[0].account,'自选账号');assert.equal(saved.members[0].color,'#123456');
  app.click('[data-stats-section=groups]');assert.equal(app.document.querySelector('[data-group-profile]'),null);
  app.click('#nav [data-tab=records]');app.click('[data-period=all]');app.click('[data-event]');app.click('[data-edit-item]');
  app.get('#item-identities-role-0').value='团A';app.click('#save-item');
  assert.equal(app.writes.at(-1).records[0].interactions[0].participant_groups[0].group,'团A');
});

test('multi-photo editor and statistics member filter preserve shared identity and money', () => {
  const app=launch(fixture([event()]));
  app.click('[data-event]');app.click('#add-item');
  app.get('#i-kind').value='multi';app.get('#i-kind').dispatch('change');
  app.get('#i-name').value='甲，乙';app.get('#i-name').dispatch('input');
  app.get('#i-price').value='10.01';app.get('#i-price').dispatch('input');
  app.get('#i-shot').value='2026-10-28T19:30';app.click('#save-item');
  const saved=app.writes.at(-1);
  assert.equal(saved.records[0].interactions[0].members.join(','),'甲,乙');
  assert.equal(saved.records[0].interactions[0].total_cost,10.01);
  app.click('#modal-close');app.click('#nav [data-tab=stats]');app.click('[data-stats-section=photos]');app.click('[data-period=all]');
  app.get('#photo-member').value='乙';app.get('#photo-member').dispatch('change');
  assert.match(app.get('#photo-results').innerHTML,/甲 \/ 乙/);
  assert.match(app.get('#photo-results').innerHTML,/2026-10-28 19:30/);
  assert.match(app.get('#photo-results').innerHTML,/¥10.01/);
});


test('statistics enters members with tabs and Android back returns home',()=>{
 const app=launch(fixture([]));app.click('#nav [data-tab=stats]');
 assert.ok(app.document.querySelector('#member-results'));
 assert.equal(app.document.querySelectorAll('[data-stats-section]').length,5);
 assert.equal(app.sandbox.onNativeBack(),true);
 assert.match(app.get('#main').innerHTML,/本月手账/);
});


test('event organizers and multiple lineups are separate from notes and can be selected across modules',()=>{
 const initial=fixture([event('old')]);initial.members=[{name:'成员甲',groups:['档案团'],color:'#FFFFFF'}];
 const app=launch(initial);app.click('#add-event');
 assert.equal(app.document.querySelector('#event-names-picker'),null);
 app.get('#e-name').value='新演出';app.get('#e-organizer').value='新事务所';
 app.click('#performers [data-history-index]');
 app.get('#e-performing').value+='，新团';app.get('#e-note').value='独立备注';app.click('#save-event');
 const latest=app.writes.at(-1).records.find(row=>row.id!=='old');
 assert.equal(latest.organizer,'新事务所');assert.equal(latest.performing_groups.join(','),'档案团,新团');assert.equal(latest.note,'独立备注');
 app.click('#modal-close');app.click('#nav [data-tab=stats]');app.click('[data-stats-section=members]');app.click('#add-profile');
 assert.match(app.get('#profile-group-history').innerHTML,/新团/);
 assert.equal(app.document.querySelectorAll('[data-cheer-color]').length,11);
 assert.equal(app.get('#profile-color').value,'#FFFFFF');
 assert.equal(app.document.querySelector('#social-platform-0'),null);
 app.click('[data-cheer-color="#7EDFFF"]');assert.equal(app.get('#profile-color').value,'#7EDFFF');
 app.get('#profile-name').value='新成员';app.click('#profile-group-history [data-history-index]');app.click('#save-profile');
 assert.equal(app.writes.at(-1).members.find(row=>row.name==='新成员').groups.length,1);
 app.click('[data-stats-section=photos]');assert.equal(app.get('#photo-member').value,'');
});

test('records and statistics hide shared header while record filters preserve their intersection',()=>{
 const input=fixture([event('one',[{member:'甲',total_cost:1}]),{...event('two',[{member:'乙',total_cost:2}]),organizer:'主办乙'}]);
 const app=launch(input);app.click('#nav [data-tab=records]');app.click('[data-period=all]');
 assert.equal(app.document.querySelector('.app-header').classList.contains('hidden'),true);
 app.get('#record-organizer').value='主办乙';app.get('#record-organizer').dispatch('change');
 app.get('#record-member').value='甲';app.get('#record-member').dispatch('change');
 assert.match(app.get('#records-results').innerHTML,/共 0 条/);
 app.get('#record-member').value='乙';app.get('#record-member').dispatch('change');assert.match(app.get('#records-results').innerHTML,/共 1 条/);
 app.click('#nav [data-tab=stats]');assert.ok(app.document.querySelector('#member-results'));
 assert.doesNotMatch(app.get('#main').innerHTML,/统计与回顾/);
 app.click('#nav [data-tab=home]');assert.equal(app.document.querySelector('.app-header').classList.contains('hidden'),false);
 assert.doesNotMatch(app.get('#main').innerHTML,/MY IDOL JOURNAL|每次相见，都值得记下/);
});

test('member ranking defaults to full-history photo counts and profile social rows are removable',()=>{
 const input=fixture([{...event('old',[{member:'甲',tickets:3,total_cost:100}]),date:'2026-01-01'},{...event('new',[{member:'乙',tickets:3,total_cost:30}]),date:'2026-11-10'}]);
 const app=launch(input);app.click('#nav [data-tab=stats]');app.click('[data-stats-section=members]');
 assert.ok(app.get('#member-results').innerHTML.indexOf('data-member-profile="乙"')<app.get('#member-results').innerHTML.indexOf('data-member-profile="甲"'));
 app.get('#member-order').value='cost';app.get('#member-order').dispatch('change');
 assert.ok(app.get('#member-results').innerHTML.indexOf('data-member-profile="甲"')<app.get('#member-results').innerHTML.indexOf('data-member-profile="乙"'));
 app.click('[data-member-profile]');app.click('#edit-profile');app.click('#add-social');
 app.get('#social-platform-0').value='自选平台';app.get('#social-account-0').value='账号';app.click('[data-remove-social]');
 app.click('#save-profile');assert.equal(app.writes.at(-1).members[0].social_accounts.length,0);
});

test('statistics tab order and default periods follow the selected section',()=>{
 const app=launch(fixture([]));app.click('#nav [data-tab=stats]');
 assert.ok(app.document.querySelector('#member-results'));
 assert.equal(app.get('[data-period=all]').classList.contains('active'),true);
 assert.deepEqual(app.document.querySelectorAll('[data-stats-section]').map(node=>node.dataset.statsSection),['overview','members','photos','groups','footprints']);
 for(const section of ['overview','photos','groups','footprints','members']){
  app.click('[data-stats-section='+section+']');
  assert.equal(app.get('[data-period='+(section==='overview'?'month':'all')+']').classList.contains('active'),true);
  app.click('[data-period=year]');
 }
 assert.equal(app.document.querySelector('#member-content'),null);
 assert.equal(app.document.querySelector('#member-scope'),null);
});

test('member metrics include all benefits and follow the top date controls',()=>{
 const input=fixture([{...event('old',[{member:'甲',benefit_format:'homework',tickets:3,total_cost:120}]),date:'2026-01-01'},event('theme',[{member:'乙',benefit_format:'theme',tickets:1,total_cost:60}])]);
 const app=launch(input);app.click('#nav [data-tab=stats]');
 assert.equal(app.get('[data-member-profile]').dataset.memberProfile,'甲');
 app.click('[data-member-profile]');assert.match(app.get('#modal-body').innerHTML,/宿题\/主题/);assert.match(app.get('#modal-body').innerHTML,/¥120.00/);app.click('#modal-close');
 app.click('[data-period=custom]');app.get('#range-start').value='2026-10-01';app.get('#range-start').dispatch('change');app.get('#range-end').value='2026-10-31';app.get('#range-end').dispatch('change');
 assert.equal(app.get('[data-member-profile]').dataset.memberProfile,'乙');
 assert.equal(app.document.querySelector('[data-member-profile=甲]'),null);
});

test('joint organizer editing appends history choices and places venue fees before organizers',()=>{
 const input=fixture([{...event(),organizer:'主办乙'}]);const app=launch(input);app.click('#add-event');
 const html=app.get('#modal-body').innerHTML;
 for(const id of ['e-city','e-venue','e-ticket','e-drink'])assert.ok(html.indexOf('id="'+id+'"')<html.indexOf('id="e-organizer"'));
 app.get('#e-name').value='联合公演';app.get('#e-organizer').value='主办甲';app.click('#organizers [data-history-index]');app.click('#save-event');
 const saved=app.writes.at(-1).records.find(e=>e.id!=='event-1');
 assert.equal(saved.organizers.join(','),'主办甲,主办乙');
 app.click('#modal-close');app.click('#nav [data-tab=records]');app.click('[data-period=all]');
 for(const name of saved.organizers){app.get('#record-organizer').value=name;app.get('#record-organizer').dispatch('change');assert.match(app.get('#records-results').innerHTML,/联合公演/);}
});

test('multi-photo identities save individually and activity changes synchronize every interaction',()=>{
 const input=fixture([event('identity',[{id:'old',member:'甲',tickets:1,total_cost:20}])]);input.members=[{name:'甲',groups:['团A','团B']},{name:'乙',groups:['团A']}];
 const app=launch(input);app.click('[data-event]');app.click('#add-item');app.get('#i-kind').value='multi';app.get('#i-kind').dispatch('change');app.get('#i-name').value='甲，乙';app.get('#i-name').dispatch('input');
 assert.equal(app.get('#item-identities-role-0').value,'团A');assert.equal(app.get('#item-identities-role-1').value,'团A');
 app.get('#item-identities-role-0').value='团B';app.get('#i-price').value='60';app.get('#i-price').dispatch('input');app.click('#save-item');
 let saved=app.writes.at(-1);assert.equal(saved.records[0].interactions[0].participant_groups[0].group,'团A');
 assert.equal(saved.records[0].interactions[1].participant_groups[1].group,'团A');
 app.click('#edit-basics');app.get('#event-identities-role-0').value='团A';app.click('#save-event');
 saved=app.writes.at(-1);assert.equal(saved.records[0].interactions[0].participant_groups[0].group,'团A');assert.equal(saved.records[0].interactions[1].participant_groups[0].group,'团B');
 assert.match(app.get('#modal-body').innerHTML,/甲（团A）/);
 app.click('#modal-close');app.click('#nav [data-tab=stats]');app.click('[data-member-profile="甲"]');app.click('#edit-profile');app.get('#profile-name').value='新甲';app.click('#save-profile');
 saved=app.writes.at(-1);assert.equal(saved.records[0].member_roles[0].member,'新甲');for(const item of saved.records[0].interactions)assert.ok(item.participant_groups.some(role=>role.member==='新甲'));
 app.click('#nav [data-tab=backup]');app.click('#export-full');assert.equal(JSON.parse(app.exports.at(-1)).records[0].member_roles[0].member,'新甲');
});

test('group list sorts by interaction row count independently of amount or ticket quantity',()=>{
 const input=fixture([event('groups',[
  {type:'group',group_name:'金额高',tickets:100,total_cost:1000},
  {type:'group',group_name:'互动多',tickets:1,total_cost:1},
  {type:'group',group_name:'互动多',tickets:1,total_cost:1}
 ])]);const app=launch(input);app.click('#nav [data-tab=stats]');app.click('[data-stats-section=groups]');
 assert.equal(app.get('[data-group-profile]').dataset.groupProfile,'互动多');
});

test('home overview detail amounts counts and pagination agree with summary metrics',()=>{
 const date=new Date(),month=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');
 const input=fixture([{...event('overview',[{member:'甲',tickets:2,total_cost:80},{type:'merch',item_name:'周边',quantity:3,total_cost:20}]),date:month+'-01',ticket_fee:30,drink_fee:10}]);
 const app=launch(input);
 for(const [kind,amount,count] of [['total','140.00','1 条'],['performances','140.00','1 条'],['benefits','80.00','2 张'],['merch','20.00','3 件'],['ticket','30.00','1 条'],['drink','10.00','1 条']]){
  app.click('[data-overview-detail='+kind+']');assert.ok(app.get('#modal-body').innerHTML.includes(amount));assert.ok(app.get('#modal-body').innerHTML.includes(count));app.click('#modal-close');
 }
 app.click('[data-overview-detail=benefits]');app.click('[data-detail-event]');assert.ok(app.document.querySelector('#add-item'));
});

test('one profile save renames every benefit format and participant across all historical activities',()=>{
 const formats=['cheki','signed','unsigned','online','homework','theme','other'];
 const records=formats.map((format,index)=>({...event('rename-'+index,[{id:'item-'+index,member:'旧名',benefit_format:format,tickets:index+1,total_cost:index+10}]),date:'2025-01-'+String(index+1).padStart(2,'0')}));
 records.push({...event('shared',[{cheki_type:'multi',members:['旧名','另一成员'],participant_groups:[{member:'旧名',group:'团A'}],tickets:1,total_cost:99}]),member_roles:[{member:'旧名',group:'团A'}]});
 const input=fixture(records);input.members=[{name:'旧名',groups:['团A']}];
 const baseline=C.stats(records);const app=launch(input);app.click('#nav [data-tab=stats]');app.click('[data-member-profile="旧名"]');app.click('#edit-profile');app.get('#profile-name').value='新名';app.click('#save-profile');
 const saved=app.writes.at(-1);assert.ok(saved);assert.equal(saved.records.flatMap(e=>e.interactions).filter(i=>C.participants(i).includes('新名')).length,8);
 assert.ok(saved.records.every(e=>e.interactions.every(i=>!C.participants(i).includes('旧名'))));
 assert.equal(C.stats(saved.records).total,baseline.total);assert.equal(C.stats(saved.records).ticketCount,baseline.ticketCount);
 assert.equal(saved.members[0].name,'新名');
 app.click('[data-member-profile="新名"]');assert.match(app.get('#modal-body').innerHTML,/8 条互动/);
});

test('statistics hides members and groups without interactions while zero-cost interactions remain visible',()=>{
 const input=fixture([event('free',[{member:'有记录',tickets:1,total_cost:0,affiliated_group:'有互动团'}])]);
 input.members=[{name:'有记录',groups:['有互动团']},{name:'无记录',groups:['空团']}];
 const app=launch(input);app.click('#nav [data-tab=stats]');
 assert.ok(app.document.querySelector('[data-member-profile=有记录]'));assert.equal(app.document.querySelector('[data-member-profile=无记录]'),null);
 app.click('[data-stats-section=groups]');assert.ok(app.document.querySelector('[data-group-profile=有互动团]'));assert.equal(app.document.querySelector('[data-group-profile=空团]'),null);
 app.click('[data-period=custom]');app.get('#range-start').value='2020-01-01';app.get('#range-start').dispatch('change');app.get('#range-end').value='2020-12-31';app.get('#range-end').dispatch('change');
 assert.equal(app.document.querySelector('[data-group-profile]'),null);
 app.click('[data-stats-section=members]');app.click('[data-period=custom]');assert.equal(app.document.querySelector('[data-member-profile]'),null);
});

test('editing an ambiguous legacy affiliation retains its data until an identity is selected',()=>{
 const input=fixture([event('legacy-identity',[{member:'甲',affiliated_groups:['团A','团B'],tickets:1,total_cost:50}])]);
 input.members=[{name:'甲',groups:['团A','团B']}];const app=launch(input);app.click('[data-event]');app.click('[data-edit-item]');app.get('#i-note').value='仅修改备注';app.click('#save-item');
 const saved=app.writes.at(-1);assert.equal(saved.records[0].interactions[0].affiliated_groups.join(','),'团A,团B');assert.equal(saved.records[0].member_roles[0].group,'团A');
});

test('homework activity type remains selectable and new theme cheki is an independent benefit format',()=>{
 const app=launch(fixture([]));app.click('#add-event');app.get('#e-type').value='theme_homework';app.get('#e-type').dispatch('change');app.get('#e-name').value='主题切订单';app.click('#save-event');
 assert.match(app.get('#modal-body').innerHTML,/宿题\/主题/);app.click('#add-item');assert.equal(app.get('#i-form').value,'theme');app.get('#i-name').value='甲';app.get('#i-name').dispatch('input');app.get('#i-price').value='60';app.get('#i-price').dispatch('input');app.click('#save-item');
 assert.equal(app.writes.at(-1).records[0].event_type,'theme_homework');assert.equal(app.writes.at(-1).records[0].interactions[0].benefit_format,'theme');
});

test('independent profile manager can create edit and archive members with no recorded interactions',()=>{
 const app=launch(fixture([]));app.click('#nav [data-tab=stats]');app.click('#manage-members');app.click('#manage-create');app.get('#profile-name').value='未互动成员';app.get('#profile-groups').value='团A，团B';app.click('#save-profile');
 const saved=app.writes.at(-1);assert.equal(saved.members[0].groups.join(','),'团A,团B');assert.ok(app.document.querySelector('[data-manage-member]'));
 app.click('[data-manage-member]');app.get('#profile-name').value='新名字';app.get('#profile-archived').value='archived';app.click('#save-profile');
 assert.equal(app.writes.at(-1).members[0].name,'新名字');assert.equal(app.writes.at(-1).members[0].archived,true);assert.ok(app.writes.at(-1).members[0].aliases.includes('未互动成员'));assert.match(app.get('#modal-body').innerHTML,/已归档/);
 app.click('#modal-close');assert.equal(app.document.querySelector('[data-member-profile]'),null);
});

test('same-name member creation works through profile management with distinct stable IDs',()=>{
 const app=launch(fixture([]));app.click('#nav [data-tab=stats]');app.click('#manage-members');
 for(const group of ['团A','团B']){app.click('#manage-create');app.get('#profile-name').value='同名';app.get('#profile-groups').value=group;app.click('#save-profile');}
 const saved=app.writes.at(-1);assert.equal(saved.members.length,2);assert.notEqual(saved.members[0].id,saved.members[1].id);assert.equal(app.document.querySelectorAll('[data-manage-member]').length,2);
});

test('identity dropdown excludes unrelated event lineups and follows the first profile group',()=>{
 const input=fixture([{...event('show',[{member:'甲',tickets:1,total_cost:10}]),performing_groups:['别人的团']}]);input.members=[{name:'甲',groups:['团A','团B']},{name:'乙',groups:['乙的团']}];
 const app=launch(input);app.click('[data-event]');app.click('[data-edit-item]');const html=app.get('#item-identities').innerHTML;
 assert.match(html,/<select/);assert.match(html,/团A/);assert.match(html,/团B/);assert.doesNotMatch(html,/别人的团|乙的团/);assert.equal(app.get('#item-identities-role-0').value,'团A');
});

test('custom benefit creation and price presets drive quick entry while keeping actual paid totals',()=>{
 const input=fixture([event('show')]);input.members=[{name:'甲',groups:['团A']}];const app=launch(input);app.click('#nav [data-tab=backup]');app.click('#backup-pricing');app.click('#add-benefit-type');app.get('#benefit-name').value='宽幅主题切';app.get('#benefit-photo').value='yes';app.click('#save-benefit');
 const type=app.writes.at(-1).config.benefit_types[0];assert.equal(type.counts_as_photo,true);
 app.click('#add-price');app.get('#preset-name').value='团A宽幅';app.get('#preset-target').value='团A';app.get('#preset-format').value='custom:'+type.id;app.get('#preset-price').value='88';app.click('#save-price');assert.equal(app.writes.at(-1).config.price_presets[0].price,88);
 app.click('#modal-close');app.click('#nav [data-tab=records]');app.click('[data-period=all]');app.click('[data-event]');app.click('#add-item');app.get('#i-name').value='甲';app.get('#i-name').dispatch('input');app.get('#i-form').value='custom:'+type.id;app.get('#i-form').dispatch('change');assert.equal(app.get('#i-price').value,'88.00');assert.equal(app.document.querySelector('#i-total'),null);
 app.get('#i-size').value='5';app.get('#i-signature').value='signed';app.get('#i-themed').value='yes';app.get('#i-price').value='80';app.get('#i-price').dispatch('input');app.click('#save-item');
 const item=app.writes.at(-1).records[0].interactions[0];assert.equal(item.total_cost,80);assert.equal(item.photo_size,'5');assert.equal(item.signature,'signed');assert.equal(item.is_theme,true);assert.equal(item.benefit_label,'宽幅主题切');
});

test('member quick entry keeps the chosen event supports consecutive saves and undo',()=>{
 const input=fixture([event('show',[{member:'甲',tickets:1,total_cost:10}])]);const app=launch(input);app.click('#nav [data-tab=stats]');app.click('[data-member-profile]');app.click('#quick-member');app.click('#quick-open');assert.equal(app.get('#i-name').value,'甲');assert.equal(app.document.querySelector('#save-next-item'),null);
 app.get('#i-price').value='20';app.get('#i-price').dispatch('input');app.click('#save-item');assert.equal(app.writes.at(-1).records[0].interactions.length,2);app.click('#undo-last-item');assert.equal(app.writes.at(-1).records[0].interactions.length,1);
});

test('free multi-ticket event details persist quantity ticket type and session without changing cheki counts',()=>{
 const app=launch(fixture([]));app.click('#add-event');app.get('#e-name').value='免费昼场';app.get('#e-ticket-status').value='free';app.get('#e-ticket-status').dispatch('change');app.get('#e-ticket-quantity').value='2';app.get('#e-ticket-type').value='女性票';app.get('#e-session').value='昼场';app.click('#save-event');
 const saved=app.writes.at(-1).records[0];assert.equal(saved.ticket_is_free,true);assert.equal(saved.ticket_quantity,2);assert.equal(saved.ticket_type,'女性票');assert.equal(saved.session,'昼场');assert.equal(saved.ticket_fee,0);assert.equal(C.stats([saved]).ticketCount,0);assert.match(app.get('#modal-body').innerHTML,/女性票/);
});

test('display and backup reminder settings persist with no update-check control',()=>{
 const app=launch(fixture([]));app.click('#nav [data-tab=backup]');app.click('#backup-preferences');app.get('#pref-theme').value='dark';app.get('#pref-font').value='1.3';app.click('#save-preferences');
 const settings=app.writes.at(-1).config;assert.equal(settings.theme,'dark');assert.equal(settings.font_scale,1.3);assert.equal(settings.backup_reminder_days,0);assert.doesNotMatch(app.get('#main').innerHTML,/检查更新/);
});

test('activity and cheki photo selection captions deletion and exports work through visible controls',()=>{
 const app=launch(fixture([event('show',[{member:'甲',tickets:1,total_cost:10}])]));app.click('[data-event]');app.click('#edit-basics');app.click('#event-photos-add');app.sandbox.onNativePhoto(app.photoRequests.at(-1),'data:image/png;base64,AAAA');app.get('#event-photos-caption-0').value='活动纪念';app.get('#event-photos-caption-0').dispatch('input');app.click('#save-event');assert.equal(app.writes.at(-1).records[0].attachments[0].caption,'活动纪念');
 app.click('[data-edit-item]');app.click('#item-photos-add');app.sandbox.onNativePhoto(app.photoRequests.at(-1),'data:image/jpeg;base64,AAAA');app.click('#save-item');assert.equal(app.writes.at(-1).records[0].interactions[0].attachments.length,1);assert.match(app.get('#modal-body').innerHTML,/data:image\/jpeg;base64,AAAA/);
 app.click('#modal-close');app.click('#nav [data-tab=backup]');app.click('#export-full');let exported=JSON.parse(app.exports.at(-1));assert.equal(exported.records[0].attachments.length,1);assert.equal(exported.records[0].interactions[0].attachments.length,1);
 app.click('#nav [data-tab=records]');app.click('[data-period=all]');app.click('[data-event]');app.click('[data-edit-item]');app.click('#item-photos [data-photo-remove]');app.click('#save-item');assert.equal(app.writes.at(-1).records[0].interactions[0].attachments.length,0);assert.equal(app.writes.at(-1).records[0].attachments.length,1);
});

test('changing only an old interaction identity keeps unknown unit price and actual paid total',()=>{
 const input=fixture([event('show',[{member:'甲',tickets:2,total_cost:61}])]);input.members=[{name:'甲',groups:['团A','团B']}];const app=launch(input);app.click('[data-event]');app.click('[data-edit-item]');app.get('#item-identities-role-0').value='团B';app.get('#item-identities').dispatch('change');app.click('#save-item');const saved=app.writes.at(-1).records[0].interactions[0];assert.equal(saved.total_cost,61);assert.equal(saved.participant_groups[0].group,'团B');
});

test('member merge UI combines two archives and keeps the shared event total',()=>{
 const input=fixture([event('show',[{member:'旧档案',tickets:1,total_cost:50},{member:'主档案',tickets:2,total_cost:100}])]);const app=launch(input);app.click('#nav [data-tab=stats]');app.click('[data-member-profile="旧档案"]');app.click('#edit-profile');app.click('#merge-profile');app.get('#merge-member-target').value=C.legacyMemberId('主档案');app.click('#confirm-member-merge');const saved=app.writes.at(-1);assert.equal(C.stats(saved.records).total,15000);assert.equal(C.memberMetrics(saved).filter(member=>member.count>0).length,1);assert.equal(C.memberMetrics(saved).find(member=>member.name==='主档案').count,3);
});

test('member archive hides the ranking row while preserving all recorded financial totals',()=>{
 const app=launch(fixture([event('show',[{member:'甲',tickets:3,total_cost:90}])]));app.click('#nav [data-tab=stats]');app.click('[data-member-profile]');app.click('#edit-profile');app.get('#profile-archived').value='archived';app.click('#save-profile');const saved=app.writes.at(-1);assert.equal(C.stats(saved.records).total,9000);assert.equal(C.stats(saved.records).ticketCount,3);assert.equal(app.document.querySelector('[data-member-profile]'),null);app.click('#manage-members');assert.ok(app.document.querySelector('[data-manage-member]'));
});

test('stale photo callback cannot alter a newly opened editor with the same host name',()=>{
 const app=launch(fixture([event('show')]));app.click('[data-event]');app.click('#add-item');app.click('#item-photos-add');const stale=app.photoRequests.at(-1);app.click('#modal-close');app.click('[data-event]');app.click('#add-item');app.sandbox.onNativePhoto(stale,'data:image/jpeg;base64,AAAA');assert.doesNotMatch(app.get('#item-photos').innerHTML,/<img/);
});

test('desktop record imports inherit local stable IDs groups and aliases before records are normalized',()=>{
 const input=fixture([]);input.members=[{id:'current-person',name:'现名',aliases:['旧名'],groups:['团A']}];const app=launch(input);app.sandbox.onNativeImport(JSON.stringify([event('desktop',[{member:'旧名',tickets:1,total_cost:50}])]));app.click('#merge-import');const saved=app.writes.at(-1);assert.equal(saved.records[0].interactions[0].member_id,'current-person');assert.equal(saved.records[0].interactions[0].member,'现名');assert.equal(saved.records[0].interactions[0].participant_groups[0].group,'团A');assert.equal(C.memberCatalog(saved).length,1);
});

test('quick entry can create a new activity and carries the selected stable member into its first interaction',()=>{
 const app=launch(fixture([event('old',[{member:'甲',tickets:1,total_cost:10}])]));app.click('#nav [data-tab=stats]');app.click('[data-member-profile]');app.click('#quick-member');app.click('#quick-new-event');app.get('#e-name').value='快捷创建的新活动';app.click('#save-event');assert.equal(app.get('#i-name').value,'甲');app.get('#i-price').value='20';app.get('#i-price').dispatch('input');app.click('#save-item');const saved=app.writes.at(-1);assert.equal(saved.records.length,2);assert.equal(saved.records.find(record=>record.event_name==='快捷创建的新活动').interactions[0].member_id,C.legacyMemberId('甲'));assert.equal(saved.records.find(record=>record.id==='old').interactions.length,1);
});

test('backup reminders remain disabled even for older enabled preferences',()=>{const input=fixture([event()]);input.config.backup_reminder_days=7;const app=launch(input);assert.equal(app.document.querySelector('#backup-reminder'),null);app.click('#nav [data-tab=backup]');app.click('#backup-preferences');assert.equal(app.document.querySelector('#pref-backup'),null);});

test('photo editor enforces twenty attachments before another native file picker is opened',async()=>{
 const app=launch(fixture([event()]));app.click('[data-event]');app.click('#edit-basics');for(let index=0;index<20;index++){app.click('#event-photos-add');app.sandbox.onNativePhoto(app.photoRequests.at(-1),'data:image/png;base64,AAAA');}app.click('#event-photos-add');await Promise.resolve();assert.equal(app.photoRequests.length,20);assert.match(app.get('#form-error').textContent,/20/);app.click('#save-event');assert.equal(app.writes.at(-1).records[0].attachments.length,20);
});

test('saving waits for pending photo processing and cancellation restores a usable draft',()=>{
 const app=launch(fixture([event('show')]));app.click('[data-event]');app.click('#edit-basics');app.click('#event-photos-add');const token=app.photoRequests.at(-1);app.click('#save-event');assert.equal(app.writes.length,0);assert.match(app.get('#form-error').textContent,/照片仍在处理/);app.sandbox.onNativePhoto(token,null);app.click('#save-event');assert.equal(app.writes.at(-1).records[0].attachments.length,0);
});

test('member ranking has no classification expansion while detail keeps it and uses hundred-cheki wording',()=>{
 const app=launch(fixture([event('show',[{member:'长名字成员',tickets:88,total_cost:1760}])]));app.click('#nav [data-tab=stats]');assert.doesNotMatch(app.get('#member-results').innerHTML,/<details|特典分类/);app.click('[data-member-profile]');assert.match(app.get('#modal-body').innerHTML,/特典分类/);assert.match(app.get('#modal-body').innerHTML,/距离百切/);assert.match(app.get('#modal-body').innerHTML,/12 张/);assert.doesNotMatch(app.get('#modal-body').innerHTML,/张\s*\/\s*份/);
});

test('independent phone photos are saved under a member and can move into and out of a specific activity',()=>{
 const input=fixture([event('show')]);input.members=[{name:'甲',groups:['团A']}];const app=launch(input);app.click('#nav [data-tab=photos]');app.click('#add-phone-photo');app.get('#i-name').value='甲';app.get('#i-name').dispatch('input');app.click('#item-photos-add');app.sandbox.onNativePhoto(app.photoRequests.at(-1),'data:image/jpeg;base64,AAAA');app.click('#save-item');let saved=app.writes.at(-1),standalone=saved.records.find(event=>event.standalone_phone);assert.ok(standalone);assert.equal(standalone.interactions[0].member_id,C.legacyMemberId('甲'));assert.equal(C.stats(saved.records).ticketCount,0);const itemId=standalone.interactions[0].id;app.click('[data-edit-item]');app.get('#i-phone-event').value='show';app.click('#save-item');saved=app.writes.at(-1);assert.equal(saved.records.filter(event=>event.standalone_phone).length,0);assert.equal(saved.records.find(event=>event.id==='show').interactions[0].id,itemId);app.click('[data-edit-item]');app.get('#i-phone-event').value='';app.click('#save-item');saved=app.writes.at(-1);assert.equal(saved.records.find(event=>event.id==='show').interactions.length,0);assert.equal(saved.records.find(event=>event.standalone_phone).interactions[0].id,itemId);
});

test('photo navigation has event cheki and phone categories with search-only filtering',()=>{
 const photo={id:'p',data:'data:image/png;base64,AAAA',caption:'匿名'};const input=fixture([{...event('old',[{member:'甲',tickets:1,total_cost:10,attachments:[photo]}]),date:'2026-01-01',attachments:[photo]},{...event('new',[{type:'phone',member:'乙',tickets:1,total_cost:0,attachments:[photo]}]),date:'2026-11-01'}]);const app=launch(input);app.click('#nav [data-tab=photos]');assert.equal(app.document.querySelector('#album-member'),null);assert.equal(app.document.querySelectorAll('[data-album-photo]').length,3);app.click('[data-album-category=phone]');assert.equal(app.document.querySelectorAll('[data-album-photo]').length,1);app.get('#album-search').value='甲';app.get('#album-search').dispatch('input');assert.equal(app.document.querySelectorAll('[data-album-photo]').length,0);app.get('#album-search').value='乙';app.get('#album-search').dispatch('input');app.click('[data-album-photo]');assert.match(app.get('#modal-body').innerHTML,/乙/);
});

test('v1.2.3 UI updates: avatars, synced phone picker, settings rename, organizer management, lightbox, gallery save, and all-time milestone',()=>{
 const now=new Date(),month=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
 const photo={id:'p1',data:'data:image/png;base64,AAAA',caption:'合照说明'};
 const input=fixture([
  {...event('m1',[{member:'甲',tickets:3,total_cost:150},{type:'phone',cheki_type:'group',group_name:'团A',tickets:1,total_cost:30,attachments:[photo]}]),date:month+'-02',organizer:'旧事务所',organizers:['旧事务所'],attachments:[photo]},
  {...event('old1',[{member:'甲',tickets:12,total_cost:600}]),date:'2025-05-01',organizer:'旧事务所',organizers:['旧事务所','联合社']}
 ]);
 input.members=[{name:'甲',groups:['团A'],color:'#123456'}];
 const app=launch(input);
 // Overview displays updated settings hint and separates phone photos from benefits with avatars
 assert.match(app.get('#main').innerHTML,/在设置页设置/);
 assert.doesNotMatch(app.get('#main').innerHTML,/在备份页设置/);
 app.click('[data-overview-detail=benefits]');
 assert.match(app.get('#modal-body').innerHTML,/member-avatar/);
 assert.doesNotMatch(app.get('#modal-body').innerHTML,/团A/);
 app.click('#modal-close');
 app.click('[data-overview-detail=phone]');
 assert.match(app.get('#modal-body').innerHTML,/团A/);
 app.click('#modal-close');
 // Event detail consumption items show member avatars; edit form uses 备注 and omits 本条实付总额 & 保存并记下一位
 app.click('[data-event=m1]');
 assert.match(app.get('#modal-body').innerHTML,/member-avatar/);
 // Event photo preview supports fullscreen zoom lightbox & save to gallery
 app.click('[data-photo-view="event-photo-0"]');
 app.click('#preview-save-photo');
 assert.equal(app.savedPhotos.length,1);
 app.click('#preview-fullscreen');
 assert.equal(app.get('#photo-lightbox').classList.contains('hidden'),false);
 assert.equal(app.get('#lightbox-zoom-reset').textContent,'100%');
 app.click('#lightbox-zoom-in');
 assert.equal(app.get('#lightbox-zoom-reset').textContent,'150%');
 app.click('#lightbox-zoom-out');
 assert.equal(app.get('#lightbox-zoom-reset').textContent,'100%');
 app.click('#lightbox-save');
 assert.equal(app.savedPhotos.length,2);
 assert.equal(app.sandbox.onNativeBack(),true);
 assert.equal(app.get('#photo-lightbox').classList.contains('hidden'),true);
 assert.equal(app.get('#modal').classList.contains('hidden'),false);
 app.click('#photo-back');
 app.click('#add-item');
 assert.equal(app.document.querySelector('#i-total'),null);
 assert.equal(app.document.querySelector('#save-next-item'),null);
 assert.doesNotMatch(app.get('#modal-body').innerHTML,/宿题\/主题题目/);
 assert.match(app.get('#modal-body').innerHTML,/<span>备注<\/span>/);
 app.click('#modal-close');
 // Member detail uses all-time ticket count for 距离百切 even under month filter, and omits 分摊支出 / 每条互动平均
 app.click('#nav [data-tab=stats]');app.click('[data-period=month]');app.click('[data-member-profile="甲"]');
 const memberBody=app.get('#modal-body').innerHTML;
 assert.match(memberBody,/class="actions member-actions"><button id="edit-profile"[^>]*>编辑资料<\/button><button id="quick-member"/);
 assert.match(memberBody,/<span>累计特典<\/span><span>3 张<\/span>/);
 assert.match(memberBody,/<span>距离百切<\/span><span>85 张<\/span>/);
 assert.doesNotMatch(memberBody,/分摊支出|每条互动平均/);
 app.click('#modal-close');
 // Photos page supports fullscreen zoom & save to gallery, and phone form syncs target dropdown
 app.click('#nav [data-tab=photos]');
 app.click('[data-album-photo="0"]');
 app.click('#album-save-photo');
 assert.equal(app.savedPhotos.length,3);
 app.click('#album-preview-img');
 assert.equal(app.get('#photo-lightbox').classList.contains('hidden'),false);
 app.click('#lightbox-close');
 assert.equal(app.get('#photo-lightbox').classList.contains('hidden'),true);
 app.click('#modal-close');
 app.click('#add-phone-photo');
 assert.equal(app.document.querySelector('select#i-kind'),null);
 assert.equal(app.get('#i-kind').value,'phone');
 assert.equal(app.get('#i-name-label').textContent,'成员 / 团体');
 assert.match(app.get('#names').innerHTML,/成员 · 甲/);
 assert.doesNotMatch(app.get('#names').innerHTML,/团体 · 团A/);
 app.click('[data-phone-target=group]');
 assert.match(app.get('#names').innerHTML,/团体 · 团A/);
 assert.doesNotMatch(app.get('#names').innerHTML,/成员 · 甲/);
 app.click('[data-phone-target=member]');
 assert.match(app.get('#names').innerHTML,/成员 · 甲/);
 app.click('[data-phone-target=group]');
 app.click('#names [data-history-index="0"]');
 assert.equal(app.get('#i-name').value,'团A');
 app.get('#i-price').value='40';app.get('#i-price').dispatch('input');
 app.click('#save-item');
 const saved=app.writes.at(-1).records.find(r=>r.standalone_phone);
 assert.equal(saved.interactions[0].group_name,'团A');
 assert.equal(saved.interactions[0].total_cost,40);
 assert.equal(C.stats(app.writes.at(-1).records).ticketCount,15);
 assert.equal(C.stats(app.writes.at(-1).records).phoneCount,2);
 // Settings tab (formerly Backup) removes retired descriptions, retains version, and manages organizers + one-click rename
 app.click('#modal-close');app.click('#nav [data-tab=backup]');
 const backupHtml=app.get('#main').innerHTML;
 assert.match(backupHtml,/<h1>设置<\/h1>/);
 assert.doesNotMatch(backupHtml,/备份与设置|KEEP YOUR MEMORIES SAFE|完整备份包含活动|使用说明|消费按活动日期/);
 assert.match(backupHtml,/1\.2\.3.*Android 8\.0/);
 app.click('#backup-organizers');
 app.click('#organizer-create');
 app.get('#organizer-new-name').value='新预设社';
 app.click('#confirm-organizer-create');
 assert.ok(app.writes.at(-1).config.organizers.includes('新预设社'));
 app.get('#organizer-query').value='旧事务所';
 app.get('#organizer-query').dispatch('input');
 app.click('[data-manage-organizer="0"]');
 app.get('#organizer-rename-input').value='联合社';
 app.click('#confirm-organizer-rename');
 const afterRename=app.writes.at(-1);
 assert.equal(afterRename.records.filter(r=>C.eventOrganizers(r).includes('旧事务所')).length,0);
 assert.deepEqual(C.eventOrganizers(afterRename.records.find(r=>r.id==='m1')),['联合社']);
 assert.deepEqual(C.eventOrganizers(afterRename.records.find(r=>r.id==='old1')),['联合社']);
 const indexHtml=fs.readFileSync(path.join(base,'index.html'),'utf8');
 assert.doesNotMatch(indexHtml,/留住每一次相见|<b>⇄<\/b>备份/);
 assert.match(indexHtml,/Idol Recorder/);
 assert.match(indexHtml,/设置<\/button>/);
});
