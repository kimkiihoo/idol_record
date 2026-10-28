(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IdolCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'idol-tracker-backup';
  const SCHEMA_VERSION = 2;
  const APP_VERSION = '1.1.1';
  const MAX_MONEY = 99999999999999;
  const IMAGE_FIELDS = new Set(['image', 'image_name', 'photo', 'photo_name', 'images', 'photos', 'image_files', 'image_data', 'photo_data', 'image_url', 'photo_url', 'image_path', 'photo_path']);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  const fail = message => { throw new Error(message); };

  function clone(value, depth, omitImages) {
    depth = depth || 0;
    if (depth > 80) fail('数据嵌套过深');
    const imageData = item => typeof item === 'string' && /^\s*data:image\//i.test(item);
    if (Array.isArray(value)) return value.filter(item => !omitImages || !imageData(item)).map(v => clone(v, depth + 1, omitImages));
    if (plain(value)) {
      const out = {};
      for (const key of Object.keys(value)) {
        if (omitImages && (IMAGE_FIELDS.has(key.toLowerCase()) || imageData(value[key]))) continue;
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('备份包含不安全的字段名称');
        out[key] = clone(value[key], depth + 1, omitImages);
      }
      return out;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) fail('数据包含无效数值');
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') fail('数据包含非 JSON 值');
    return value;
  }
  function safe(value) {
    if (!Number.isSafeInteger(value)) fail('统计金额或数量超出安全范围');
    return value;
  }
  function cents(value) {
    if (!['string', 'number'].includes(typeof value)) fail('金额须为非负数，最多两位小数');
    const text = String(value).normalize('NFKC').trim().replace(/^[¥￥]\s*/, '');
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) fail('金额须为非负数，最多两位小数');
    const parts = text.split('.');
    const result = Number(parts[0] || 0) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    if (!Number.isSafeInteger(result) || result > MAX_MONEY) fail('金额过大');
    return result;
  }
  function amount(value) { return safe(value) / 100; }
  function money(value) {
    safe(value);
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    return sign + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  }
  function quantity(value) {
    const text = String(value).normalize('NFKC').trim();
    if (!/^\d+$/.test(text) || Number(text) <= 0 || !Number.isSafeInteger(Number(text))) fail('数量必须为正整数');
    return Number(text);
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('活动日期格式须为 YYYY-MM-DD');
    const [y, m, d] = value.split('-').map(Number);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) fail('活动日期无效');
    return value;
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (plain(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function hash(value) {
    const text = typeof value === 'string' ? value : canonical(value);
    let a = 2166136261, b = 2246822507;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 3266489909);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function kind(item) {
    return item.type === 'merch' ? 'merch' : item.type === 'group' || item.cheki_type === 'group' ? 'group' : 'individual';
  }
  function form(item, eventType) {
    return item.benefit_format || (eventType === 'theme_homework' || item.type === 'theme_homework' ? 'homework' : eventType === 'online_cheki' ? 'online' : 'cheki');
  }
  function count(item) { return quantity(kind(item) === 'merch' ? (item.quantity == null ? 1 : item.quantity) : (item.tickets == null ? (item.quantity == null ? 1 : item.quantity) : item.tickets)); }
  function itemTotal(item) {
    if (item.total_cost != null) return cents(item.total_cost);
    const price = kind(item) === 'merch' ? item.price : item.price_per_ticket;
    return safe(cents(price == null ? 0 : price) * count(item));
  }
  function eventTotal(event) {
    return (event.interactions || []).reduce((sum, item) => safe(sum + itemTotal(item)), safe(cents(event.ticket_fee == null ? 0 : event.ticket_fee) + cents(event.drink_fee == null ? 0 : event.drink_fee)));
  }
  function normalizeRecords(records) {
    if (!Array.isArray(records)) fail('记录文件必须是活动列表');
    const ids = new Set();
    const generated = new Map();
    const result = records.map((event, index) => {
      if (!plain(event)) fail('第 ' + (index + 1) + ' 条活动格式错误');
      validDate(event.date);
      if (!event.id) {
        const base = 'legacy-' + hash(event);
        const occurrence = (generated.get(base) || 0) + 1;
        generated.set(base, occurrence);
        event.id = base + (occurrence > 1 ? '-' + occurrence : '');
      }
      if (typeof event.id !== 'string' || event.id.length > 512) fail('活动 ID 无效');
      if (ids.has(event.id)) fail('备份含重复活动 ID：' + event.id);
      ids.add(event.id);
      event.event_type = event.event_type || 'performance';
      if (typeof event.event_type !== 'string') fail('活动类型无效');
      for (const key of ['ticket_fee', 'drink_fee']) event[key] = amount(cents(event[key] == null ? 0 : event[key]));
      if (event.interactions === undefined) event.interactions = [];
      if (!Array.isArray(event.interactions)) fail('消费明细必须为列表');
      const itemIds = new Set();
      for (const item of event.interactions) {
        if (!plain(item)) fail('消费明细格式错误');
        // Delivery tracking was removed in 1.1.0. Its legacy fields are opaque
        // compatibility data and remain unchanged in migrations and backups.
        if (item.id != null) {
          if (typeof item.id !== 'string' || !item.id || item.id.length > 512 || itemIds.has(item.id)) fail('消费明细 ID 无效或重复');
          itemIds.add(item.id);
        }
        const n = count(item);
        if (kind(item) === 'merch') item.quantity = n;
        else item.tickets = n;
        for (const key of ['price', 'price_per_ticket']) if (item[key] != null) item[key] = amount(cents(item[key]));
        item.total_cost = amount(itemTotal(item));
        cents(item.total_cost);
      }
      eventTotal(event);
      return event;
    });
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }
  function validateState(input) {
    // Images were removed from the app. Drop their references and payloads
    // before validation so obsolete attachments cannot block a valid ledger.
    const state = clone(input, 0, true);
    if (!plain(state)) fail('备份格式不正确');
    if (state.format != null && state.format !== FORMAT) fail('这不是偶像活动备份文件');
    if (state.version != null && ![1, SCHEMA_VERSION].includes(state.version)) fail('暂不支持此备份版本');
    state.format = FORMAT;
    state.version = SCHEMA_VERSION;
    state.app_version = APP_VERSION;
    state.records = normalizeRecords(state.records);
    if (state.config == null) state.config = {};
    if (!plain(state.config)) fail('设置格式错误');
    if (state.config.monthly_budget != null) state.config.monthly_budget = amount(cents(state.config.monthly_budget));
    if (state.assets == null) state.assets = { images: {} };
    if (!plain(state.assets)) fail('附件格式错误');
    state.assets.images = {};
    stats(state.records);
    return state;
  }
  function createEmptyState() {
    return { format: FORMAT, version: SCHEMA_VERSION, app_version: APP_VERSION, records: [], config: { monthly_budget: 0 }, assets: { images: {} } };
  }
  function parseBackup(text, currentConfig) {
    if (typeof text !== 'string') fail('备份内容必须为文本');
    if (text.length > 10 * 1024 * 1024) fail('备份文件超过 10 MB 限制');
    let data;
    try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) { fail('备份不是有效的 JSON 文件'); }
    if (Array.isArray(data)) data = { records: data, config: currentConfig || {} };
    return validateState(data);
  }
  function stats(records) {
    const out = { total: 0, ticket: 0, drink: 0, benefit: 0, merch: 0, eventCount: records.length, interactionCount: 0, ticketCount: 0, merchCount: 0, merchRanking: [], eventTypes: {}, ranking: [], venues: [], cities: [], forms: {} };
    const types = new Map(), ranks = new Map(), merchandise = new Map(), venues = new Map(), cities = new Map(), forms = new Map();
    for (const event of records) {
      out.ticket = safe(out.ticket + cents(event.ticket_fee == null ? 0 : event.ticket_fee));
      out.drink = safe(out.drink + cents(event.drink_fee == null ? 0 : event.drink_fee));
      const eventType = event.event_type || 'performance';
      types.set(eventType, (types.get(eventType) || 0) + 1);
      const city = String(event.city || '未知城市'), venue = String(event.venue || '未知场地');
      const venueKey = city + '\u0000' + venue;
      if (!cities.has(city)) cities.set(city, { name: city, cost: 0, count: 0 });
      if (!venues.has(venueKey)) venues.set(venueKey, { name: venue, city, cost: 0, count: 0 });
      for (const row of [cities.get(city), venues.get(venueKey)]) {
        row.cost = safe(row.cost + eventTotal(event));
        row.count++;
      }
      for (const item of event.interactions || []) {
        const k = kind(item), cost = itemTotal(item), n = count(item);
        out.interactionCount++;
        out[k === 'merch' ? 'merch' : 'benefit'] = safe(out[k === 'merch' ? 'merch' : 'benefit'] + cost);
        if (k === 'merch') {
          out.merchCount = safe(out.merchCount + n);
          const name = String(item.item_name || '未命名商品');
          if (!merchandise.has(name)) merchandise.set(name, { name, cost: 0, count: 0 });
          const product = merchandise.get(name);
          product.cost = safe(product.cost + cost);
          product.count = safe(product.count + n);
        }
        if (k !== 'merch') {
          out.ticketCount = safe(out.ticketCount + n);
          const format = String(form(item, eventType));
          if (!forms.has(format)) forms.set(format, { cost: 0, count: 0 });
          const formatRow = forms.get(format);
          formatRow.cost = safe(formatRow.cost + cost);
          formatRow.count = safe(formatRow.count + n);
          const name = String(k === 'group' ? (item.group_name || '未知团体') : (item.member || '未知成员'));
          const key = k + '\u0000' + name;
          if (!ranks.has(key)) ranks.set(key, { name, kind: k, cost: 0, count: 0, last_date: '' });
          const row = ranks.get(key);
          row.cost = safe(row.cost + cost);
          row.count = safe(row.count + n);
          if (event.date > row.last_date) row.last_date = event.date;
        }
      }
    }
    for (const [key, value] of types) Object.defineProperty(out.eventTypes, key, { value, enumerable: true, writable: true, configurable: true });
    for (const [key, value] of forms) Object.defineProperty(out.forms, key, { value, enumerable: true, writable: true, configurable: true });
    out.total = safe(out.ticket + out.drink + out.benefit + out.merch);
    out.ranking = Array.from(ranks.values()).sort((a, b) => b.count - a.count || b.cost - a.cost || b.last_date.localeCompare(a.last_date) || a.name.localeCompare(b.name, 'zh'));
    out.merchRanking = Array.from(merchandise.values()).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'zh'));
    out.cities = Array.from(cities.values()).sort((a, b) => b.cost - a.cost || b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    out.venues = Array.from(venues.values()).sort((a, b) => b.cost - a.cost || b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return out;
  }
  function frequent(records, field, options) {
    options = options || {};
    const scores = new Map();
    for (const event of records) {
      if (field === 'venue' && options.city && event.city !== options.city) continue;
      let values;
      if (['city', 'venue', 'event_name'].includes(field)) values = [[event[field], 1]];
      else {
        const expected = { member: 'individual', group: 'group', group_name: 'group', item_name: 'merch' }[field];
        values = (event.interactions || []).filter(item => kind(item) === expected).map(item => [item[field === 'group' ? 'group_name' : field], count(item)]);
      }
      for (const [name, n] of values) {
        if (typeof name !== 'string' || !name || ['-', '无', '未知', '未命名活动'].includes(name)) continue;
        const row = scores.get(name) || [0, 0, '', 0];
        row[0] += options.eventType != null && (event.event_type || 'performance') === options.eventType ? 1 : 0;
        row[1]++;
        if (event.date > row[2]) row[2] = event.date;
        row[3] += n;
        scores.set(name, row);
      }
    }
    return Array.from(scores.keys()).sort((a, b) => {
      const x = scores.get(a), y = scores.get(b);
      return y[0] - x[0] || y[1] - x[1] || y[2].localeCompare(x[2]) || y[3] - x[3] || b.localeCompare(a, 'zh');
    }).slice(0, options.limit == null ? 8 : options.limit);
  }
  function prices(records, name, expectedKind, expectedForm, eventType, limit) {
    const key = { individual: 'member', group: 'group_name', merch: 'item_name' }[expectedKind];
    const candidates = [];
    for (const event of records) {
      for (const item of event.interactions || []) {
        if (kind(item) !== expectedKind || item[key] !== name || expectedKind !== 'merch' && form(item, event.event_type || 'performance') !== expectedForm) continue;
        let price = item[expectedKind === 'merch' ? 'price' : 'price_per_ticket'];
        try {
          let value;
          if (price == null) {
            value = itemTotal(item) / count(item);
            if (!Number.isSafeInteger(value)) continue;
          } else value = cents(price);
          candidates.push({ value, match: (event.event_type || 'performance') === eventType ? 1 : 0, date: event.date, created: typeof event.created_at === 'string' ? event.created_at : '' });
        } catch (_) { /* An unusable historical price is never suggested. */ }
      }
    }
    candidates.sort((a, b) => b.match - a.match || b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
    return Array.from(new Set(candidates.map(row => amount(row.value)))).slice(0, limit == null ? 5 : limit);
  }
  function search(record, query, pinyin) {
    const q = String(query || '').normalize('NFKC').toLowerCase().trim();
    if (!q) return true;
    const pieces = [];
    function walk(value) {
      if (typeof value === 'string' || typeof value === 'number') pieces.push(String(value));
      else if (Array.isArray(value)) value.forEach(walk);
      else if (plain(value)) for (const [key, item] of Object.entries(value)) if (!['id', 'image', 'created_at'].includes(key)) walk(item);
    }
    walk(record);
    return pieces.some(value => {
      const normal = value.normalize('NFKC').toLowerCase();
      if (normal.includes(q)) return true;
      if (!pinyin) return false;
      const tokens = Array.from(normal).map(c => pinyin[c] || c);
      return tokens.join('').includes(q) || tokens.map(t => t[0] || '').join('').includes(q);
    });
  }
  function filterRecords(records, options) {
    options = options || {};
    const period = String(options.period || 'all').toUpperCase();
    let predicate = () => true;
    if (options.start || options.end) {
      const start = options.start ? validDate(options.start) : '';
      const end = options.end ? validDate(options.end) : '';
      if (start && end && start > end) fail('开始日期不能晚于结束日期');
      predicate = e => (!start || e.date >= start) && (!end || e.date <= end);
    } else if (period !== 'ALL' && period !== '') {
      if (/^\d{4}-Q[1-4]$/.test(period) && Number(period.slice(0, 4)) > 0) predicate = e => e.date.slice(0, 4) === period.slice(0, 4) && Math.floor((Number(e.date.slice(5, 7)) - 1) / 3) + 1 === Number(period.slice(-1));
      else if (/^\d{4}$/.test(period) && Number(period) > 0) predicate = e => e.date.startsWith(period);
      else if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period) && Number(period.slice(0, 4)) > 0) predicate = e => e.date.startsWith(period);
      else fail('时间范围格式须为 YYYY、YYYY-MM 或 YYYY-Q1');
    }
    return records.filter(event => (!options.type || options.type === 'all' || (event.event_type || 'performance') === options.type) && predicate(event) && search(event, options.query, options.pinyin)).sort((a, b) => b.date.localeCompare(a.date));
  }
  // UTC getters are used solely for calendar arithmetic; input/output never pass
  // through local timezone parsing, so a device timezone cannot shift the day.
  function calendarDate(y, m, d) {
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(y, m - 1, d);
    return date;
  }
  function dateText(date) {
    const y = date.getUTCFullYear();
    if (y < 1 || y > 9999) fail('日期范围超出 0001 至 9999 年');
    return String(y).padStart(4, '0') + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }
  function periodRange(kind, anchorDate) {
    if (kind === 'all') return { start: '', end: '', label: '全部时间', previousStart: '', previousEnd: '' };
    validDate(anchorDate);
    const [year, month, day] = anchorDate.split('-').map(Number);
    let start, end, previousStart, previousEnd, label;
    if (kind === 'week') {
      const weekday = (calendarDate(year, month, day).getUTCDay() + 6) % 7;
      start = calendarDate(year, month, day - weekday);
      end = calendarDate(year, month, day - weekday + 6);
      previousStart = calendarDate(year, month, day - weekday - 7);
      previousEnd = calendarDate(year, month, day - weekday - 1);
      label = dateText(start) + ' 至 ' + dateText(end);
    } else if (kind === 'month') {
      start = calendarDate(year, month, 1);
      end = calendarDate(year, month + 1, 0);
      previousStart = calendarDate(year, month - 1, 1);
      previousEnd = calendarDate(year, month, 0);
      label = year + '年' + month + '月';
    } else if (kind === 'quarter') {
      const quarter = Math.floor((month - 1) / 3);
      start = calendarDate(year, quarter * 3 + 1, 1);
      end = calendarDate(year, quarter * 3 + 4, 0);
      previousStart = calendarDate(year, quarter * 3 - 2, 1);
      previousEnd = calendarDate(year, quarter * 3 + 1, 0);
      label = year + '年第' + (quarter + 1) + '季度';
    } else if (kind === 'year') {
      start = calendarDate(year, 1, 1);
      end = calendarDate(year, 12, 31);
      previousStart = calendarDate(year - 1, 1, 1);
      previousEnd = calendarDate(year - 1, 12, 31);
      label = year + '年';
    } else fail('不支持的统计周期');
    return { start: dateText(start), end: dateText(end), label, previousStart: dateText(previousStart), previousEnd: dateText(previousEnd) };
  }
  function mergeStates(current, incoming) {
    const state = validateState(current), imported = validateState(incoming);
    let added = 0, conflicts = 0, skipped = 0;
    const ids = new Map(state.records.map(event => [event.id, event]));
    for (const event of imported.records) {
      if (ids.has(event.id)) {
        if (canonical(ids.get(event.id)) === canonical(event)) skipped++;
        else conflicts++;
      } else {
        state.records.push(event);
        ids.set(event.id, event);
        added++;
      }
    }
    // Keep current settings on merge, while preserving any previously unknown fields.
    for (const [key, value] of Object.entries(imported)) if (!own(state, key)) state[key] = value;
    for (const [key, value] of Object.entries(imported.config)) if (!own(state.config, key)) state.config[key] = value;
    for (const [key, value] of Object.entries(imported.assets)) if (!own(state.assets, key)) state.assets[key] = value;
    return { state: validateState(state), added, conflicts, skipped };
  }
  return { FORMAT, SCHEMA_VERSION, APP_VERSION, createEmptyState, cents, amount, money, quantity, validDate, kind, form, count, itemTotal, eventTotal, stats, parseBackup, validateState, mergeStates, search, filterRecords, periodRange, frequent, prices, clone };
});
