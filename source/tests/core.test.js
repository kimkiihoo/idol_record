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
  assert.throws(() => Core.parseBackup('\uFEFF' + JSON.stringify([original])), /桌面/);
  const result = Core.parseBackup('\uFEFF' + JSON.stringify({ format: Core.FORMAT, version: 7, app_version: '1.2.0', records: [original], config: { monthly_budget: 123.45, other: true } }));
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
  for (const input of ['{}', '{', '{"records":null}', '{"records":[],"version":8}', '{"records":[],"config":{"__proto__":{"polluted":1}}}']) assert.throws(() => Core.parseBackup(input));
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
  assert.throws(() => Core.parseBackup(before.toString('utf8')), /桌面/);
  const result = Core.parseBackup(JSON.stringify({ format: Core.FORMAT, version: 7, app_version: '1.2.1', records: raw }));
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
  assert.ok(!quarter.includes('id="stats-monthly"'));
  assert.ok(quarter.includes('data-stats-action="monthly-detail"'));
  assert.ok(quarter.includes('¥20.00'));
  const emptyYear = render(state([]), 'year');
  assert.equal((emptyYear.match(/data-stats-action="month-period"/g) || []).length, 0);
  assert.ok(emptyYear.includes('本时段没有周边购买记录'));
  const long = render(state([]), 'custom', '2026-10-28', { start: '2000-01-01', end: '2026-12-31' });
  assert.ok(long.includes('data-stats-action="monthly-detail"'));
  assert.equal((long.match(/data-stats-action="month-period"/g) || []).length, 0);
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
  assert.throws(() => Core.parseBackup(before), /v1\.2\.0/);
  const migrated = Core.parseBackup(before, { allowLegacy: true });
  assert.equal(migrated.version, 7);
  assert.equal(migrated.app_version, '1.3.3');
  const expectedRecords = JSON.parse(JSON.stringify(source.records));
  delete expectedRecords[0].interactions[0].image;
  expectedRecords[0].ticket_quantity=1;expectedRecords[0].ticket_type='付费';expectedRecords[0].ticket_is_free=false;expectedRecords[0].member_roles=[];expectedRecords[0].interactions[0].participant_groups=[];
  assert.deepEqual(migrated.records, expectedRecords);
  assert.deepEqual(migrated.config, {...source.config,backup_reminder_days:0});
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
  assert.deepEqual(empty, { format: 'idol-tracker-backup', version: 7, app_version: '1.3.3', records: [], members: [], config: { monthly_budget: 0, backup_reminder_days: 0 }, assets: { images: {} } });
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
  assert.ok(!html.includes('id="stats-ranking"'));
  assert.ok(html.includes('宿题/主题'));
  assert.ok(html.includes('门票'));
  assert.ok(!html.includes('相见排行') && !html.includes('入场 / 参加费'));
  assert.ok(!html.includes('merch-sort') && !html.includes('按商品名'));
  assert.ok(html.indexOf('expensive-one') < html.indexOf('cheap-many'));
  assert.equal((html.match(/data-stats-action="location-sort"/g) || []).length, 0);
  const footprints=globalThis.IdolStats.renderFootprints({C:Core,state:s,records:s.records,range:null});
  assert.equal((footprints.match(/data-stats-action="location-sort"/g)||[]).length,6);
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
    globalThis.IdolStats.renderFootprints(ctx); globalThis.IdolStats.bind(ctx);
    click({ statsAction: 'cities-expanded' });
    click({ statsAction: 'location-sort', location: 'cities', sort: 'count' });
    assert.equal((fragments['#stats-cities'].innerHTML.match(/class="stats-location"/g) || []).length, 9);
    assert.ok(fragments['#stats-cities'].innerHTML.indexOf('<strong>A</strong>') < fragments['#stats-cities'].innerHTML.indexOf('<strong>I</strong>'));
    const next = { ...ctx, range: Core.periodRange('year', '2026-10-28'), periodKind: 'year' };
    const html = globalThis.IdolStats.renderFootprints(next);
    assert.match(html, /data-location="cities" data-sort="count" class="active"/);
    assert.match(html, /data-location="venues" data-sort="cost" class="active"/);
    assert.ok(html.includes('2026-01-01 至 2026-12-31'));
    globalThis.IdolStats.bind(next);
    click({ statsAction: 'location-sort', location: 'venues', sort: 'count' });
    const after = globalThis.IdolStats.renderFootprints(next);
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
  previous.version = 2;
  previous.records[0].interactions[0].image = 'photo.jpg';
  previous.assets.images['photo.jpg'] = 'data:image/jpeg;base64,AAAA';
  const source = JSON.stringify(previous), expected = JSON.parse(JSON.stringify(previous));
  expected.app_version = '1.3.3';
  expected.version = 7;
  delete expected.records[0].interactions[0].image;
  expected.assets.images = {};
  assert.throws(() => Core.parseBackup(source), /v1\.2\.0/);
  const migrated = Core.parseBackup(source, { allowLegacy: true });
  assert.equal(migrated.version, 7);
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
  const before = JSON.stringify(source), migrated = Core.validateState(source);
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
  assert.deepEqual(migrated.config, {...source.config,backup_reminder_days:0});
  assert.deepEqual(Core.parseBackup(JSON.stringify(migrated)), migrated);
  assert.ok(!JSON.stringify(migrated).includes('data:image/'));
  assert.equal(JSON.stringify(source), before);
  assert.throws(() => Core.parseBackup(JSON.stringify(source.records)), /桌面/);
  const rawList = Core.parseBackup(JSON.stringify({ format: Core.FORMAT, version: 7, app_version: '1.2.0', records: source.records, config: source.config }));
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


test('member avatars and multi-group profiles survive schema-4 backup and migration remains idempotent', () => {
  const input = { version: 2, app_version: '1.1.2', records: [event()], config: { monthly_budget: 99 } };
  const migrated = Core.validateState(input);
  assert.equal(migrated.version, 7);
  assert.deepEqual(migrated.members, []);
  const avatar = 'data:image/png;base64,AAAA';
  migrated.members = [{name:'甲',avatar,color:'#123456',groups:['团A','团B','团A'],weibo:'@甲',douyin:'dy-id',xiaohongshu:'xhs-id'}];
  const result = Core.validateState(migrated);
  assert.equal(result.members[0].avatar, avatar);
  assert.deepEqual(result.members[0].groups, ['团A','团B']);
  assert.deepEqual(Core.parseBackup(JSON.stringify(result)), result);
  assert.deepEqual(Core.validateState(result), result);
  for (const profile of [{name:'甲',avatar:'javascript:alert(1)'},{name:'甲',color:'red'},{name:''}]) assert.throws(()=>Core.validateState({...result,members:[profile]}));
});

test('multi-member photos count once globally and split cents exactly across participating members', () => {
  const data = state([event({interactions:[{type:'cheki',cheki_type:'multi',members:['甲','乙','甲'],tickets:2,total_cost:10.01,benefit_format:'signed'},{type:'group',group_name:'团A',tickets:1,total_cost:5}]})]);
  const s=Core.stats(data.records);
  assert.equal(s.total,1501);assert.equal(s.ticketCount,3);assert.equal(s.interactionCount,2);
  assert.equal(s.ranking.find(row=>row.name==='甲').cost,501);
  assert.equal(s.ranking.find(row=>row.name==='乙').cost,500);
  assert.equal(s.ranking.find(row=>row.name==='甲').count,2);
  assert.equal(s.ranking.reduce((sum,row)=>sum+row.cost,0),1501);
  assert.equal(Core.kind(data.records[0].interactions[0]),'multi');
  assert.equal(Core.interactionRows(data,{member:'乙'}).length,1);
  assert.equal(Core.interactionRows(data,{member:'团A'}).length,0);
  assert.throws(()=>state([event({interactions:[{cheki_type:'multi',members:['甲','甲'],tickets:1,total_cost:1}]})]));
});

test('photo time ordering, member queries and explicit-versus-profile group attribution are consistent', () => {
  const data=state([event({id:'first',date:'2026-10-02',interactions:[
    {type:'cheki',member:'甲',tickets:1,total_cost:1,shot_at:'2026-10-01T20:00'},
    {type:'cheki',cheki_type:'multi',members:['甲','乙'],tickets:1,total_cost:3,shot_at:'2026-10-03T10:30',affiliated_groups:['限定团']},
    {type:'group',group_name:'团A',tickets:1,total_cost:2},
    {type:'cheki',member:'甲',tickets:1,total_cost:4,benefit_format:'homework'}
  ]})],{members:[{name:'甲',groups:['团A','团B']},{name:'乙',groups:['团A']}]});
  const rows=Core.interactionRows(data,{photosOnly:true});
  assert.equal(rows.length,3);assert.equal(Core.kind(rows[0].item),'multi');
  assert.equal(Core.interactionRows(data,{photosOnly:true,order:'oldest'})[0].item.total_cost,1);
  assert.equal(Core.interactionRows(data,{photosOnly:true,member:'乙'})[0].item.total_cost,3);
  assert.equal(Core.interactionRows(data,{group:'团A'}).length,3);
  assert.equal(Core.interactionRows(data,{group:'团B'}).length,0);
  assert.equal(Core.interactionRows(data,{group:'限定团'}).length,1);
  assert.equal(Core.interactionRows(data,{photosOnly:true,start:'2026-10-03',end:'2026-10-03'}).length,1);
  assert.equal(Core.interactionRows(data,{dateBasis:'activity',start:'2026-10-02',end:'2026-10-02'}).length,4);
  assert.equal(Core.interactionRows(data,{dateBasis:'activity',start:'2026-10-03',end:'2026-10-03'}).length,0);
  assert.throws(()=>state([event({interactions:[{member:'甲',shot_at:'2026-02-30T18:00'}]})]));
});

test('profile merge retains local conflicts and adds incoming profiles including avatars', () => {
  const local=state([],{members:[{name:'甲',groups:['旧团']}]});
  const incoming=state([],{members:[{name:'甲',groups:['新团']},{name:'乙',avatar:'data:image/png;base64,AAAA',groups:['新团']}]});
  const result=Core.mergeStates(local,incoming);
  assert.equal(result.membersAdded,1);assert.equal(result.memberConflicts,1);
  assert.deepEqual(result.state.members.find(member=>member.name==='甲').groups,['旧团']);
  assert.equal(result.state.members.find(member=>member.name==='乙').avatar,'data:image/png;base64,AAAA');
  assert.equal(Core.mergeStates(result.state,incoming).membersAdded,0);
});


test('schema 3 social accounts migrate to editable entries and empty accounts remain empty after reload',()=>{
 const old={version:3,app_version:'1.1.3',records:[],members:[{name:'甲',groups:['团A'],weibo:'@旧微博',douyin:'旧抖音',xiaohongshu:'',avatar:''}]};
 const migrated=Core.validateState(old);
 assert.equal(migrated.version,7);assert.equal(migrated.members[0].color,'#FFFFFF');
 assert.deepEqual(migrated.members[0].social_accounts,[{platform:'微博',account:'@旧微博'},{platform:'抖音',account:'旧抖音'}]);
 assert.equal(migrated.members[0].weibo,undefined);
 migrated.members[0].social_accounts=[];
 assert.deepEqual(Core.parseBackup(JSON.stringify(migrated)).members[0].social_accounts,[]);
 assert.throws(()=>state([],{members:[{name:'甲',social_accounts:[{platform:'',account:'1'}]}]}));
});

test('group catalog unifies performance lineups member profiles and individual or group interactions',()=>{
 const data=state([event({performing_groups:['参演团','共用团'],organizer:'主办A',interactions:[{type:'group',group_name:'团切团',total_cost:0},{member:'甲',total_cost:0,affiliated_group:'消费团'}]})],{members:[{name:'甲',groups:['共用团','档案团']}]});
 assert.deepEqual(new Set(Core.groupCatalog(data)),new Set(['参演团','共用团','团切团','消费团','档案团']));
 assert.deepEqual(Core.validateState(data),data);
});

test('record secondary filters compose with activity type dates venue member and organizer',()=>{
 const data=state([
  event({id:'a',venue:'场地A',organizer:'事务所A',interactions:[{cheki_type:'multi',members:['甲','乙'],total_cost:30}]}),
  event({id:'b',venue:'场地A',organizer:'事务所B',interactions:[{member:'甲',total_cost:10}]}),
  event({id:'c',event_type:'bonus_only',venue:'场地B',interactions:[{member:'乙',total_cost:20}]})
 ]);
 assert.deepEqual(Core.filterRecords(data.records,{type:'performance',venue:'场地A',member:'乙',organizer:'事务所A'}).map(row=>row.id),['a']);
 assert.equal(Core.filterRecords(data.records,{venue:'场地B',member:'甲'}).length,0);
});

test('member quantity ties use latest photo before amount and scope or sorting can be changed independently',()=>{
 const data=state([
  event({id:'old',date:'2026-10-01',interactions:[{member:'甲',tickets:3,total_cost:300},{member:'甲',benefit_format:'homework',tickets:99,total_cost:99}]}),
  event({id:'new',date:'2026-11-10',interactions:[{member:'乙',tickets:3,total_cost:30}]}),
 ],{members:[{name:'无记录'}]});
 assert.deepEqual(Core.memberMetrics(data,{photosOnly:true}).map(row=>row.name),['乙','甲','无记录']);
 assert.equal(Core.memberMetrics(data,{photosOnly:true,sort:'cost'})[0].name,'甲');
 assert.equal(Core.memberMetrics(data,{photosOnly:true,sort:'latest'})[0].name,'乙');
 assert.equal(Core.memberMetrics(data,{photosOnly:true,start:'2026-11-01',end:'2026-11-30'}).find(row=>row.name==='甲').count,0);
 assert.equal(Core.memberMetrics(data,{photosOnly:false}).find(row=>row.name==='甲').count,102);
});

test('footprints track latest activity and monthly summary is reached by the trend detail control',()=>{
 require('../app/src/main/assets/www/stats-ui.js');
 const data=state([event({id:'a',date:'2026-10-01',venue:'旧场地',city:'旧城',ticket_fee:100}),event({id:'b',date:'2026-11-01',venue:'新场地',city:'新城',ticket_fee:1})]);
 assert.equal(globalThis.IdolStats.sortLocations(Core.stats(data.records).venues,'latest')[0].name,'新场地');
 const ctx={C:Core,state:data,records:data.records,range:Core.periodRange('year','2026-11-17'),periodKind:'year'};
 const overview=globalThis.IdolStats.render(ctx);
 assert.ok(overview.includes('monthly-detail'));assert.ok(!overview.includes('id="stats-monthly"'));assert.ok(!overview.includes('stats-cities'));assert.ok(!overview.includes('stats-ranking'));
 let opened='';const original=globalThis.document;
 globalThis.document={querySelector:()=>({})};
 try{globalThis.IdolStats.showMonthly({...ctx,modal:(title,html)=>{opened=html;}});assert.equal((opened.match(/data-stats-action="month-period"/g)||[]).length,2);assert.ok(opened.includes('2026-10'));}
 finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
test('theme cheki legacy detection preserves raw money and includes explicit themes in photo records',()=>{
 const input=state([event({event_type:'theme_homework',event_name:'万圣节主题切',interactions:[{id:'theme',member:'甲',benefit_format:'homework',tickets:1,total_cost:60}]})]);
 const item=input.records[0].interactions[0];
 assert.equal(Core.form(item,'theme_homework',input.records[0]),'theme');
 assert.equal(Core.interactionRows(input,{photosOnly:true}).length,1);
 assert.equal(Core.memberMetrics(input,{photosOnly:false})[0].count,1);
 assert.equal(Core.stats(input.records).forms.theme.cost,6000);
 assert.equal(item.benefit_format,'homework');assert.equal(item.total_cost,60);
 assert.equal(Core.form({benefit_format:'homework',note:'宿题的主题内容'},'performance'),'homework');
 const ordinary=state([event({interactions:[{member:'乙',benefit_format:'homework',tickets:2,total_cost:80}]})]);
 assert.equal(Core.interactionRows(ordinary).length,1);assert.equal(Core.interactionRows(ordinary,{photosOnly:true}).length,0);
});

test('joint organizers each match secondary filters and old single organizer remains compatible',()=>{
 const data=state([event({organizers:['主办甲','主办乙','主办甲'],organizer:'旧显示值'}),event({id:'old',organizer:'旧主办'})]);
 assert.deepEqual(Core.eventOrganizers(data.records[0]),['主办甲','主办乙']);
 for(const organizer of ['主办甲','主办乙'])assert.equal(Core.filterRecords(data.records,{organizer}).length,1);
 assert.equal(Core.filterRecords(data.records,{organizer:'旧主办'}).length,1);
 assert.deepEqual(Core.parseBackup(JSON.stringify(data)),data);
});

test('individual interaction identities override activity defaults and legacy affiliations and cross-group photos filter each participant separately',()=>{
 const input=state([event({member_roles:[{member:'甲',group:'团B'},{member:'乙',group:'团A'}],interactions:[
  {id:'multi',cheki_type:'multi',members:['甲','乙'],affiliated_groups:['旧团'],participant_groups:[{member:'甲',group:'旧团'}],tickets:2,total_cost:100},
  {id:'single',member:'甲',tickets:1,total_cost:30}
 ]})],{members:[{name:'甲',groups:['团A','团B']},{name:'乙',groups:['团A']}]});
 assert.equal(Core.interactionRows(input,{group:'团B'}).length,1);
 assert.equal(Core.interactionRows(input,{group:'团A'}).length,1);
 assert.equal(Core.interactionRows(input,{member:'甲',group:'团A'}).length,0);
 assert.equal(Core.interactionRows(input,{member:'乙',group:'团B'}).length,0);
 assert.equal(Core.interactionRows(input,{member:'甲',group:'团B'}).length,1);
 assert.equal(Core.stats(input.records).ticketCount,3);
 assert.equal(Core.stats(input.records).total,13000);
 assert.deepEqual(Core.parseBackup(JSON.stringify(input)),input);
 assert.equal(input.records[0].interactions[0].participant_groups[0].group,'旧团');
 input.records[0].member_roles[0].group='';
 const unspecified=Core.validateState(input);
 assert.equal(Core.interactionRows(unspecified,{member:'甲',group:'团B'}).length,1);
 assert.equal(Core.interactionRows(unspecified,{member:'甲'}).length,2);
});

test('ambiguous multi-group profiles remain unspecified and identity suggestions use unique lineup intersections',()=>{
 const data=state([event({performing_groups:['团B'],interactions:[{member:'甲',tickets:1,total_cost:30}]})],{members:[{name:'甲',groups:['团A','团B']}]});
 const e=data.records[0],item=e.interactions[0];
 assert.deepEqual(Core.identityGroups(item,data,e,'甲'),['团A']);
 assert.equal(Core.preferredIdentity(item,data,e,'甲'),'团A');
 assert.throws(()=>state([event({member_roles:[{member:'甲',group:'团A'},{member:'甲',group:'团B'}]})]));
 assert.throws(()=>state([event({interactions:[{member:'甲',participant_groups:[{member:'乙',group:'团A'}]}]})]));
});

test('statistics omits empty activity types and months but includes free recorded benefits',()=>{
 require('../app/src/main/assets/www/stats-ui.js');
 const data=state([event({event_type:'bonus_only',interactions:[{member:'甲',tickets:1,total_cost:0}]})]);
 const html=globalThis.IdolStats.render({C:Core,state:data,records:data.records,range:Core.periodRange('year','2026-01-01'),periodKind:'year'});
 assert.ok(html.includes('data-type="bonus_only"'));assert.ok(!html.includes('data-type="performance"'));assert.ok(html.includes('data-detail="benefits"'));assert.ok(!html.includes('data-detail="merch"'));
 const original=globalThis.document;let body='';globalThis.document={querySelector:()=>({})};
 try{globalThis.IdolStats.showMonthly({C:Core,state:data,records:data.records,range:Core.periodRange('year','2026-01-01'),modal:(_,html)=>{body=html;}});assert.equal((body.match(/data-stats-action="month-period"/g)||[]).length,1);assert.ok(body.includes('2026-10'));assert.ok(!body.includes('2026-09'));}
 finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});

test('v1.2 migration assigns stable identities and fills missing historical groups from the first profile group',()=>{
 const original={version:5,app_version:'1.1.5',members:[{name:'甲',groups:['团A','团B']},{name:'乙',groups:['团C']}],config:{monthly_budget:999},records:[event({member_roles:[{member:'乙',group:'团C'}],interactions:[{id:'missing',member:'甲',tickets:2,total_cost:80},{id:'explicit',member:'甲',affiliated_group:'团B',tickets:1,total_cost:60},{id:'shared',cheki_type:'multi',members:['甲','乙'],tickets:1,total_cost:90}]})]};
 const migrated=Core.validateState(original),e=migrated.records[0],id=migrated.members[0].id;
 assert.equal(migrated.version,7);assert.equal(migrated.app_version,'1.3.3');assert.ok(id);
 assert.equal(e.interactions[0].member_id,id);assert.equal(e.interactions[0].participant_groups[0].group,'团A');assert.equal(e.interactions[1].participant_groups[0].group,'团B');assert.deepEqual(e.interactions[2].participant_groups.map(role=>role.group),['团A','团C']);
 assert.equal(Core.stats(migrated.records).total,23000);assert.equal(Core.stats(migrated.records).ticketCount,4);
 assert.deepEqual(Core.validateState(migrated),migrated);assert.equal(original.records[0].interactions[0].member_id,undefined);
});

test('identity candidates contain profile and personal historical groups, excluding foreign lineups and other members groups',()=>{
 const data=state([event({performing_groups:['无关阵容'],interactions:[{member:'甲',affiliated_group:'曾参与团',tickets:1,total_cost:1},{member:'乙',affiliated_group:'乙专属团',tickets:1,total_cost:2}]})],{members:[{name:'甲',groups:['团A','团B']},{name:'乙',groups:['乙专属团']}]});
 assert.deepEqual(Core.memberGroups(data,'甲'),['团A','团B','曾参与团']);
 assert.ok(!Core.memberGroups(data,'甲').includes('无关阵容'));assert.ok(!Core.memberGroups(data,'甲').includes('乙专属团'));
});

test('same-name members remain independent in individual filters rankings and shared photos',()=>{
 const data=state([event({interactions:[{member:'同名',member_id:'person-a',tickets:1,total_cost:30},{member:'同名',member_id:'person-b',tickets:2,total_cost:80},{cheki_type:'multi',members:['同名','同名'],member_ids:['person-a','person-b'],tickets:1,total_cost:101}]})],{members:[{id:'person-a',name:'同名',groups:['团A']},{id:'person-b',name:'同名',groups:['团B']}]});
 assert.equal(Core.memberMetrics(data).length,2);assert.equal(Core.stats(data.records).ranking.length,2);
 assert.equal(Core.interactionRows(data,{member:'person-a'}).length,2);assert.equal(Core.interactionRows(data,{member:'person-b'}).length,2);
 assert.throws(()=>Core.resolveMember(data,'同名'));assert.notEqual(Core.memberLabel(data.members[0],data),Core.memberLabel(data.members[1],data));
 const renamed=Core.renameMember(Core.clone(data),'person-a','甲新');assert.equal(renamed.records[0].interactions[0].member,'甲新');assert.equal(renamed.records[0].interactions[1].member,'同名');assert.deepEqual(renamed.records[0].interactions[2].members,['甲新','同名']);assert.equal(Core.resolveMember(Core.validateState(renamed),'person-a').aliases[0],'同名');
});

test('merging duplicate identities preserves transaction amounts and physical quantities while collapsing self-shared photos',()=>{
 const data=state([event({interactions:[{member:'旧档案',member_id:'source',tickets:1,total_cost:50},{cheki_type:'multi',members:['旧档案','主档案'],member_ids:['source','target'],tickets:2,total_cost:101}]})],{members:[{id:'source',name:'旧档案',groups:['旧团']},{id:'target',name:'主档案',groups:['现团']}]});
 const totals=Core.stats(data.records),merged=Core.mergeMember(data,'source','target');
 assert.equal(merged.members.length,1);assert.equal(Core.stats(merged.records).total,totals.total);assert.equal(Core.stats(merged.records).ticketCount,totals.ticketCount);assert.equal(Core.kind(merged.records[0].interactions[1]),'individual');assert.equal(Core.memberMetrics(merged)[0].count,3);assert.ok(merged.members[0].aliases.includes('旧档案'));assert.deepEqual(Core.parseBackup(JSON.stringify(merged)),merged);
});

test('footprints exclude placeholder locations without removing free visits or affecting spending',()=>{
 const excluded=['/','线上','未统计','未指定 / 线上','-','线上/邮寄','未知城市'];
 const data=state([...excluded.map((name,index)=>event({id:'excluded-'+index,city:name,venue:name,ticket_fee:100})),event({id:'physical',city:'东京',venue:'示例场馆',ticket_fee:0})]);
 const stats=Core.stats(data.records);assert.equal(stats.total,excluded.length*10000);assert.deepEqual(stats.cities.map(row=>row.name),['东京']);assert.deepEqual(stats.venues.map(row=>row.name),['示例场馆']);assert.equal(stats.cities[0].count,1);assert.equal(stats.cities[0].cost,0);
});

test('custom benefits and dimensional price presets apply by specificity with historical price snapshots retained',()=>{
 const data=state([event({interactions:[{member:'甲',benefit_format:'custom:wide',photo_size:'5',signature:'signed',is_theme:true,tickets:2,total_cost:123,price_per_ticket:80}]})],{members:[{name:'甲',groups:['团A']}],config:{benefit_types:[{id:'wide',label:'宽幅切',counts_as_photo:true}],price_presets:[{id:'all',name:'通用',scope:'all',target:'',format:'custom:wide',price:60},{id:'group',name:'团价',scope:'group',target:'团A',format:'custom:wide',price:70},{id:'member',name:'成员价',scope:'member',target:Core.legacyMemberId('甲'),format:'custom:wide',size:'5',signature:'signed',themed:true,price:80}]}});
 assert.equal(Core.presetPrice(data,{member:data.members[0].id,group:'团A',format:'custom:wide',size:'5',signature:'signed',themed:true}).price,80);
 assert.equal(Core.presetPrice(data,{member:data.members[0].id,group:'团A',format:'custom:wide',size:'3',signature:'signed',themed:false}).price,70);
 assert.equal(Core.interactionRows(data,{photosOnly:true}).length,1);assert.match(Core.benefitLabel(data.records[0].interactions[0],data,data.records[0]),/宽幅切.*5寸.*有签.*主题/);
 data.config.price_presets[2].price=999;assert.equal(Core.stats(Core.validateState(data).records).total,12300);
});

test('calendar annual review member details and ticket summaries use their stated date bases',()=>{
 const data=state([event({date:'2026-12-31',city:'北京',ticket_fee:100,ticket_quantity:2,ticket_type:'预售',interactions:[{member:'甲',tickets:2,total_cost:80,shot_at:'2027-01-01T00:30'}]}),event({id:'free',date:'2026-12-30',city:'线上',ticket_fee:0,ticket_quantity:1,ticket_is_free:true,ticket_type:'免费票',interactions:[{member:'乙',tickets:1,total_cost:0}]})]);
 const review=Core.annualSummary(data,'2026');assert.equal(review.stats.total,18000);assert.equal(review.cities,1);assert.equal(review.tickets.quantity,3);assert.equal(review.tickets.free,1);assert.deepEqual(review.members.map(member=>member.name),['乙']);
 const jan=Core.calendarSummary(data,'2027-01')[0];assert.equal(jan.date,'2027-01-01');assert.equal(jan.events.length,0);assert.equal(jan.photos,2);assert.equal(jan.total,0);
 const summary=Core.memberSummary(data,'甲',{start:'2027-01-01',end:'2027-12-31'});assert.equal(summary.count,2);assert.equal(summary.days,1);assert.equal(summary.cost,8000);assert.equal(summary.first,'2027-01-01T00:30');
});

test('activity and cheki attachments survive repeated migrations and backup merging with strict validation',()=>{
 const photo={id:'picture',data:'data:image/png;base64,AAAA',caption:'纪念照'};
 const data=state([event({attachments:[photo],interactions:[{member:'甲',tickets:1,total_cost:50,attachments:[{...photo,id:'cheki-picture'}]}]})]);
 const restored=Core.parseBackup(JSON.stringify(data));assert.deepEqual(restored,data);assert.equal(restored.records[0].attachments[0].data,photo.data);assert.equal(restored.records[0].interactions[0].attachments[0].caption,'纪念照');assert.equal(Core.mergeStates(data,restored).skipped,1);
 assert.throws(()=>state([event({attachments:[{id:'bad',data:'data:image/svg+xml;base64,AAAA'}]})]));assert.throws(()=>state([event({attachments:[photo,photo]})]));assert.throws(()=>state([event({attachments:Array.from({length:21},(_,index)=>({...photo,id:String(index)}))})]));
});

test('historical price suggestions distinguish same-name members by stable ID',()=>{
 const data=state([event({interactions:[{member:'同名',member_id:'a',tickets:1,price_per_ticket:30,total_cost:30},{member:'同名',member_id:'b',tickets:1,price_per_ticket:80,total_cost:80}]})],{members:[{id:'a',name:'同名',groups:['团A']},{id:'b',name:'同名',groups:['团B']}]});assert.deepEqual(Core.prices(data.records,'a','individual','cheki','performance'),[30]);assert.deepEqual(Core.prices(data.records,'b','individual','cheki','performance'),[80]);
});

test('renamed member aliases match activity and photo searches without mixing distinct IDs',()=>{
 const data=state([event({interactions:[{member:'甲',tickets:1,total_cost:50}]})],{members:[{name:'甲',groups:['团A']}]});const renamed=Core.validateState(Core.renameMember(Core.clone(data),data.members[0].id,'新名'));assert.equal(Core.interactionRows(renamed,{query:'甲'}).length,1);assert.equal(Core.filterRecords(renamed.records,{state:renamed,query:'甲'}).length,1);assert.equal(Core.preferredIdentity({participant_groups:[{member:'新名',member_id:renamed.members[0].id,group:''}]},renamed,renamed.records[0],renamed.members[0].id),'');
});

test('profile merge retains unique social accounts notes and original state on validation failure',()=>{
 const data=state([event({interactions:[{member:'来源',member_id:'source',tickets:1,total_cost:50}]})],{members:[{id:'source',name:'来源',note:'来源备注',social_accounts:[{platform:'平台A',account:'甲'}]},{id:'target',name:'保留',note:'保留备注',social_accounts:[{platform:'平台B',account:'乙'}]}]});const before=JSON.stringify(data),merged=Core.mergeMember(data,'source','target');assert.equal(JSON.stringify(data),before);assert.equal(merged.members[0].social_accounts.length,2);assert.match(merged.members[0].note,/来源备注/);assert.match(merged.members[0].note,/保留备注/);
 const large=Core.clone(data);large.members.forEach((profile,index)=>{profile.social_accounts=Array.from({length:20},(_,n)=>({platform:'平台'+index,account:String(n)}));});const largeBefore=JSON.stringify(large);assert.throws(()=>Core.mergeMember(large,'source','target'));assert.equal(JSON.stringify(large),largeBefore);
});

test('price recommendations honor selected photo dimensions while shared photos use their own recorded prices',()=>{
 const data=state([event({interactions:[{member:'甲',tickets:1,total_cost:30,photo_size:'3',signature:'signed',is_theme:false},{member:'甲',tickets:1,total_cost:80,photo_size:'5',signature:'signed',is_theme:true}]})]);const id=Core.legacyMemberId('甲');assert.deepEqual(Core.prices(data.records,id,'individual','cheki','performance',5,{size:'5',signature:'signed',themed:true}),[80]);assert.deepEqual(Core.prices(data.records,id,'individual','cheki','performance',5,{size:'3',signature:'signed',themed:false}),[30]);
});

test('same-name labels remain unambiguous even when explicit member IDs share the same suffix',()=>{
 const data=state([],{members:[{id:'first-suffix',name:'同名',groups:['同团']},{id:'second-suffix',name:'同名',groups:['同团']}]});const labels=data.members.map(profile=>Core.memberLabel(profile,data));assert.notEqual(labels[0],labels[1]);assert.equal(Core.resolveMember(data,labels[0]).id,'first-suffix');assert.equal(Core.resolveMember(data,labels[1]).id,'second-suffix');
});

test('unassigned ticket types infer free or paid from combined ticket and Drink spending',()=>{
 const data=state([event({id:'free',event_type:'performance',ticket_fee:0,drink_fee:0,ticket_type:'未设票种',ticket_quantity:0}),event({id:'drink',event_type:'performance',ticket_fee:0,drink_fee:30,ticket_type:'',ticket_quantity:0}),event({id:'paid',event_type:'performance',ticket_fee:100,drink_fee:20,ticket_type:'',ticket_quantity:2})]);const tickets=Core.ticketSummary(data.records);assert.equal(tickets.quantity,4);assert.equal(tickets.free,1);assert.equal(tickets.paid,3);assert.equal(tickets.cost,15000);assert.deepEqual(tickets.types.map(type=>type.name).sort(),['付费','免费']);assert.equal(data.records.find(event=>event.id==='drink').ticket_is_free,false);assert.equal(Core.stats(data.records).total,15000);
});

test('phone photos bind members but do not inflate cheki quantities or the hundred-cheki milestone',()=>{
 const data=state([event({interactions:[{member:'甲',type:'phone',tickets:2,total_cost:30},{member:'甲',type:'cheki',tickets:88,total_cost:1760}]})]);const totals=Core.stats(data.records);assert.equal(totals.total,179000);assert.equal(totals.ticketCount,88);assert.equal(totals.phoneCount,2);const metrics=Core.memberMetrics(data)[0];assert.equal(metrics.count,88);assert.equal(metrics.phone_count,2);assert.equal(metrics.cost,179000);assert.equal(Core.interactionRows(data,{photosOnly:true}).length,1);assert.equal(Core.interactionRows(data,{member:Core.legacyMemberId('甲')}).length,2);
});

test('member interaction month summaries are sorted newest first',()=>{
 const data=state([{...event({id:'older',interactions:[{member:'甲',tickets:1,total_cost:10}]}),date:'2026-01-01'},{...event({id:'newer',interactions:[{member:'甲',tickets:1,total_cost:10}]}),date:'2026-11-01'}]);assert.deepEqual(Core.memberSummary(data,'甲').months.map(row=>row.name),['2026-11','2026-01']);
});

test('local photo references survive backup normalization and arbitrary external URLs are rejected',()=>{
 const url='https://idol.local/photos/'+'a'.repeat(64)+'.jpg';const data=state([event({attachments:[{id:'photo',data:url,caption:'活动照片'}]})]);assert.equal(Core.parseBackup(JSON.stringify(data)).records[0].attachments[0].data,url);assert.throws(()=>state([event({attachments:[{id:'bad',data:'https://example.com/picture.jpg'}]})]));
});

test('phone photos support group targets and legacy benefit_format=phone without inflating cheki/benefit totals or forms',()=>{
 const data=state([event({interactions:[
  {member:'甲',type:'phone',tickets:2,total_cost:30},
  {type:'phone',cheki_type:'group',group_name:'团A',tickets:1,total_cost:50},
  {member:'甲',type:'cheki',benefit_format:'phone',tickets:3,total_cost:60},
  {member:'甲',type:'cheki',benefit_format:'cheki',tickets:4,total_cost:200}
 ]})]);
 const s=Core.stats(data.records);
 assert.equal(s.total,34000);
 assert.equal(s.ticketCount,4);
 assert.equal(s.phoneCount,6);
 assert.equal(s.benefit,20000);
 assert.equal(s.phone,14000);
 assert.deepEqual(Object.keys(s.forms),['cheki']);
 const summary=Core.memberSummary(data,'甲');
 assert.equal(summary.count,4);
 assert.equal(summary.phoneCount,5);
 assert.deepEqual(summary.forms,[{name:'普通切',count:4}]);
 assert.deepEqual(summary.months,[{name:'2026-10',count:4}]);
 const groupMetrics=Core.memberMetrics(data,{kind:'group'});
 assert.equal(groupMetrics.length,1);
 assert.equal(groupMetrics[0].name,'团A');
 assert.equal(groupMetrics[0].count,0);
 assert.equal(groupMetrics[0].phone_count,1);
 assert.equal(groupMetrics[0].cost,5000);
 assert.equal(Core.groupSummary(data,'团A').records,1);
 assert.equal(Core.calendarSummary(data,'2026-10')[0].photos,4);
});

test('organizerCatalog and renameOrganizer update records, deduplicate joint organizers, and preserve config',()=>{
 const data=state([
  event({id:'e1',organizer:'旧社',organizers:['旧社','联合社']}),
  event({id:'e2',organizer:'旧社'}),
  event({id:'e3',organizer:'无关社'})
 ],{config:{monthly_budget:0,backup_reminder_days:0,organizers:['旧社','未使用社']}});
 assert.deepEqual(Core.organizerCatalog(data).sort(),['旧社','联合社','未使用社','无关社'].sort());
 assert.throws(()=>Core.renameOrganizer(data,'旧社','旧社'));
 assert.throws(()=>Core.renameOrganizer(data,'旧社','甲,乙'));
 assert.throws(()=>Core.renameOrganizer(data,'','新社'));
 const renamed=Core.renameOrganizer(data,'旧社','联合社');
 assert.equal(renamed.updated,2);
 assert.deepEqual(Core.eventOrganizers(renamed.state.records[0]),['联合社']);
 assert.equal(renamed.state.records[0].organizer,'联合社');
 assert.deepEqual(Core.eventOrganizers(renamed.state.records[1]),['联合社']);
 assert.deepEqual(Core.eventOrganizers(renamed.state.records[2]),['无关社']);
 assert.ok(!Core.organizerCatalog(renamed.state).includes('旧社'));
 assert.ok(Core.organizerCatalog(renamed.state).includes('联合社'));
 assert.ok(Core.organizerCatalog(renamed.state).includes('未使用社'));
 const incoming=state([],{config:{organizers:['外部预设']}});
 const merged=Core.mergeStates(renamed.state,incoming);
 assert.ok(Core.organizerCatalog(merged.state).includes('外部预设'));
 assert.ok(Core.organizerCatalog(merged.state).includes('未使用社'));
});

test('upgrading a group phone photo stamped with legacy unknown member cleans synthetic participant_groups',()=>{
 const legacy={format:'idol-tracker-backup',version:7,app_version:'1.2.1',members:[{id:'person-unknown',name:'未知成员',groups:[]}],records:[event({id:'ev-1',member_roles:[{member:'未知成员',member_id:'person-unknown',group:''}],interactions:[{id:'ph-1',type:'phone',cheki_type:'group',group_name:'团A',member:'未知成员',member_id:'person-unknown',participant_groups:[{member:'未知成员',member_id:'person-unknown',group:''}],tickets:1,total_cost:50}]})]};
 const migrated=Core.validateState(legacy);
 assert.equal(Core.isGroupItem(migrated.records[0].interactions[0]),true);
 assert.equal(migrated.records[0].interactions[0].member,undefined);
 assert.equal(migrated.records[0].interactions[0].participant_groups.length,0);
 assert.equal(Core.stats(migrated.records).phoneCount,1);
 assert.equal(Core.stats(migrated.records).ticketCount,0);
});

test('v1.2.4 core: first_met, per-month budgetForMonth, entity avatars/notes, renameGroup, and batch organizer assignments',()=>{
 const avatarImg='data:image/jpeg;base64,AAAA';
 let data=state([
  event({id:'e1',organizer:'旧社',organizers:['旧社'],performing_groups:['旧团'],member_roles:[{member:'甲',group:'旧团'}],interactions:[{member:'甲',tickets:1,total_cost:50,affiliated_group:'旧团'},{type:'group',group_name:'旧团',tickets:1,total_cost:40}]}),
  event({id:'e2',organizer:'其它社',organizers:['其它社'],performing_groups:['B团']})
 ],{
  members:[{id:'m1',name:'甲',groups:['旧团'],first_met:'2024-05-01'}],
  config:{
   monthly_budget:1000,
   monthly_budgets:{'2026-11':2500,'2026-12':0},
   price_presets:[{id:'p1',name:'团体切',scope:'group',target:'旧团',format:'cheki',price:50}]
  }
 });
 assert.equal(Core.budgetForMonth(data.config,'2026-10'),100000);
 assert.equal(Core.budgetForMonth(data.config,'2026-11'),250000);
 assert.equal(Core.budgetForMonth(data.config,'2026-12'),0);
 assert.throws(()=>state([],{config:{monthly_budgets:{'2026-13':100}}}));
 assert.equal(data.members[0].first_met,'2024-05-01');
 assert.throws(()=>state([],{members:[{name:'甲',first_met:'2026-02-30'}]}));
 // Save organizer and group profiles with avatars (preserved through validateState despite omitImages)
 let resOrg=Core.saveOrganizerProfile(data,'旧社',{name:'旧社',avatar:avatarImg,note:'事务所备注'});
 data=resOrg.state;
 let resGrp=Core.saveGroupProfile(data,'旧团',{name:'旧团',avatar:avatarImg,note:'团体备注',organizers:['旧社']});
 data=resGrp.state;
 assert.equal(Core.organizerProfile(data,'旧社').avatar,avatarImg);
 assert.equal(Core.groupProfile(data,'旧团').avatar,avatarImg);
 assert.deepEqual(Core.groupProfile(data,'旧团').organizers,['旧社']);
 // Rename group across members, records, participant_groups, price_presets, and group_profiles
 const grpRenamed=Core.renameGroup(data,'旧团','新团');
 data=grpRenamed.state;
 assert.equal(data.members[0].groups[0],'新团');
 assert.deepEqual(data.records[0].performing_groups,['新团']);
 assert.equal(data.records[0].interactions[0].affiliated_group,'新团');
 assert.equal(data.records[0].interactions[0].participant_groups[0].group,'新团');
 assert.equal(data.records[0].interactions[1].group_name,'新团');
 assert.equal(data.config.price_presets[0].target,'新团');
 assert.equal(Core.groupProfile(data,'新团').avatar,avatarImg);
 assert.deepEqual(Core.groupProfile(data,'新团').organizers,['旧社']);
 // Rename organizer also syncs organizer_profiles AND group_profiles[].organizers
 data=Core.renameOrganizer(data,'旧社','新社').state;
 assert.equal(Core.organizerProfile(data,'新社').avatar,avatarImg);
 assert.deepEqual(Core.groupProfile(data,'新团').organizers,['新社']);
 // Batch assign events and groups cleanly without clobbering other co-organizers
 data=Core.setOrganizerEvents(data,'新社',['e1','e2']).state;
 assert.deepEqual(Core.eventOrganizers(data.records.find(r=>r.id==='e2')).sort(),['其它社','新社'].sort());
 data=Core.setOrganizerGroups(data,'其它社',['新团','B团']).state;
 assert.deepEqual(Core.groupProfile(data,'新团').organizers.sort(),['新社','其它社'].sort());
 assert.deepEqual(Core.groupProfile(data,'B团').organizers,['其它社']);
});

test('v1.2.5 core: merch multi-entity links/renames/merges, online purchase footprint exclusion, and legacy v1.2.0..1.2.4 backup compat',()=>{
 let data=state([
  event({id:'e-merch',date:'2026-10-01',event_type:'merch_only',city:'-',venue:'线上购买',interactions:[
   {type:'merch',item_name:'生写Set',quantity:2,price:40,total_cost:80,merch_members:['甲','乙'],affiliated_groups:['星光团'],merch_organizers:['旧社']},
   {type:'merch',item_name:'老版周边',quantity:1,price:30,total_cost:30}
  ]})
 ]);
 data.members=[{name:'甲',groups:['星光团']},{name:'乙',groups:['星光团']},{name:'主甲',groups:['新团']}];
 data=Core.validateState(data);
 const merchItem=data.records[0].interactions[0];
 assert.equal(merchItem.merch_member_ids.length,2);
 // Merch must NOT inflate member cheki counts
 assert.equal(Core.memberSummary(data,'甲').count,0);
 // '线上购买' is excluded from physical footprints
 assert.equal(Core.isPhysicalLocation('线上购买'),false);
 assert.equal(Core.stats(data.records).venues.length,0);
 assert.equal(Core.stats(data.records).merchCount,3);
 assert.equal(Core.stats(data.records).merch,11000);
 // Organizer & Member filters include multi-target merch
 assert.ok(Core.organizerCatalog(data).includes('旧社'));
 assert.equal(Core.filterRecords(data.records,{state:data,member:Core.resolveMember(data,'甲').id}).length,1);
 assert.equal(Core.filterRecords(data.records,{state:data,organizer:'旧社'}).length,1);
 // renameOrganizer / renameMember / mergeMember synchronize merch fields
 data=Core.renameOrganizer(data,'旧社','新社').state;
 assert.deepEqual(data.records[0].interactions[0].merch_organizers,['新社']);
 data=Core.renameMember(data,Core.resolveMember(data,'甲').id,'改名甲');
 assert.equal(data.records[0].interactions[0].merch_members[0],'改名甲');
 data=Core.mergeMember(data,Core.resolveMember(data,'改名甲').id,Core.resolveMember(data,'主甲').id);
 assert.equal(data.records[0].interactions[0].merch_members[0],'主甲');
 // Backward compatibility with v1.2.0..1.2.4 backups (including legacy is_theme & phone_photo)
 const v124=JSON.stringify({format:'idol-tracker-backup',version:7,app_version:'1.2.4',records:[event({id:'old-124',event_type:'phone_photo',interactions:[{type:'cheki',member:'乙',benefit_format:'theme',is_theme:true,tickets:1,price_per_ticket:50,total_cost:50}]})],members:[],config:{monthly_budget:0,backup_reminder_days:0}});
 const restored=Core.parseBackup(v124);
 assert.equal(restored.app_version,'1.3.3');
 assert.equal(restored.records[0].interactions[0].is_theme,true);
});

test('v1.3.0 core: entitySpendingSummary (members/groups/organizers sorted descending), video attachment validation, and v1.2.5 migration',()=>{
 const aHash='a'.repeat(64),bHash='b'.repeat(64);
 let data=state([
  event({id:'e1',date:'2026-11-05',event_type:'performance',organizers:['幻影社','星尘社'],performing_groups:['团A','团B'],ticket_fee:100,drink_fee:20,interactions:[
   {type:'cheki',cheki_type:'individual',member:'甲',tickets:2,price_per_ticket:80,total_cost:160,participant_groups:[{member:'甲',group:'团A'}]},
   {type:'cheki',cheki_type:'multi',members:['甲','乙'],tickets:1,price_per_ticket:10.01,total_cost:10.01,participant_groups:[{member:'甲',group:'团A'},{member:'乙',group:'团B'}]},
   {type:'cheki',cheki_type:'group',group_name:'团B',tickets:1,price_per_ticket:200,total_cost:200},
   {type:'phone',cheki_type:'individual',member:'乙',tickets:1,price_per_ticket:0,total_cost:0,attachments:[
    {id:'v1',data:'https://idol.local/photos/'+aHash+'.mp4',media_type:'video',caption:'合影视频'},
    {id:'v2',data:'https://idol.local/photos/'+bHash+'.mov',caption:'MOV格式'}
   ]}
  ]}),
  event({id:'e2',date:'2026-11-08',event_type:'merch_only',venue:'线上购买',interactions:[
   {type:'merch',item_name:'公式照',quantity:2,price:50,total_cost:100,merch_members:['乙'],affiliated_groups:['团B'],merch_organizers:['周边社']}
  ]})
 ]);
 data.members=[{name:'甲',groups:['团A']},{name:'乙',groups:['团B']}];
 data.config.group_profiles=[{name:'团A',organizers:['幻影社']},{name:'团B',organizers:['周边社']}];
 data=Core.validateState(data);
 const summary=Core.entitySpendingSummary(data,data.records);
 assert.deepEqual(summary.members.map(r=>[r.name,r.cost]),[['甲',16501],['乙',10500]]);
 assert.equal(summary.members[0].chekiCount,3);
 assert.equal(summary.members[1].phoneCount,1);
 assert.equal(summary.members[1].merchCount,2);
 assert.deepEqual(summary.groups.map(r=>[r.name,r.cost]),[['团B',30500],['团A',16501]]);
 assert.deepEqual(summary.organizers.map(r=>[r.name,r.cost]),[['周边社',30500],['幻影社',21501],['星尘社',5000]]);
 const vids=Core.parseBackup(JSON.stringify({
  ...data,
  app_version:'1.3.0',
  records:[event({id:'v-test',interactions:[{type:'phone',member:'甲',tickets:1,total_cost:0,attachments:[
   {id:'m1',data:'https://idol.local/photos/'+aHash+'.webm'},
   {id:'m2',data:'https://idol.local/photos/'+aHash+'.mkv'},
   {id:'m3',data:'https://idol.local/photos/'+aHash+'.3gp'},
   {id:'m4',data:'https://idol.local/photos/'+aHash+'.m4v'},
   {id:'m5',data:'data:video/mp4;base64,AAAA',media_type:'video'}
  ]}]})]
 }));
 assert.equal(vids.app_version,'1.3.3');
 assert.equal(vids.records[0].interactions[0].attachments.length,5);
 assert.throws(()=>Core.validateState({...data,records:[event({id:'bad-v',interactions:[{type:'phone',member:'甲',tickets:1,total_cost:0,attachments:[{id:'x',data:'https://idol.local/photos/'+aHash+'.avi'}]}]})]}),/媒体格式/);
});

test('v1.3.1 core: organizer spending excludes drink_fee and unaffiliated guest groups on hosted events',()=>{
 let data=state([
  event({id:'host-only',date:'2026-11-10',organizers:['主催A'],ticket_fee:80,drink_fee:20,interactions:[
   {type:'cheki',cheki_type:'individual',member:'客人甲',tickets:3,price_per_ticket:100,total_cost:300,participant_groups:[{member:'客人甲',group:'外团'}]},
   {type:'cheki',cheki_type:'individual',member:'自担乙',tickets:1,price_per_ticket:70,total_cost:70,participant_groups:[{member:'自担乙',group:'旗下团'}]}
  ]}),
  event({id:'away-show',date:'2026-11-12',organizers:['主催B'],ticket_fee:100,drink_fee:20,interactions:[
   {type:'cheki',cheki_type:'individual',member:'自担乙',tickets:2,price_per_ticket:70,total_cost:140,participant_groups:[{member:'自担乙',group:'旗下团'}]}
  ]})
 ]);
 data.members=[{name:'客人甲',groups:['外团']},{name:'自担乙',groups:['旗下团']}];
 data.config.group_profiles=[{name:'旗下团',organizers:['主催A']},{name:'外团',organizers:['外社']}];
 data=Core.validateState(data);
 const orgs=Core.entitySpendingSummary(data,data.records).organizers;
 assert.deepEqual(orgs.map(r=>[r.name,r.cost]),[['外社',30000],['主催A',29000],['主催B',10000]]);
});

test('v1.3.2 core: entitySpendingSummary deduplicates multi-member/multi-group counts and itemName prefers group_name for group items',()=>{
 let data=state([
  event({id:'multi-same',date:'2026-11-18',organizers:['主催甲'],ticket_fee:0,interactions:[
   {type:'cheki',cheki_type:'multi',members:['成员甲','成员乙'],tickets:1,price_per_ticket:100,total_cost:100,participant_groups:[{member:'成员甲',group:'同团A'},{member:'成员乙',group:'同团A'}]},
   {type:'merch',item_name:'双团徽章',quantity:2,price:30,total_cost:60,affiliated_groups:['同团A','同团B']}
  ]})
 ]);
 data.members=[{name:'成员甲',groups:['同团A']},{name:'成员乙',groups:['同团A']}];
 data.config.group_profiles=[{name:'同团A',organizers:['主催甲']},{name:'同团B',organizers:['主催甲']}];
 data=Core.validateState(data);
 const summary=Core.entitySpendingSummary(data,data.records);
 const grpA=summary.groups.find(r=>r.name==='同团A');
 const orgA=summary.organizers.find(r=>r.name==='主催甲');
 assert.equal(grpA.chekiCount,1);
 assert.equal(grpA.merchCount,2);
 assert.equal(grpA.cost,13000);
 assert.equal(orgA.chekiCount,1);
 assert.equal(orgA.merchCount,2);
 assert.equal(orgA.cost,16000);
 assert.equal(Core.itemName({type:'cheki',cheki_type:'group',member:'旧字段',group_name:'正确团'}),'正确团');
 assert.equal(Core.parseBackup(JSON.stringify({...data,app_version:'1.3.1'})).app_version,'1.3.3');
});

test('v1.3.3 core: groupSummary distinguishes cheki, phone photo, group cheki, and group phone',()=>{
 let data=state([
  event({id:'grp-dist',date:'2026-11-20',performing_groups:['星光团'],interactions:[
   {type:'cheki',cheki_type:'individual',member:'成员甲',tickets:3,price_per_ticket:80,total_cost:240,participant_groups:[{member:'成员甲',group:'星光团'}]},
   {type:'phone',cheki_type:'individual',member:'成员甲',tickets:2,price_per_ticket:0,total_cost:0,participant_groups:[{member:'成员甲',group:'星光团'}]},
   {type:'cheki',cheki_type:'group',group_name:'星光团',tickets:1,price_per_ticket:150,total_cost:150},
   {type:'phone',cheki_type:'group',group_name:'星光团',tickets:1,price_per_ticket:30,total_cost:30}
  ]})
 ]);
 data.members=[{name:'成员甲',groups:['星光团']}];
 data=Core.validateState(data);
 const summary=Core.groupSummary(data,'星光团',{});
 assert.equal(summary.shared,42000);
 assert.equal(summary.members.length,1);
 assert.equal(summary.members[0].chekiCount,3);
 assert.equal(summary.members[0].phoneCount,2);
 assert.equal(summary.members[0].count,5);
 assert.deepEqual(summary.groupCheki,{count:1,cost:15000});
 assert.deepEqual(summary.groupPhone,{count:1,cost:3000});
 assert.equal(Core.parseBackup(JSON.stringify({...data,app_version:'1.3.2'})).app_version,'1.3.3');
});
