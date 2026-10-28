'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../app/src/main/assets/www/core.js');
const event = (overrides = {}) => ({ id: 'event-1', date: '2026-10-28', ticket_fee: 0, drink_fee: 0, interactions: [], ...overrides });
const state = (records, extras = {}) => Core.validateState({ records, ...extras });

test('money uses exact integer cents and rejects invalid values', () => {
  assert.equal(Core.cents('７０．５０'), 7050);
  assert.equal(Core.cents('.5'), 50);
  assert.equal(Core.cents('￥ 0.10'), 10);
  assert.equal(Core.money(Core.cents(.1) + Core.cents(.2)), '0.30');
  assert.equal(Core.money(-500), '-5.00');
  assert.equal(Core.cents('999999999999.99'), 99999999999999);
  for (const value of [-1, NaN, Infinity, '1.001', '1e2', '', null, true, '1000000000000']) assert.throws(() => Core.cents(value));
  assert.throws(() => Core.eventTotal(event({ interactions: [{ price_per_ticket: 999999999999, tickets: 1000000 }] })));
});

test('legacy import preserves unknown fields, old types, IDs, totals and settings', () => {
  const original = event({ custom: { nested: '保留' }, interactions: [{ type: 'group', group_name: '团体', quantity: 2, price_per_ticket: 7.25, image: 'photo.jpg', custom: true }] });
  const result = Core.parseBackup('\uFEFF' + JSON.stringify([original]), { monthly_budget: 123.45, other: true });
  assert.equal(result.records[0].id, 'event-1');
  assert.equal(result.records[0].interactions[0].type, 'group');
  assert.equal(result.records[0].interactions[0].tickets, 2);
  assert.equal(result.records[0].interactions[0].total_cost, 14.5);
  assert.equal(result.records[0].interactions[0].id, undefined);
  assert.deepEqual(result.records[0].custom, original.custom);
  assert.equal(result.config.monthly_budget, 123.45);
  assert.equal(Core.eventTotal(result.records[0]), 1450);
  const full = Core.validateState({ ...result, future: { retained: true } });
  assert.deepEqual(full.future, { retained: true });
  assert.deepEqual(Core.parseBackup(JSON.stringify(full)), full);
});

test('missing event IDs are stable, duplicate known IDs and malformed input are rejected', () => {
  const old = { date: '2026-10-28', interactions: [] };
  const first = state([old, old]);
  assert.notEqual(first.records[0].id, first.records[1].id);
  assert.deepEqual(state([old, old]), first);
  assert.throws(() => state([event(), event()]));
  for (const date of ['2026-02-29', '0000-01-01', '2026-13-01', '2026-04-31', '2026-1-01']) assert.throws(() => state([event({ date })]));
  assert.doesNotThrow(() => state([event({ date: '2024-02-29' })]));
  for (const input of ['{}', '{', '{"records":null}', '{"records":[],"version":3}', '{"records":[],"config":{"__proto__":{"polluted":1}}}']) assert.throws(() => Core.parseBackup(input));
  for (const n of [0, -1, 1.5, 'two']) assert.throws(() => state([event({ interactions: [{ type: 'merch', quantity: n, price: 1 }] })]));
  assert.equal({}.polluted, undefined);
});

test('stats separate fees, benefits and merch without double-counting events', () => {
  const records = state([event({ ticket_fee: .1, drink_fee: .2, interactions: [
    { type: 'cheki', member: 'A', price_per_ticket: 70.5, tickets: 2 },
    { type: 'group', group_name: 'A', price_per_ticket: 100, tickets: 1 },
    { type: 'merch', item_name: '商品', price: 10, quantity: 3 },
    { type: 'individual', member: 'A', price_per_ticket: 0, tickets: 1 }
  ] }), event({ id: 'other', event_type: 'merch_only', date: '2026-10-27' })]).records;
  const s = Core.stats(records);
  assert.equal(s.total, 27130);
  assert.equal(s.ticket, 10);
  assert.equal(s.drink, 20);
  assert.equal(s.benefit, 24100);
  assert.equal(s.merch, 3000);
  assert.equal(s.eventCount, 2);
  assert.equal(s.ticketCount, 4);
  assert.deepEqual(s.eventTypes, { performance: 1, merch_only: 1 });
  assert.equal(s.ranking.length, 2);
  assert.equal(s.ranking[0].count, 3);
});

test('recommendations respect city, target type, benefit format and activity type', () => {
  const records = state([
    event({ id: '1', date: '2026-01-01', city: '北京', venue: '场地甲', event_type: 'performance', interactions: [{ type: 'individual', member: 'A', tickets: 1, price_per_ticket: 70 }] }),
    event({ id: '2', date: '2026-10-27', city: '上海', venue: '场地乙', event_type: 'online_cheki', interactions: [{ type: 'individual', member: 'A', tickets: 1, price_per_ticket: 90 }, { type: 'group', group_name: 'A', tickets: 1, price_per_ticket: 200 }] }),
    event({ id: '3', date: '2026-10-28', city: '北京', venue: '场地丙', event_type: 'other', interactions: [{ type: 'individual', member: 'A', tickets: 1, price_per_ticket: 80 }] })
  ]).records;
  assert.deepEqual(Core.frequent(records, 'venue', { city: '北京' }), ['场地丙', '场地甲']);
  assert.deepEqual(Core.prices(records, 'A', 'individual', 'cheki', 'performance'), [70, 80]);
  assert.deepEqual(Core.prices(records, 'A', 'individual', 'online', 'online_cheki'), [90]);
  assert.deepEqual(Core.prices(records, 'unknown', 'individual', 'cheki', 'performance'), []);
  assert.equal(Core.form({ note: '宿题' }, 'performance'), 'cheki');
});

test('search and filters support all periods, custom text and optional pinyin', () => {
  const records = state([event({ id: 'a', date: '2026-03-31', city: '北京' }), event({ id: 'b', date: '2026-04-01', event_type: 'online_cheki', interactions: [{ type: 'individual', member: '雪', tickets: 1 }] })]).records;
  assert.equal(Core.filterRecords(records, { period: '2026-Q1' }).length, 1);
  assert.equal(Core.filterRecords(records, { period: '2026-04', type: 'online_cheki' }).length, 1);
  assert.equal(Core.filterRecords(records, { period: '2026', query: '雪' }).length, 1);
  assert.equal(Core.filterRecords(records, { query: 'bj', pinyin: { 北: 'bei', 京: 'jing' } }).length, 1);
  assert.throws(() => Core.filterRecords(records, { period: '2026-13' }));
});

test('merge retains record conflicts and distinct IDs while ignoring all legacy images', () => {
  const a = 'data:image/jpeg;base64,AAAA';
  const b = 'data:image/jpeg;base64,BBBB';
  const current = state([event({ event_name: '当前' })], { config: { monthly_budget: 2000 }, assets: { images: { 'photo.jpg': a } } });
  const imported = state([event({ event_name: '历史' }), event({ id: 'new', images: ['photo.jpg'], interactions: [{ image: 'photo.jpg', type: 'individual', tickets: 1 }] })], { config: { monthly_budget: 1000 }, assets: { images: { 'photo.jpg': b } }, unknown: true });
  const result = Core.mergeStates(current, imported);
  assert.equal(result.added, 1);
  assert.equal(result.conflicts, 1);
  assert.equal(Object.hasOwn(result, 'imageConflicts'), false);
  assert.equal(result.state.records.find(e => e.id === 'event-1').event_name, '当前');
  assert.equal(result.state.records.find(e => e.id === 'new').interactions[0].image, undefined);
  assert.equal(result.state.records.find(e => e.id === 'new').images, undefined);
  assert.deepEqual(result.state.assets.images, {});
  assert.equal(result.state.config.monthly_budget, 2000);
  assert.equal(result.state.unknown, true);
  assert.equal(Core.mergeStates(current, current).skipped, 1);
  const again = Core.mergeStates(result.state, imported);
  assert.equal(again.skipped, 1);
  assert.equal(again.conflicts, 1);
  assert.equal(again.added, 0);
  assert.equal(current.records.length, 1);
});

test('obsolete image attachments are ignored even when their payloads are invalid', () => {
  for (const images of [{ '../bad.jpg': 'data:image/jpeg;base64,AAAA' }, { 'bad.svg': 'data:image/svg+xml;base64,AAAA' }, { 'bad.jpg': 'javascript:alert(1)' }, null, [], 123, 'bad payload']) assert.deepEqual(state([], { assets: { images } }).assets, { images: {} });
});

test('period ranges handle cross-year Monday weeks, leap years and prior periods', () => {
  assert.deepEqual(Core.periodRange('week', '2026-01-01'), {
    start: '2025-12-29', end: '2026-01-04', label: '2025-12-29 至 2026-01-04', previousStart: '2025-12-22', previousEnd: '2025-12-28'
  });
  const leap = Core.periodRange('month', '2024-02-29');
  assert.equal(leap.start, '2024-02-01');
  assert.equal(leap.end, '2024-02-29');
  assert.equal(leap.previousStart, '2024-01-01');
  assert.equal(leap.previousEnd, '2024-01-31');
  assert.equal(Core.periodRange('month', '2025-02-20').end, '2025-02-28');
  const quarter = Core.periodRange('quarter', '2026-01-01');
  assert.equal(quarter.start, '2026-01-01');
  assert.equal(quarter.end, '2026-03-31');
  assert.equal(quarter.previousStart, '2025-10-01');
  assert.equal(quarter.previousEnd, '2025-12-31');
  const year = Core.periodRange('year', '2024-02-29');
  assert.equal(year.start, '2024-01-01');
  assert.equal(year.end, '2024-12-31');
  assert.equal(year.previousStart, '2023-01-01');
  assert.equal(year.previousEnd, '2023-12-31');
  assert.equal(Core.periodRange('all').start, '');
});

test('explicit inclusive date ranges take precedence over period', () => {
  const records = state([event({ id: 'a', date: '2025-12-29' }), event({ id: 'b', date: '2026-01-04' }), event({ id: 'c', date: '2026-01-05' })]).records;
  assert.deepEqual(Core.filterRecords(records, { start: '2025-12-29', end: '2026-01-04', period: '2026-06' }).map(e => e.id), ['b', 'a']);
  assert.equal(Core.filterRecords(records, { start: '2026-01-04' }).length, 2);
  assert.equal(Core.filterRecords(records, { end: '2025-12-29' }).length, 1);
  assert.throws(() => Core.filterRecords(records, { start: '2026-01-04', end: '2025-01-04' }));
});

test('venue, city and benefit-form breakdowns reconcile to total', () => {
  const records = state([
    event({ id: 'a', city: '北京', venue: '同名场地', ticket_fee: 10, interactions: [{ type: 'individual', member: 'A', benefit_format: 'signed', tickets: 2, price_per_ticket: 70 }] }),
    event({ id: 'b', city: '上海', venue: '同名场地', drink_fee: 5, event_type: 'online_cheki', interactions: [{ type: 'individual', member: 'A', tickets: 1, price_per_ticket: 80 }] })
  ]).records;
  const s = Core.stats(records);
  assert.equal(s.venues.length, 2);
  assert.equal(s.cities.length, 2);
  assert.equal(s.cities.reduce((sum, row) => sum + row.cost, 0), s.total);
  assert.equal(s.venues.reduce((sum, row) => sum + row.cost, 0), s.total);
  assert.deepEqual(s.forms, { signed: { cost: 14000, count: 2 }, online: { cost: 8000, count: 1 } });
});

test('legacy activity data matches decimal-reference totals without mutating source', () => {
  const raw = [
    event({ id: 'legacy-a', ticket_fee: '12.35', drink_fee: '7.5', interactions: [
      { type: 'individual', member: '示例成员', tickets: 2, price_per_ticket: '70.5' },
      { type: 'merch', item_name: '示例商品', quantity: 3, price: '8.2' }
    ] }),
    event({ id: 'legacy-b', date: '2026-10-27', ticket_fee: '0.1', drink_fee: 0,
      interactions: [{ type: 'group', group_name: '示例团体', total_cost: '19.99', tickets: 1 }] })
  ];
  const before = Buffer.from(JSON.stringify(raw));
  const result = Core.parseBackup(before.toString('utf8'));
  const refCents = value => {
    const [whole, fraction = ''] = String(value || 0).split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  let reference = 0n;
  for (const row of raw) {
    reference += refCents(row.ticket_fee) + refCents(row.drink_fee);
    for (const item of row.interactions || []) {
      reference += item.total_cost == null ? refCents(item.type === 'merch' ? item.price : item.price_per_ticket) * BigInt(item.type === 'merch' ? item.quantity || 1 : item.tickets || item.quantity || 1) : refCents(item.total_cost);
    }
  }
  assert.equal(result.records.length, raw.length);
  assert.equal(BigInt(Core.stats(result.records).total), reference);
  assert.deepEqual(result.records.map(e => e.id).sort(), raw.map(e => e.id).sort());
  assert.deepEqual(Buffer.from(JSON.stringify(raw)), before);
});

test('removed delivery fields remain opaque compatibility data without affecting statistics', () => {
  for (const key of ['expected_date', 'received_date', 'delivery_status']) {
    for (const value of [123, {}, [], null, '2026-02-29', '', 'cancelled', 'legacy-custom-status']) {
      const result = state([event({ interactions: [{ [key]: value, total_cost: 1 }] })]);
      assert.deepEqual(result.records[0].interactions[0][key], value);
      assert.equal(Core.stats(result.records).total, 100);
    }
  }
  assert.deepEqual(state([event({ interactions: [{ note: { old: true }, custom: ['kept'] }] })]).records[0].interactions[0].note, { old: true });
});

test('merchandise quantities and same-name rankings reconcile to the merch total', () => {
  const records = state([event({ interactions: [
    { type: 'merch', item_name: '商品甲', quantity: 2, price: 2.5 },
    { type: 'merch', item_name: '商品甲', quantity: 1, price: 5 },
    { type: 'merch', item_name: '商品乙', quantity: 3, price: 1 },
    { type: 'individual', member: '商品甲', tickets: 9, price_per_ticket: 100 }
  ] })]).records;
  const s = Core.stats(records);
  assert.equal(s.merchCount, 6);
  assert.equal(s.merchRanking.length, 2);
  assert.deepEqual(s.merchRanking[0], { name: '商品甲', count: 3, cost: 1000 });
  assert.equal(s.merchRanking.reduce((sum, row) => sum + row.cost, 0), s.merch);
  assert.equal(s.merchRanking.reduce((sum, row) => sum + row.count, 0), s.merchCount);
});

test('statistics render monthly zero rows, merchandise, empty ranges and all desktop periods', () => {
  require('../app/src/main/assets/www/stats-ui.js');
  const render = (s, kind, anchor = '2026-10-28', customRange = null) => {
    const range = customRange || Core.periodRange(kind, anchor);
    return globalThis.IdolStats.render({ C: Core, state: s, records: Core.filterRecords(s.records, range), range, periodKind: kind, anchor, money: v => '¥' + Core.money(v) });
  };
  const fixture = state([event({ date: '2024-01-10', interactions: [{ type: 'merch', item_name: '<script>alert(1)</script>', quantity: 2, price: 10 }] }), event({ id: 'later', date: '2024-03-10' })]);
  const quarter = render(fixture, 'quarter', '2024-02-01');
  assert.ok(quarter.includes('周边商品'));
  assert.ok(quarter.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!quarter.includes('<script>alert(1)</script>'));
  assert.match(quarter, /2024-02<\/button><\/th><td>0<\/td><td>0<\/td><td>0<\/td><td>¥0\.00<\/td>/);
  assert.ok(quarter.includes('¥20.00'));
  const emptyYear = render(state([]), 'year');
  assert.equal((emptyYear.match(/data-stats-action="month-period"/g) || []).length, 12);
  assert.ok(emptyYear.includes('本时段没有周边购买记录'));
  const long = render(state([]), 'custom', '2026-10-28', { start: '2000-01-01', end: '2026-12-31' });
  assert.ok(long.includes('表格仅显示最近 120 个月'));
  assert.ok(long.includes('展开 120 个月'));
  assert.equal((long.match(/data-stats-action="month-period"/g) || []).length, 12);
  for (const kind of ['week', 'month', 'quarter', 'year', 'all']) assert.ok(render(fixture, kind).includes('id="idol-stats"'));
});

test('schema 1 migration drops images and preserves all non-image records, money, IDs, budget and extensions', () => {
  const source = {
    format: Core.FORMAT, version: 1, app_version: '1.0.0', source_note: { preserved: true },
    records: [event({ event_type: 'theme_homework', created_at: '2026-10-28T12:30:00', custom_event: { a: 1 }, ticket_fee: 12.34, drink_fee: 5.6, interactions: [
      { id: 'old-item', type: 'group', group_name: '旧团体', tickets: 2, price_per_ticket: 7.25, total_cost: 14.5, benefit_format: 'homework', delivery_status: 'waiting', expected_date: '2026-12-01', received_date: '', image: 'legacy.jpg', note: '原备注', custom_item: [1, 'two'] }
    ] })],
    config: { monthly_budget: 2345.67, custom_setting: true },
    assets: { images: { 'legacy.jpg': 'data:image/jpeg;base64,AAAA' }, custom_asset: { keep: true } }
  };
  const before = JSON.stringify(source);
  const migrated = Core.parseBackup(before);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.app_version, '1.1.1');
  const expectedRecords = JSON.parse(JSON.stringify(source.records));
  delete expectedRecords[0].interactions[0].image;
  assert.deepEqual(migrated.records, expectedRecords);
  assert.deepEqual(migrated.config, source.config);
  assert.deepEqual(migrated.assets, { images: {}, custom_asset: { keep: true } });
  assert.deepEqual(migrated.source_note, source.source_note);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(Core.validateState(migrated), migrated);
  assert.deepEqual(Core.parseBackup(JSON.stringify(migrated)), migrated);
  const withoutVersion = JSON.parse(before); delete withoutVersion.version;
  assert.deepEqual(Core.validateState(withoutVersion), migrated);
});

test('new install state is blank, contains no private seed, and returns independent objects', () => {
  const empty = Core.createEmptyState();
  assert.deepEqual(empty, { format: 'idol-tracker-backup', version: 2, app_version: '1.1.1', records: [], config: { monthly_budget: 0 }, assets: { images: {} } });
  assert.deepEqual(Core.validateState(empty), empty);
  empty.records.push(event()); empty.config.monthly_budget = 50; empty.assets.images['private.jpg'] = 'data:image/jpeg;base64,AAAA';
  assert.deepEqual(Core.createEmptyState().records, []);
  assert.equal(Core.createEmptyState().config.monthly_budget, 0);
  assert.deepEqual(Core.createEmptyState().assets.images, {});
});

test('location sorting is deterministic, independent and nonmutating; product sort is fixed to amount', () => {
  require('../app/src/main/assets/www/stats-ui.js');
  const rows = [{ name: 'A', cost: 100, count: 2 }, { name: 'B', cost: 80, count: 4 }, { name: 'C', cost: 100, count: 4 }, { name: 'D', cost: 100, count: 2 }];
  assert.deepEqual(globalThis.IdolStats.sortLocations(rows, 'cost').map(row => row.name), ['C', 'A', 'D', 'B']);
  assert.deepEqual(globalThis.IdolStats.sortLocations(rows, 'count').map(row => row.name), ['C', 'B', 'A', 'D']);
  assert.deepEqual(rows.map(row => row.name), ['A', 'B', 'C', 'D']);
  assert.deepEqual(globalThis.IdolStats.sortLocations([{ name: '同名', city: 'B', cost: 1, count: 1 }, { name: '同名', city: 'A', cost: 1, count: 1 }], 'count').map(row => row.city), ['A', 'B']);
  const s = state([event({ event_type: 'theme_homework', ticket_fee: 5, interactions: [{ type: 'merch', item_name: 'cheap-many', price: 1, quantity: 5 }, { type: 'merch', item_name: 'expensive-one', price: 50, quantity: 1 }] })]);
  const html = globalThis.IdolStats.render({ C: Core, state: s, records: s.records, range: null, periodKind: 'all' });
  assert.ok(html.includes('拍切统计'));
  assert.ok(html.includes('宿题/主题'));
  assert.ok(html.includes('门票'));
  assert.ok(!html.includes('相见排行') && !html.includes('入场 / 参加费'));
  assert.ok(!html.includes('merch-sort') && !html.includes('按商品名'));
  assert.ok(html.indexOf('expensive-one') < html.indexOf('cheap-many'));
  assert.equal((html.match(/data-stats-action="location-sort"/g) || []).length, 4);
});

test('location sort handlers preserve expanded rows and independent choices across periods', () => {
  require('../app/src/main/assets/www/stats-ui.js');
  const records = Array.from({ length: 9 }, (_, i) => event({ id: 'loc-' + i, city: String.fromCharCode(65 + i), venue: '场地' + i, ticket_fee: i * 10 }));
  records.push(event({ id: 'more-a', city: 'A', venue: '场地0' }));
  const s = state(records), ctx = { C: Core, state: s, records: s.records, range: Core.periodRange('month', '2026-10-28'), periodKind: 'month' };
  const fragments = {}, host = { contains: () => true, querySelector: selector => fragments[selector] || (fragments[selector] = { innerHTML: '' }), querySelectorAll: () => [] };
  const originalDocument = globalThis.document;
  globalThis.document = { querySelector: () => host };
  const click = dataset => { const button = { dataset }; host.onclick({ target: { closest: () => button } }); };
  try {
    globalThis.IdolStats.render(ctx); globalThis.IdolStats.bind(ctx);
    click({ statsAction: 'cities-expanded' });
    click({ statsAction: 'location-sort', location: 'cities', sort: 'count' });
    assert.equal((fragments['#stats-cities'].innerHTML.match(/class="stats-location"/g) || []).length, 9);
    assert.ok(fragments['#stats-cities'].innerHTML.indexOf('<strong>A</strong>') < fragments['#stats-cities'].innerHTML.indexOf('<strong>I</strong>'));
    const next = { ...ctx, range: Core.periodRange('year', '2026-10-28'), periodKind: 'year' };
    const html = globalThis.IdolStats.render(next);
    assert.match(html, /data-location="cities" data-sort="count" class="active"/);
    assert.match(html, /data-location="venues" data-sort="cost" class="active"/);
    assert.ok(html.includes('2026-01-01 至 2026-12-31'));
    globalThis.IdolStats.bind(next);
    click({ statsAction: 'location-sort', location: 'venues', sort: 'count' });
    const after = globalThis.IdolStats.render(next);
    assert.match(after, /data-location="cities" data-sort="count" class="active"/);
    assert.match(after, /data-location="venues" data-sort="count" class="active"/);
  } finally { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; }
});

test('equal-cost merchandise uses only product name as tie-breaker, never quantity', () => {
  require('../app/src/main/assets/www/stats-ui.js');
  const s = state([event({ interactions: [
    { type: 'merch', item_name: 'Z-more', price: 1, quantity: 10 },
    { type: 'merch', item_name: 'A-less', price: 10, quantity: 1 },
    { type: 'merch', item_name: 'M-highest', price: 11, quantity: 1 }
  ] })]);
  assert.deepEqual(Core.stats(s.records).merchRanking.map(row => row.name), ['M-highest', 'A-less', 'Z-more']);
  const html = globalThis.IdolStats.render({ C: Core, state: s, records: s.records, range: null, periodKind: 'all' });
  assert.ok(html.indexOf('M-highest') < html.indexOf('A-less'));
  assert.ok(html.indexOf('A-less') < html.indexOf('Z-more'));
});

test('1.1.0 schema 2 data drops images without changing other fields and remains idempotent', () => {
  const previous = state([event({ ticket_fee: 12.34, custom: { retained: true }, interactions: [{ id: 'item-110', type: 'merch', item_name: '商品', price: 7.25, quantity: 2, total_cost: 14.5, image: 'photo.jpg', delivery_status: 'legacy' }] })], { config: { monthly_budget: 987.65, extra: 'kept' }, assets: { images: { 'photo.jpg': 'data:image/jpeg;base64,AAAA' } }, extension: [1, 2, 3] });
  previous.app_version = '1.1.0';
  previous.records[0].interactions[0].image = 'photo.jpg';
  previous.assets.images['photo.jpg'] = 'data:image/jpeg;base64,AAAA';
  const source = JSON.stringify(previous), expected = JSON.parse(JSON.stringify(previous));
  expected.app_version = '1.1.1';
  delete expected.records[0].interactions[0].image;
  expected.assets.images = {};
  const migrated = Core.parseBackup(source);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated, expected);
  assert.deepEqual(Core.validateState(migrated), migrated);
  assert.deepEqual(Core.parseBackup(JSON.stringify(migrated)), migrated);
  assert.equal(JSON.stringify(previous), source);
});

test('image reference removal is recursive, handles legacy flat attachments, and leaves non-image data untouched', () => {
  const referenceFields = ['image', 'image_name', 'photo', 'photo_name', 'images', 'photos', 'image_files', 'image_data', 'photo_data', 'image_url', 'photo_url', 'image_path', 'photo_path', 'IMAGE'];
  const imageFields = Object.fromEntries(referenceFields.map(key => [key, key.endsWith('s') ? ['private.jpg'] : 'private.jpg']));
  const item = { id: 'legacy-item', type: 'merch', item_name: '周边', price: 12.34, quantity: 2, total_cost: 24.68, ...imageFields, custom: { ...imageFields, keep: ['plain', { text: '原备注' }], inline: 'data:image/jpeg;base64,AAAA', mixed: ['plain', 'data:image/png;base64,BBBB', 4] } };
  const source = { version: 1, app_version: '1.0.0', records: [event({ ...imageFields, event_type: 'performance', ticket_fee: 8.8, interactions: [item] })], config: { monthly_budget: 2000, keep: true }, assets: { 'private.jpg': 'data:image/jpeg;base64,AAAA', 'document.txt': 'plain attachment', metadata: { keep: true } }, custom: { keep: 'retained', ...imageFields } };
  const before = JSON.stringify(source), migrated = Core.parseBackup(before);
  const record = migrated.records[0], migratedItem = record.interactions[0];
  for (const key of referenceFields) {
    assert.equal(Object.hasOwn(record, key), false);
    assert.equal(Object.hasOwn(migratedItem, key), false);
    assert.equal(Object.hasOwn(migratedItem.custom, key), false);
    assert.equal(Object.hasOwn(migrated.custom, key), false);
  }
  assert.deepEqual(migratedItem.custom, { keep: ['plain', { text: '原备注' }], mixed: ['plain', 4] });
  assert.deepEqual(migrated.assets, { 'document.txt': 'plain attachment', metadata: { keep: true }, images: {} });
  assert.equal(migratedItem.id, 'legacy-item');
  assert.equal(record.id, 'event-1');
  assert.equal(Core.stats(migrated.records).total, 3348);
  assert.deepEqual(migrated.config, source.config);
  assert.deepEqual(Core.parseBackup(JSON.stringify(migrated)), migrated);
  assert.ok(!JSON.stringify(migrated).includes('data:image/'));
  assert.equal(JSON.stringify(source), before);
  const rawList = Core.parseBackup(JSON.stringify(source.records), source.config);
  assert.deepEqual(rawList.records, migrated.records);
  const otherImages = JSON.parse(before);
  otherImages.records[0].interactions[0].image = 'different.jpg';
  const merge = Core.mergeStates(migrated, otherImages);
  assert.equal(merge.skipped, 1);
  assert.equal(merge.conflicts, 0);
  assert.equal(merge.added, 0);
});

test('price recommendations tolerate legacy non-string creation timestamps without mutating records', () => {
  const records = state([
    event({ id: 'legacy', created_at: 123, interactions: [{ type: 'individual', member: 'A', price_per_ticket: 17, tickets: 1 }] }),
    event({ id: 'dated', created_at: '2026-10-28T09:00:00', interactions: [{ type: 'individual', member: 'A', price_per_ticket: 21, tickets: 1 }] })
  ]).records;
  assert.deepEqual(Core.prices(records, 'A', 'individual', 'cheki', 'performance'), [21, 17]);
  assert.equal(records.find(row => row.id === 'legacy').created_at, 123);
});

// Minimal DOM surface used by the real event binding. The callbacks are the
// production bind handlers; tests observe header, detail and selected columns.
function withTrendHarness(initialContext, run) {
  require('../app/src/main/assets/www/stats-ui.js');
  const originalDocument = globalThis.document;
  let elements = {}, columns = [];
  const host = {
    contains: element => columns.includes(element),
    querySelector: selector => elements[selector],
    querySelectorAll: selector => selector === '[data-stats-action="trend"]' ? columns : []
  };
  const harness = {
    mount(ctx) {
      const html = globalThis.IdolStats.render(ctx);
      elements = {
        '#stats-trend-caption': { textContent: html.match(/<small id="stats-trend-caption">([^<]*)<\/small>/)[1] },
        '#stats-trend-amount': { innerHTML: html.match(/<strong id="stats-trend-amount">([^<]*)<\/strong>/)[1] },
        '#stats-trend-detail': { innerHTML: '' }
      };
      columns = Array.from(html.matchAll(/data-stats-action="trend" data-index="(\d+)"/g), match => {
        const column = { dataset: { statsAction: 'trend', index: match[1] }, selected: false };
        column.classList = { toggle(name, selected) { if (name === 'selected') column.selected = selected; } };
        return column;
      });
      globalThis.IdolStats.bind(ctx);
    },
    click(index) {
      const column = columns[index];
      assert.ok(column, 'requested trend column exists');
      host.onclick({ target: { closest: () => column } });
    },
    get caption() { return elements['#stats-trend-caption'].textContent; },
    get amount() { return elements['#stats-trend-amount'].innerHTML; },
    get detail() { return elements['#stats-trend-detail'].innerHTML; },
    get selected() { return columns.map((column, index) => column.selected ? index : -1).filter(index => index >= 0); }
  };
  globalThis.document = { querySelector: () => host };
  try { harness.mount(initialContext); run(harness); }
  finally { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; }
}

test('monthly trend clicks synchronize header, detail and selection for zero and repeated clicks; render resets peak', () => {
  const s = state([event({ id: 'jan', date: '2026-01-10', ticket_fee: 100.5 }), event({ id: 'mar', date: '2026-03-10', ticket_fee: 300.75 })]);
  const range = Core.periodRange('year', '2026-10-28');
  const ctx = { C: Core, state: s, records: s.records, range, periodKind: 'year', money: value => '¥' + Core.money(value) };
  withTrendHarness(ctx, harness => {
    assert.equal(harness.caption, '最高时段支出');
    assert.equal(harness.amount, '¥300.75');
    for (const [index, amount, start, end, count] of [[0, '¥100.50', '2026-01-01', '2026-01-31', 1], [1, '¥0.00', '2026-02-01', '2026-02-28', 0], [2, '¥300.75', '2026-03-01', '2026-03-31', 1], [2, '¥300.75', '2026-03-01', '2026-03-31', 1], [0, '¥100.50', '2026-01-01', '2026-01-31', 1]]) {
      harness.click(index);
      assert.equal(harness.caption, '所选月份支出');
      assert.equal(harness.amount, amount);
      assert.ok(harness.detail.includes(start + ' 至 ' + end));
      assert.ok(harness.detail.includes(amount + ' · ' + count + ' 条活动'));
      assert.deepEqual(harness.selected, [index]);
    }
    harness.mount(ctx);
    assert.equal(harness.caption, '最高时段支出');
    assert.equal(harness.amount, '¥300.75');
    assert.deepEqual(harness.selected, []);
    const nextRange = Core.periodRange('year', '2027-01-01');
    harness.mount({ ...ctx, range: nextRange, records: Core.filterRecords(s.records, nextRange) });
    assert.equal(harness.caption, '最高时段支出');
    assert.equal(harness.amount, '¥0.00');
    harness.click(0);
    assert.equal(harness.amount, '¥0.00');
    assert.ok(harness.detail.includes('2027-01-01 至 2027-01-31'));
  });
});

test('day, week and year trend buckets update the same header through actual bind events', () => {
  const cases = [
    { kind: 'month', anchor: '2026-01-15', date: '2026-01-02', index: 1, caption: '所选日期支出', expectedDate: '2026-01-02' },
    { kind: 'quarter', anchor: '2026-01-15', date: '2026-01-06', index: 1, caption: '所选周支出', expectedDate: '2026-01-05 至 2026-01-11' },
    { kind: 'custom', range: { start: '2020-01-01', end: '2026-12-31' }, date: '2021-06-06', index: 1, caption: '所选年份支出', expectedDate: '2021-01-01 至 2021-12-31' }
  ];
  for (const row of cases) {
    const s = state([event({ date: row.date, ticket_fee: 12.34 })]);
    const range = row.range || Core.periodRange(row.kind, row.anchor);
    const ctx = { C: Core, state: s, records: s.records, range, periodKind: row.kind, money: value => '¥' + Core.money(value) };
    withTrendHarness(ctx, harness => {
      harness.click(row.index);
      assert.equal(harness.caption, row.caption);
      assert.equal(harness.amount, '¥12.34');
      assert.ok(harness.detail.includes(row.expectedDate));
      assert.deepEqual(harness.selected, [row.index]);
      harness.click(0);
      assert.equal(harness.amount, '¥0.00');
      assert.ok(harness.detail.includes('¥0.00 · 0 条活动'));
      assert.deepEqual(harness.selected, [0]);
    });
  }
});
