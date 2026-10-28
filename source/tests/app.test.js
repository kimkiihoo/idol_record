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
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  set innerHTML(html) { this.doc.nodes = this.doc.nodes.filter(n => n === this || !this.contains(n)); this._html = String(html); this._text = ''; this.doc.parse(this, this._html); }
  get innerHTML() { return this._html; }
  set textContent(text) { this._text = String(text); }
  get textContent() { return this._text || decode(this._html.replace(/<[^>]*>/g, '')); }
  get innerText() { return this.textContent; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {} }); }
  click() { this.dispatch('click'); }
  scrollIntoView() {}
  querySelector(selector) { return this.doc.find(selector, this)[0] || null; }
  querySelectorAll(selector) { return this.doc.find(selector, this); }
}
class MiniDocument {
  constructor() {
    this.nodes = []; this.body = new MiniNode(this, 'body');
    for (const id of ['main', 'modal-title', 'modal-body', 'modal-close', 'add-event', 'toast']) new MiniNode(this, id.includes('close') || id === 'add-event' ? 'button' : 'div', { id }, this.body);
    new MiniNode(this, 'div', { id: 'modal', class: 'hidden' }, this.body);
    new MiniNode(this, 'div', { class: 'sheet' }, this.body);
    const nav = new MiniNode(this, 'nav', { id: 'nav' }, this.body);
    for (const tab of ['home', 'records', 'stats', 'backup']) new MiniNode(this, 'button', { 'data-tab': tab }, nav);
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
  const document = new MiniDocument(), writes = [], exports = [];
  const bridge = {
    readState: () => JSON.stringify(input),
    writeState: text => { writes.push(JSON.parse(text)); return '{"ok":true}'; },
    exportBackup: text => { if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw new Error('数据超过 10 MB'); exports.push(text); },
    readPreviousState: () => options.previous || '', importBackup() {}
  };
  const sandbox = { document, AndroidBridge: bridge, console, confirm: () => true, setTimeout: () => 1, clearTimeout() {}, scrollTo() {}, crypto: { randomUUID: () => '01234567-89ab-cdef-0123-456789abcdef' } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(base, 'core.js'), 'utf8'), sandbox);
  // Statistics rendering has its own tests. This widget invokes the exact
  // public callback the real ranked-name button uses, with core-derived names.
  sandbox.IdolStats = {
    render: () => '<button id="review-ranked-name">查看成员</button>',
    bind: ctx => document.querySelector('#review-ranked-name').addEventListener('click', () => { const row = ctx.C.stats(ctx.records).ranking[0]; ctx.onMember(row.name, row.kind); })
  };
  vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8'), sandbox);
  const get = selector => { const node = document.querySelector(selector); assert.ok(node, 'Missing control: ' + selector); return node; };
  return { document, sandbox, writes, exports, get, click: selector => get(selector).click() };
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
  assert.ok(Buffer.byteLength(app.exports[0]) < 10 * 1024 * 1024);
  assert.equal(JSON.parse(app.exports[0]).records.length, records.length);
});

test('numeric legacy member names open the same totals shown by rankings', () => {
  const app = launch(fixture([event('numeric-member', [{ type: 'individual', member: 42, tickets: 1, total_cost: 10 }])]));
  app.click('#nav [data-tab=records]'); app.click('[data-period=all]'); app.click('#nav [data-tab=stats]'); app.click('#review-ranked-name');
  assert.match(app.get('#modal-body').innerHTML, /1 张 \/ 份/);
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
