(function (root) {
  'use strict';
  const EVENT_LABELS = { performance: '演出', online_cheki: '电切 / 网签', bonus_only: '仅特典', off_meeting: 'Off 会', theme_homework: '宿题/主题', merch_only: '仅买周边', other: '其它活动' };
  const FORM_LABELS = { cheki: '普通切', signed: '签名切', unsigned: '无签切', online: '电切 / 网签', homework: '宿题/主题', other: '其它特典' };
  const view = { kind: 'individual', sort: 'cost', ranksExpanded: false, citiesExpanded: false, venuesExpanded: false, citiesSort: 'cost', venuesSort: 'cost', merchExpanded: false, monthsExpanded: false };
  let current = null;
  const fallbackEscape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const e = (ctx, value) => (ctx.esc || fallbackEscape)(String(value == null ? '' : value));
  const currency = (ctx, value) => e(ctx, ctx.money ? ctx.money(value) : '¥' + ctx.C.money(value));
  const today = () => { const date = new Date(); return String(date.getFullYear()).padStart(4, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };
  function dateObject(text) { const [y, m, d] = text.split('-').map(Number); const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(y, m - 1, d); return date; }
  function dateText(date) { return String(date.getUTCFullYear()).padStart(4, '0') + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0'); }
  function nextDay(text, delta) { const date = dateObject(text); date.setUTCDate(date.getUTCDate() + delta); return dateText(date); }
  function calendar(y, m, d) { const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(y, m - 1, d); return dateText(date); }
  function bounds(ctx) {
    const dates = ctx.records.map(row => row.date).sort();
    const start = ctx.range && ctx.range.start || dates[0] || today();
    const end = ctx.range && ctx.range.end || dates[dates.length - 1] || start;
    return { start, end };
  }
  function rangeLabel(ctx) {
    if (ctx.range && ctx.range.start && ctx.range.end) return ctx.range.start + ' 至 ' + ctx.range.end;
    if (!ctx.records.length) return '全部时间 · 暂无活动';
    const range = bounds(ctx);
    return '全部时间 · ' + range.start + ' 至 ' + range.end;
  }
  function metric(ctx, label, value, note) {
    return '<div class="card metric"><small>' + e(ctx, label) + '</small><strong>' + value + '</strong><small>' + e(ctx, note || '') + '</small></div>';
  }
  function percent(value, total) { return total > 0 ? (value / total * 100).toFixed(1) + '%' : '0.0%'; }
  function bar(ctx, label, cost, total, note) {
    const width = total > 0 ? Math.max(0, Math.min(100, cost / total * 100)) : 0;
    return '<div class="bar-row"><div class="row"><span>' + e(ctx, label) + '</span><strong>' + currency(ctx, cost) + '</strong></div><div class="bar-track" aria-hidden="true"><i style="width:' + width.toFixed(3) + '%"></i></div><div class="row stats-bar-note"><small>' + e(ctx, note || '') + '</small><small>' + percent(cost, total) + '</small></div></div>';
  }
  function comparison(ctx, stats) {
    const range = ctx.range;
    if (!range || !range.previousStart || !range.previousEnd) return '';
    const previous = ctx.C.stats(ctx.C.filterRecords(ctx.state.records, { start: range.previousStart, end: range.previousEnd }));
    const delta = stats.total - previous.total;
    const change = previous.total === 0 ? (stats.total === 0 ? '两期均无支出' : '上期为 0，不计算涨幅') : (delta > 0 ? '增加 ' : delta < 0 ? '减少 ' : '持平 ') + (delta === 0 ? '' : (Math.abs(delta) / previous.total * 100).toFixed(1) + '%');
    const unfinished = range.end >= today() && range.start <= today();
    const future = range.start > today();
    const note = unfinished ? '本期尚未结束；以下与上一个完整周期比较。' : future ? '本期为未来时段；只统计已经录入的活动。' : '与上一个完整周期比较。';
    return '<div class="card stats-comparison"><div class="row wrap"><h3>与上期比较</h3><span class="tag gray">' + e(ctx, change) + '</span></div><p class="chart-note">' + e(ctx, note) + '</p><div class="stats-compare-grid"><div><small>本期支出</small><strong>' + currency(ctx, stats.total) + '</strong></div><div><small>上期支出</small><strong>' + currency(ctx, previous.total) + '</strong></div><div><small>金额变化</small><strong>' + (delta > 0 ? '+' : '') + currency(ctx, delta) + '</strong></div></div><div class="stats-compare-facts"><span>活动 ' + previous.eventCount + ' → ' + stats.eventCount + ' 条</span><span>演出 ' + (previous.eventTypes.performance || 0) + ' → ' + (stats.eventTypes.performance || 0) + ' 场</span><span>特典 ' + previous.ticketCount + ' → ' + stats.ticketCount + ' 张 / 份</span></div><p class="chart-note">上期：' + e(ctx, range.previousStart) + ' 至 ' + e(ctx, range.previousEnd) + '</p><button class="text stats-period-link" data-stats-action="previous">查看上期统计 →</button></div>';
  }
  function buildTrend(ctx) {
    const range = bounds(ctx);
    const span = Math.round((dateObject(range.end) - dateObject(range.start)) / 86400000) + 1;
    const months = (Number(range.end.slice(0, 4)) - Number(range.start.slice(0, 4))) * 12 + Number(range.end.slice(5, 7)) - Number(range.start.slice(5, 7)) + 1;
    const unit = span <= 31 ? 'day' : span <= 120 ? 'week' : months <= 60 ? 'month' : 'year';
    const label = { day: '按日', week: '按周', month: '按月', year: '按年' }[unit];
    const buckets = [];
    let cursor = range.start;
    while (cursor <= range.end && buckets.length < 10000) {
      const [y, m, d] = cursor.split('-').map(Number);
      let end, key, text;
      if (unit === 'day') { end = cursor; key = cursor; text = m + '/' + d; }
      else if (unit === 'week') {
        const weekday = (dateObject(cursor).getUTCDay() + 6) % 7;
        end = nextDay(cursor, 6 - weekday);
        key = nextDay(cursor, -weekday);
        text = m + '/' + d;
      } else if (unit === 'month') { end = calendar(y, m + 1, 0); key = cursor.slice(0, 7); text = months > 12 ? String(y).slice(-2) + '/' + m : m + '月'; }
      else { end = calendar(y, 12, 31); key = String(y); text = y + '年'; }
      if (end > range.end) end = range.end;
      buckets.push({ start: cursor, end, key, text, cost: 0, count: 0 });
      cursor = nextDay(end, 1);
    }
    const byKey = new Map(buckets.map(row => [row.key, row]));
    for (const record of ctx.records) {
      let key = record.date;
      if (unit === 'week') key = nextDay(key, -((dateObject(key).getUTCDay() + 6) % 7));
      else if (unit === 'month') key = key.slice(0, 7);
      else if (unit === 'year') key = key.slice(0, 4);
      const row = byKey.get(key);
      if (row) { row.cost += ctx.C.eventTotal(record); row.count++; }
    }
    return { unit, label, buckets };
  }
  function trend(ctx, data) {
    const peak = Math.max(0, ...data.buckets.map(row => row.cost));
    const peakRow = data.buckets.find(row => row.cost === peak);
    const chart = data.buckets.map((row, index) => {
      const height = peak ? row.cost / peak * 78 : 0;
      const future = row.start > today();
      return '<button class="chart-column stats-column' + (future ? ' stats-future' : '') + '" data-stats-action="trend" data-index="' + index + '" aria-label="' + e(ctx, row.start + ' 至 ' + row.end + '，' + (ctx.money ? ctx.money(row.cost) : ctx.C.money(row.cost)) + '，' + row.count + ' 条活动') + '"><i class="' + (row.cost === 0 ? 'stats-zero' : '') + '" style="height:' + height.toFixed(3) + '%"></i><small>' + e(ctx, row.text) + '</small></button>';
    }).join('');
    const note = ctx.records.length && peakRow ? '最高时段：' + peakRow.start + (peakRow.start === peakRow.end ? '' : ' 至 ' + peakRow.end) + ' · ' + (ctx.money ? ctx.money(peak) : ctx.C.money(peak)) : '当前时段没有支出记录。';
    return '<div class="section-title row"><h2>支出趋势</h2><small>' + data.label + '汇总</small></div><div class="card"><div class="row"><small id="stats-trend-caption">最高时段支出</small><strong id="stats-trend-amount">' + currency(ctx, peak) + '</strong></div><div class="stats-chart-scroll"><div class="chart stats-chart"' + (data.buckets.length > 16 ? ' style="min-width:' + (data.buckets.length * 30) + 'px"' : '') + '>' + chart + '</div></div><div id="stats-trend-detail" class="chart-note">' + e(ctx, note) + '</div><p class="chart-note">点按柱形查看金额与活动数；空白时段按 0 计入。' + (data.unit === 'week' ? '每周从周一开始，首尾仅包含所选日期。' : '') + (data.unit === 'year' ? '历史跨度超过 60 个月，改为按年展示。' : '') + '</p></div>';
  }
  function rankRows(ctx, stats) {
    const rows = stats.ranking.filter(row => row.kind === view.kind).sort((a, b) => view.sort === 'cost' ? b.cost - a.cost || b.count - a.count || b.last_date.localeCompare(a.last_date) : b.count - a.count || b.cost - a.cost || b.last_date.localeCompare(a.last_date));
    if (!rows.length) return '<div class="empty">本时段没有' + (view.kind === 'group' ? '团体' : '个人') + '特典记录。</div>';
    return rows.slice(0, view.ranksExpanded ? rows.length : 10).map((row, index) => '<button class="rank stats-rank" data-stats-action="member" data-name="' + e(ctx, row.name) + '" data-kind="' + e(ctx, row.kind) + '"><span class="num">' + (index + 1) + '</span><span><strong>' + e(ctx, row.name) + '</strong><small>最近：' + e(ctx, row.last_date) + '</small></span><span class="right"><strong>' + (view.sort === 'cost' ? currency(ctx, row.cost) : row.count + ' 张 / 份') + '</strong><small>' + (view.sort === 'cost' ? row.count + ' 张 / 份' : currency(ctx, row.cost)) + '</small></span></button>').join('') + (rows.length > 10 ? '<button class="text stats-show-all" data-stats-action="ranks-expanded">' + (view.ranksExpanded ? '收起' : '查看全部 ' + rows.length + (view.kind === 'group' ? ' 个团体' : ' 位成员')) + '</button>' : '');
  }
  function ranking(ctx, stats) {
    return '<div class="section-title row"><h2>拍切统计</h2><small>点按姓名查看明细</small></div><div class="card"><div class="segmented" aria-label="排行对象"><button data-stats-action="rank-kind" data-kind="individual" class="' + (view.kind === 'individual' ? 'active' : '') + '">个人</button><button data-stats-action="rank-kind" data-kind="group" class="' + (view.kind === 'group' ? 'active' : '') + '">团体</button></div><div class="segmented" aria-label="排行顺序"><button data-stats-action="rank-sort" data-sort="cost" class="' + (view.sort === 'cost' ? 'active' : '') + '">按金额</button><button data-stats-action="rank-sort" data-sort="count" class="' + (view.sort === 'count' ? 'active' : '') + '">按张 / 份</button></div><div id="stats-ranking">' + rankRows(ctx, stats) + '</div><p class="chart-note">个人与团体分别统计；特典包含普通切、签名切、电切、宿题/主题等，数量按张 / 份计。</p></div>';
  }
  function sortLocations(rows, order) {
    const compareText = (a, b) => a.localeCompare(b, 'zh') || (a < b ? -1 : a > b ? 1 : 0);
    return rows.slice().sort((a, b) => (order === 'count' ? b.count - a.count || b.cost - a.cost : b.cost - a.cost || b.count - a.count) || compareText(a.name, b.name) || compareText(a.city || '', b.city || ''));
  }
  function locationControls(which) {
    return '<div class="segmented stats-location-sort" aria-label="' + (which === 'cities' ? '城市' : '场地') + '排序">' + [['cost', '按金额'], ['count', '按次数']].map(([key, label]) => '<button data-stats-action="location-sort" data-location="' + which + '" data-sort="' + key + '" class="' + (view[which + 'Sort'] === key ? 'active' : '') + '">' + label + '</button>').join('') + '</div>';
  }
  function locations(ctx, stats, which) {
    const isVenue = which === 'venues', rows = sortLocations(stats[which], view[which + 'Sort']), expanded = view[which + 'Expanded'];
    if (!rows.length) return '<div class="empty">本时段暂无' + (isVenue ? '场地' : '城市') + '记录。</div>';
    return rows.slice(0, expanded ? rows.length : 8).map(row => '<div class="stats-location"><div><strong>' + e(ctx, row.name === '-' ? '未指定 / 线上' : row.name) + '</strong><small>' + (isVenue ? e(ctx, row.city === '-' ? '未指定城市' : row.city) + ' · ' : '') + row.count + ' 条活动</small></div><strong>' + currency(ctx, row.cost) + '</strong></div>').join('') + (rows.length > 8 ? '<button class="text stats-show-all" data-stats-action="' + which + '-expanded">' + (expanded ? '收起' : '查看全部 ' + rows.length + ' 项') + '</button>' : '');
  }
  function merchandiseRows(ctx, stats) {
    const rows = stats.merchRanking.slice().sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'zh'));
    if (!rows.length) return '<div class="empty">本时段没有周边购买记录。</div>';
    return rows.slice(0, view.merchExpanded ? rows.length : 10).map((row, index) => '<div class="rank stats-product"><span class="num">' + (index + 1) + '</span><span><strong>' + e(ctx, row.name) + '</strong><small>数量：' + row.count + '</small></span><span class="right"><strong>' + currency(ctx, row.cost) + '</strong><small>' + percent(row.cost, stats.merch) + ' 周边支出</small></span></div>').join('') + (rows.length > 10 ? '<button class="text stats-show-all" data-stats-action="merch-expanded">' + (view.merchExpanded ? '收起' : '查看全部 ' + rows.length + ' 种商品') + '</button>' : '');
  }
  function merchandise(ctx, stats) {
    return '<div class="section-title row"><h2>周边商品</h2><small>' + stats.merchCount + ' 件 · ' + stats.merchRanking.length + ' 种</small></div><div class="card"><div class="row"><small>本期周边总额 · 按金额排序</small><strong>' + currency(ctx, stats.merch) + '</strong></div><div id="stats-merchandise">' + merchandiseRows(ctx, stats) + '</div><p class="chart-note">仅统计周边明细，同名商品合并；数量按各明细的购买数量求和。商品金额合计与本期周边支出一致。</p></div>';
  }
  function buildMonthly(ctx) {
    const range = bounds(ctx);
    if (Math.round((dateObject(range.end) - dateObject(range.start)) / 86400000) + 1 <= 31) return null;
    const startIndex = Number(range.start.slice(0, 4)) * 12 + Number(range.start.slice(5, 7)) - 1;
    const endIndex = Number(range.end.slice(0, 4)) * 12 + Number(range.end.slice(5, 7)) - 1;
    const actualStart = Math.max(startIndex, endIndex - 119), byMonth = new Map();
    for (const record of ctx.records) {
      const key = record.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(record);
    }
    const rows = [];
    for (let index = endIndex; index >= actualStart; index--) {
      const y = Math.floor(index / 12), m = index % 12 + 1;
      const key = String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0');
      const start = key + '-01', end = calendar(y, m + 1, 0);
      const summary = ctx.C.stats(byMonth.get(key) || []);
      rows.push({ key, start: start < range.start ? range.start : start, end: end > range.end ? range.end : end, events: summary.eventCount, performances: summary.eventTypes.performance || 0, benefits: summary.ticketCount, total: summary.total });
    }
    return { rows, truncated: actualStart > startIndex, totalMonths: endIndex - startIndex + 1 };
  }
  function monthlyRows(ctx, data) {
    const rows = data.rows.slice(0, view.monthsExpanded ? data.rows.length : 12);
    const visibleTotal = rows.reduce((sum, row) => sum + row.total, 0);
    let html = '<div class="stats-month-scroll"><table class="stats-month-table"><thead><tr><th scope="col">年月</th><th scope="col">活动</th><th scope="col">演出</th><th scope="col">特典<br>张 / 份</th><th scope="col">支出</th></tr></thead><tbody>';
    html += rows.map(row => '<tr><th scope="row"><button class="text" data-stats-action="month-period" data-start="' + row.start + '" data-end="' + row.end + '">' + row.key + '</button></th><td>' + row.events + '</td><td>' + row.performances + '</td><td>' + row.benefits + '</td><td>' + currency(ctx, row.total) + '</td></tr>').join('');
    html += '</tbody></table></div><div class="row stats-month-total"><small>展示 ' + rows.length + ' 个月的支出合计</small><strong>' + currency(ctx, visibleTotal) + '</strong></div>';
    if (data.rows.length > 12) html += '<button class="text stats-show-all" data-stats-action="months-expanded">' + (view.monthsExpanded ? '收起为最近 12 个月' : '展开 ' + data.rows.length + ' 个月') + '</button>';
    return html;
  }
  function monthly(ctx, data) {
    if (!data) return '';
    return '<div class="section-title row"><h2>月度汇总</h2><small>空白月份补 0</small></div><div class="card"><div id="stats-monthly">' + monthlyRows(ctx, data) + '</div><p class="chart-note">按当前所选日期汇总，首尾月份仅计算范围内的记录，与上方趋势口径一致。点按月份查看该月。' + (data.truncated ? '本范围共 ' + data.totalMonths + ' 个月，表格仅显示最近 120 个月；总览与趋势仍包含全部所选记录。' : '') + '</p></div>';
  }
  function render(ctx) {
    const C = ctx.C, stats = C.stats(ctx.records), data = buildTrend(ctx), activeDays = new Set(ctx.records.map(row => row.date)).size;
    const forms = Object.entries(stats.forms).sort((a, b) => b[1].cost - a[1].cost || b[1].count - a[1].count);
    const totalCount = stats.eventCount;
    const types = Array.from(new Set([...Object.keys(EVENT_LABELS), ...Object.keys(stats.eventTypes)]));
    const months = buildMonthly(ctx);
    current = { ctx, stats, data, months };
    let html = '<section id="idol-stats"><p class="stats-scope">统计范围：' + e(ctx, rangeLabel(ctx)) + '</p><div class="metric-grid">';
    html += metric(ctx, '总支出', currency(ctx, stats.total), stats.eventCount + ' 条活动，含全部消费');
    html += metric(ctx, '演出场次', String(stats.eventTypes.performance || 0), '仅活动类型为演出的记录');
    html += metric(ctx, '特典张 / 份', String(stats.ticketCount), stats.ranking.filter(row => row.kind === 'individual').length + ' 位成员 · ' + stats.ranking.filter(row => row.kind === 'group').length + ' 个团体');
    html += metric(ctx, '有记录的日期', String(activeDays) + '<span class="stats-unit"> 天</span>', '同一天多条活动只计 1 天');
    html += '</div><div class="card stats-averages"><div><small>每条活动平均</small><strong>' + currency(ctx, totalCount ? Math.round(stats.total / totalCount) : 0) + '</strong></div><div><small>每个活动日平均</small><strong>' + currency(ctx, activeDays ? Math.round(stats.total / activeDays) : 0) + '</strong></div>' + (ctx.periodKind === 'year' ? '<div><small>全年月均 · 除以 12</small><strong>' + currency(ctx, Math.round(stats.total / 12)) + '</strong></div>' : '') + '</div>';
    html += comparison(ctx, stats);
    html += '<div class="section-title row"><h2>钱花在哪里</h2><small>占本期总支出</small></div><div class="card">' + bar(ctx, '门票', stats.ticket, stats.total) + bar(ctx, 'Drink 代', stats.drink, stats.total) + bar(ctx, '特典', stats.benefit, stats.total, stats.ticketCount + ' 张 / 份') + bar(ctx, '周边', stats.merch, stats.total) + '</div>';
    html += trend(ctx, data);
    html += monthly(ctx, months);
    html += '<div class="section-title row"><h2>活动分布</h2><small>共 ' + totalCount + ' 条</small></div><div class="card"><div class="stats-type-grid">' + types.map(type => '<button class="stats-type" data-stats-action="type" data-type="' + e(ctx, type) + '"><span>' + e(ctx, EVENT_LABELS[type] || type) + '</span><strong>' + (stats.eventTypes[type] || 0) + '<small> 条</small></strong></button>').join('') + '</div><p class="chart-note">点按类型查看记录；一次活动无论包含几项消费，都只计 1 条。</p></div>';
    html += '<div class="section-title"><h2>特典形式</h2></div><div class="card">' + (forms.length ? forms.map(([format, row]) => bar(ctx, FORM_LABELS[format] || format, row.cost, stats.benefit, row.count + ' 张 / 份')).join('') : '<div class="empty">本时段没有特典记录。</div>') + '<p class="chart-note">金额占比以特典支出为基数。旧记录未指定形式时，按活动类型兼容归类。</p></div>';
    html += ranking(ctx, stats);
    html += merchandise(ctx, stats);
    html += '<div class="section-title row"><h2>城市足迹</h2><small>金额 / 次数</small></div><div class="card">' + locationControls('cities') + '<div id="stats-cities">' + locations(ctx, stats, 'cities') + '</div></div>';
    html += '<div class="section-title row"><h2>场地 / 渠道</h2><small>金额 / 次数</small></div><div class="card">' + locationControls('venues') + '<div id="stats-venues">' + locations(ctx, stats, 'venues') + '</div><p class="chart-note">相同场地名按城市分别统计；次数为活动条数，金额包含归属于该活动的门票、Drink、特典及周边。</p></div>';
    html += '<p class="subtle">统计范围：' + e(ctx, rangeLabel(ctx)) + '。按活动日期归属，金额计算精确到分；平均值四舍五入至分。团体特典不计入个人排行。导入记录如已有合计金额，以保存的合计为准。' + (ctx.periodKind === 'year' ? '全年月均固定除以 12，包含没有记录及尚未结束的月份。' : '') + '</p></section>';
    return html;
  }
  function bind(ctx) {
    const host = document.querySelector('#main #idol-stats');
    if (!host) return;
    const snapshot = current && current.ctx === ctx ? current : { ctx, stats: ctx.C.stats(ctx.records), data: buildTrend(ctx), months: buildMonthly(ctx) };
    host.onclick = event => {
      const button = event.target.closest('[data-stats-action]');
      if (!button || !host.contains(button)) return;
      const action = button.dataset.statsAction;
      try {
        if (action === 'member') { if (ctx.onMember) ctx.onMember(button.dataset.name, button.dataset.kind); }
        else if (action === 'type') { if (ctx.onFilter) ctx.onFilter(button.dataset.type); }
        else if (action === 'merch-expanded') {
          view.merchExpanded = !view.merchExpanded;
          host.querySelector('#stats-merchandise').innerHTML = merchandiseRows(ctx, snapshot.stats);
        } else if (action === 'location-sort') {
          const which = button.dataset.location, order = button.dataset.sort;
          if (!['cities', 'venues'].includes(which) || !['cost', 'count'].includes(order)) return;
          view[which + 'Sort'] = order;
          host.querySelector('#stats-' + which).innerHTML = locations(ctx, snapshot.stats, which);
          for (const control of host.querySelectorAll('[data-stats-action="location-sort"][data-location="' + which + '"]')) control.classList.toggle('active', control.dataset.sort === order);
        } else if (action === 'months-expanded') {
          view.monthsExpanded = !view.monthsExpanded;
          host.querySelector('#stats-monthly').innerHTML = monthlyRows(ctx, snapshot.months);
        } else if (action === 'month-period') {
          if (ctx.onCustom) ctx.onCustom(button.dataset.start, button.dataset.end);
        }
        else if (action === 'previous') {
          if (ctx.periodKind !== 'custom' && ctx.onPeriod) ctx.onPeriod(ctx.periodKind, ctx.range.previousStart);
          else if (ctx.onCustom) ctx.onCustom(ctx.range.previousStart, ctx.range.previousEnd);
        } else if (action === 'rank-kind' || action === 'rank-sort' || action === 'ranks-expanded') {
          if (action === 'rank-kind') { view.kind = button.dataset.kind; view.ranksExpanded = false; }
          else if (action === 'rank-sort') view.sort = button.dataset.sort;
          else view.ranksExpanded = !view.ranksExpanded;
          host.querySelector('#stats-ranking').innerHTML = rankRows(ctx, snapshot.stats);
          for (const control of host.querySelectorAll('[data-stats-action="rank-kind"]')) control.classList.toggle('active', control.dataset.kind === view.kind);
          for (const control of host.querySelectorAll('[data-stats-action="rank-sort"]')) control.classList.toggle('active', control.dataset.sort === view.sort);
        } else if (action === 'cities-expanded' || action === 'venues-expanded') {
          const which = action.split('-')[0];
          view[which + 'Expanded'] = !view[which + 'Expanded'];
          host.querySelector('#stats-' + which).innerHTML = locations(ctx, snapshot.stats, which);
        } else if (action === 'trend') {
          const index = Number(button.dataset.index), row = snapshot.data.buckets[index];
          if (!row) return;
          for (const column of host.querySelectorAll('[data-stats-action="trend"]')) column.classList.toggle('selected', column === button);
          host.querySelector('#stats-trend-caption').textContent = { day: '所选日期支出', week: '所选周支出', month: '所选月份支出', year: '所选年份支出' }[snapshot.data.unit] || '所选时段支出';
          host.querySelector('#stats-trend-amount').innerHTML = currency(ctx, row.cost);
          host.querySelector('#stats-trend-detail').innerHTML = '<strong>' + e(ctx, row.start + (row.start === row.end ? '' : ' 至 ' + row.end)) + '</strong><br>' + currency(ctx, row.cost) + ' · ' + row.count + ' 条活动' + (ctx.onCustom ? '<button class="text stats-period-link" data-stats-action="trend-period" data-index="' + index + '">查看此时段 →</button>' : '');
        } else if (action === 'trend-period') {
          const row = snapshot.data.buckets[Number(button.dataset.index)];
          if (row && ctx.onCustom) ctx.onCustom(row.start, row.end);
        }
      } catch (error) { if (ctx.notify) ctx.notify(error.message || '操作未完成'); }
    };
  }
  root.IdolStats = { render, bind, sortLocations };
})(typeof globalThis !== 'undefined' ? globalThis : this);
