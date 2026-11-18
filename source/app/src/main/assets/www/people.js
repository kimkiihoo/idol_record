(function (root) {
  'use strict';
  const view = { section: 'members', query: '', member: '', order: 'latest', limit: 30, memberSort: 'count', memberKind: 'individual', memberLimit: 30 };
  const labels = { overview: '总览', members: '成员', photos: '拍切记录', groups: '团体', footprints: '足迹' };
  const formats = { cheki: '普通切', signed: '签名切', unsigned: '无签切', online: '电切', theme: '主题切', homework: '宿题/主题', other: '其它特典' };
  let avatarReceiver = null;

  function avatar(ctx, profile, extraClass) {
    const entity = profile || {};
    const color = /^#[0-9a-f]{6}$/i.test(entity.color || '') ? entity.color : '#FFFFFF';
    const face = entity.avatar ? '<img src="' + ctx.esc(entity.avatar) + '" alt="' + ctx.esc(entity.name || '') + '的头像">' : ctx.esc(Array.from(entity.name || '?')[0]);
    return '<span class="member-avatar' + (extraClass ? ' ' + extraClass : '') + '" style="--member-color:' + color + '">' + face + '</span>';
  }
  function setupAvatarPicker(ctx, token, checkSelector, previewSelector, entity, onAvatar) {
    const updateAvatar = data => {
      const target = document.querySelector(checkSelector);
      if (document.querySelector('#modal').classList.contains('hidden') || !target || target.dataset.token !== token) return;
      onAvatar(data);
      const preview = document.querySelector(previewSelector);
      if (preview) preview.innerHTML = avatar(ctx, Object.assign({}, entity, { avatar: data }));
    };
    const anchor = document.querySelector(checkSelector);
    if (anchor) anchor.dataset.token = token;
    avatarReceiver = { token, receive: updateAvatar };
    ctx.on('#choose-avatar', 'click', () => {
      if (root.AndroidBridge) { root.AndroidBridge.pickAvatar(token); return; }
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async () => {
        try {
          const file = input.files[0];
          if (!file) return;
          if (file.size > 20 * 1024 * 1024) throw new Error('请选择 20 MB 以内的头像图片');
          const url = URL.createObjectURL(file);
          const picture = new Image();
          picture.onload = () => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
            const size = Math.min(picture.width, picture.height);
            context.drawImage(picture, (picture.width - size) / 2, (picture.height - size) / 2, size, size, 0, 0, 256, 256);
            updateAvatar(canvas.toDataURL('image/jpeg', 0.85)); URL.revokeObjectURL(url);
          };
          picture.onerror = () => { URL.revokeObjectURL(url); ctx.notify('无法读取头像图片'); };
          picture.src = url;
        } catch (error) { ctx.notify(error.message); }
      };
      input.click();
    });
    ctx.on('#clear-avatar', 'click', () => updateAvatar(''));
  }

  function navigation() {
    return '<div class="stats-tabs" aria-label="统计目录">' + Object.entries(labels).map(([key,label]) => '<button data-stats-section="' + key + '" class="' + (view.section === key ? 'active' : '') + '">' + label + '</button>').join('') + '</div>';
  }

  function profileFor(ctx, name) {
    return ctx.C.resolveMember(ctx.state,name);
  }

  function rowCard(ctx, row) {
    const C = ctx.C;
    const participants = C.participantIds(row.item);
    const faces = participants.map(name => avatar(ctx, profileFor(ctx, name))).join('');
    const kind = C.kind(row.item);
    const prefix = kind === 'multi' ? '多人特典 · ' : C.isGroupItem(row.item) ? (kind === 'phone' ? '团体 · ' : '团体特典 · ') : '';
    return '<button class="interaction-card" data-interaction-event="' + ctx.esc(row.event.id) + '"><div class="row"><small>' + ctx.esc((row.date || '').slice(0, 10)) + '</small><strong>' + ctx.money(C.itemTotal(row.item)) + '</strong></div><div class="interaction-target">' + (faces ? '<div class="avatar-stack">' + faces + '</div>' : '') + '<strong>' + ctx.esc(C.itemName(row.item)) + '</strong></div><p>' + ctx.esc(prefix + C.benefitLabel(row.item,ctx.state,row.event)) + ' · ' + C.count(row.item) + ' 张</p><p>' + ctx.esc(row.event.event_name || '未命名活动') + '</p>' + (row.groups.length ? '<p>' + ctx.esc(row.groups.join(' / ')) + '</p>' : '') + (row.item.note ? '<p>' + ctx.esc(row.item.note) + '</p>' : '') + '</button>';
  }

  function bindRows(ctx) {
    ctx.allOn('[data-interaction-event]', 'click', element => ctx.onEvent(element.dataset.interactionEvent));
  }

  function render(ctx) {
    if (view.section === 'overview') return ctx.renderOverview();
    if (view.section === 'footprints') return ctx.renderFootprints();
    if (view.section === 'photos') {
      const members = ctx.C.memberCatalog(ctx.state);
      return '<div class="filter-grid">' + ctx.select('成员', 'photo-member', Object.fromEntries([['', '全部成员'], ...members.map(profile => [profile.id, ctx.C.memberLabel(profile,ctx.state)])]), view.member) + ctx.select('时间顺序', 'photo-order', { latest: '最新拍摄在前', oldest: '最早拍摄在前' }, view.order) + '</div><input id="photo-search" class="search search-below-filters" autocomplete="off" placeholder="搜索成员、活动、备注或拼音" value="' + ctx.esc(view.query) + '"><div id="photo-results"></div>';
    }
    if (view.section === 'members') {
      return '<div class="filter-grid">' + ctx.select('排行对象','member-kind',{individual:'个人',group:'团体特典'},view.memberKind) +
        ctx.select('排序','member-order',{count:'按互动数量',cost:'按金额',latest:'按最新拍切日期'},view.memberSort) + '</div><div class="row search-row"><input id="member-search" autocomplete="off" placeholder="搜索成员、团体、社媒账号" value="' + ctx.esc(view.query) + '"><button id="add-profile" class="primary compact member-add">＋ 新建成员</button></div><p id="member-scope-note" class="subtle"></p><div id="member-results" class="member-list"></div>';
    }
    return '<input id="group-search" autocomplete="off" placeholder="搜索团体名称或拼音" value="' + ctx.esc(view.query) + '"><div id="group-results" class="member-list"></div>';
  }

  function bind(ctx) {
    ctx.allOn('[data-stats-section]', 'click', element => {
      view.section = element.dataset.statsSection;
      view.query = ''; view.limit = 30; view.memberLimit = 30;
      ctx.onSection(view.section);
    });
    if (view.section === 'overview') { ctx.bindOverview(); return; }
    if (view.section === 'footprints') { ctx.bindFootprints(); return; }
    if (view.section === 'photos') {
      const results = () => {
        const rows = ctx.C.interactionRows(ctx.state, { start: ctx.range.start, end: ctx.range.end, photosOnly: true, member: view.member, query: view.query, pinyin: root.IdolPinyin, order: view.order });
        document.querySelector('#photo-results').innerHTML = '<p class="filter-hint">' + rows.length + ' 条记录 · ' + rows.reduce((sum, row) => sum + ctx.C.count(row.item), 0) + ' 张</p>' + rows.slice(0, view.limit).map(row => rowCard(ctx, row)).join('') + (rows.length ? '' : ctx.empty('本时段没有匹配的拍切记录')) + (rows.length > view.limit ? '<button id="more-photos" class="outline">再显示 30 条</button>' : '');
        bindRows(ctx);
        ctx.on('#more-photos', 'click', () => { view.limit += 30; results(); });
      };
      ctx.on('#photo-search', 'input', event => { if (event.isComposing) return; view.query = event.target.value; view.limit = 30; results(); });
      ctx.on('#photo-search', 'compositionend', event => { view.query = event.target.value; results(); });
      ctx.on('#photo-member', 'change', event => { view.member = event.target.value; view.limit = 30; results(); });
      ctx.on('#photo-order', 'change', event => { view.order = event.target.value; results(); });
      results(); return;
    }
    if (view.section === 'members') {
      const results = () => {
        const range = ctx.range;
        const members = ctx.C.memberMetrics(ctx.state, { start:range.start,end:range.end,photosOnly:false,breakdown:true,kind:view.memberKind,sort:view.memberSort });
        const filtered = members.filter(member => member.count > 0 && !profileFor(ctx,member.id).archived && ctx.C.search(Object.assign({},profileFor(ctx,member.id),member),view.query,root.IdolPinyin));
        const unit = ' 张';
        document.querySelector('#member-scope-note').textContent = (range.start ? range.start + ' 至 ' + range.end : '全部历史') + ' · 拍立得特典张数 · 多人特典金额按参与人数均摊';
        document.querySelector('#member-results').innerHTML = filtered.slice(0,view.memberLimit).map((member,index) => {
          const profile=profileFor(ctx,member.id);
          const lastDay=(member.last_date||'').slice(0,10);
          const main=view.memberSort === 'cost'?ctx.money(member.cost):view.memberSort === 'latest'?(lastDay||'暂无拍切'):member.count+unit;
          const rowAvatar = view.memberKind === 'individual' ? avatar(ctx,profile) : avatar(ctx, ctx.C.groupProfile(ctx.state, member.name));
          return '<button class="profile-row member-ranking" data-member-profile="' + ctx.esc(member.name) + '" data-member-id="'+ctx.esc(member.id)+'"><span class="rank-index">' + (index+1) + '</span>' + rowAvatar + '<span class="member-identity"><strong>' + ctx.esc(view.memberKind==='individual'?ctx.C.memberLabel(profile,ctx.state):member.name) + '</strong><small>' + ctx.esc(profile.groups.join(' / ')) + '</small><small>最近 ' + ctx.esc(lastDay||'暂无记录') + '</small></span><span class="member-numbers"><strong>' + ctx.esc(main) + '</strong><small>' + (view.memberSort === 'cost'?member.count+unit:ctx.money(member.cost)) + '</small></span></button>';
        }).join('') + (filtered.length?'':ctx.empty('暂无匹配的成员记录')) + (filtered.length>view.memberLimit?'<button id="more-members" class="outline">再显示 30 位</button>':'');
        ctx.allOn('[data-member-profile]','click',element => {
          const target=Object.assign({},ctx,{range});
          if(view.memberKind === 'group')showGroup(target,element.dataset.memberProfile);
          else showMember(target,element.dataset.memberId);
        });
        ctx.on('#more-members','click',()=>{view.memberLimit+=30;results();});
      };
      ctx.on('#member-search','input',event=>{if(event.isComposing)return;view.query=event.target.value;view.memberLimit=30;results();});
      ctx.on('#member-search','compositionend',event=>{view.query=event.target.value;results();});
      for(const [id,key] of [['member-kind','memberKind'],['member-order','memberSort']])ctx.on('#'+id,'change',event=>{view[key]=event.target.value;view.memberLimit=30;results();});
      ctx.on('#add-profile','click',()=>editProfile(ctx,''));
      results();return;
    }
    const results=()=>{
      const groups=ctx.C.groupCatalog(ctx.state).filter(name=>ctx.C.search({name},view.query,root.IdolPinyin)).map(name=>{
        const rows=ctx.C.interactionRows(ctx.state,{group:name,start:ctx.range.start,end:ctx.range.end});
        const events=ctx.C.filterRecords(ctx.state.records,{start:ctx.range.start,end:ctx.range.end}).filter(event=>ctx.C.names(event.performing_groups).includes(name));
        return {name, count:rows.length, cost:rows.reduce((sum,row)=>sum+ctx.C.itemTotal(row.item),0), events:events.length};
      }).filter(group=>group.count>0).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh'));
      document.querySelector('#group-results').innerHTML=groups.map(group=>
        '<button class="profile-row" data-group-profile="'+ctx.esc(group.name)+'">'+avatar(ctx,ctx.C.groupProfile(ctx.state,group.name))+'<span><strong>'+ctx.esc(group.name)+'</strong><small>'+group.count+' 条互动 · '+ctx.money(group.cost)+' · '+group.events+' 场参演活动</small></span><span>›</span></button>'
      ).join('')||ctx.empty('暂无匹配的团体');
      ctx.allOn('[data-group-profile]','click',element=>showGroup(ctx,element.dataset.groupProfile));
    };
    ctx.on('#group-search','input',event=>{if(event.isComposing)return;view.query=event.target.value;results();});
    ctx.on('#group-search','compositionend',event=>{view.query=event.target.value;results();});
    results();
  }

  function history(ctx, title, options, profileHtml) {
    let limit = 30;
    let order = 'latest';
    function paint() {
      const rows = ctx.C.interactionRows(ctx.state, Object.assign({ start: ctx.range.start, end: ctx.range.end, order }, options));
      const cost = rows.reduce((sum, row) => sum + ctx.C.itemTotal(row.item), 0);
      ctx.modal(title, (profileHtml || '') + '<p class="subtle">' + ctx.esc(ctx.range.label || '全部历史') + (options.dateBasis === 'activity' ? ' · 按活动日期' : ' · 按拍摄日期') + ' · ' + rows.length + ' 条互动 · 关联记录金额 ' + ctx.money(cost) + '</p>' + ctx.select('时间顺序', 'history-order', { latest: '最新拍摄在前', oldest: '最早拍摄在前' }, order) + '<div id="person-history">' + rows.slice(0, limit).map(row => rowCard(ctx, row)).join('') + '</div>' + (rows.length ? '' : ctx.empty('本时段暂无互动记录')) + (rows.length > limit ? '<button id="more-history" class="outline">再显示 30 条</button>' : ''));
      bindRows(ctx);
      ctx.on('#history-order', 'change', event => { order = event.target.value; paint(); });
      ctx.on('#more-history', 'click', () => { limit += 30; paint(); });
      if (options.member) {ctx.on('#edit-profile', 'click', () => editProfile(ctx, options.member));ctx.on('#quick-member','click',()=>ctx.onQuick(options.member));}
      if (options.onPaint) options.onPaint();
    }
    paint();
  }

  function daysSince(dateText) {
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return '暂无';
    const now = new Date();
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const [y, m, d] = dateText.split('-').map(Number);
    const firstUtc = Date.UTC(y, m - 1, d);
    if (firstUtc > todayUtc) return '0 天';
    return (Math.floor((todayUtc - firstUtc) / 86400000) + 1) + ' 天';
  }

  function showMember(ctx,key,dateBasis) {
    const profile=profileFor(ctx,key),summary=ctx.C.memberSummary(ctx.state,profile.id,{start:ctx.range.start,end:ctx.range.end,dateBasis});
    const allTime=(ctx.range&&(ctx.range.start||ctx.range.end))?ctx.C.memberSummary(ctx.state,profile.id,{dateBasis}):summary;
    const accounts=(profile.social_accounts||[]).map(account=>ctx.detailLine(account.platform,account.account)).join('');
    const aliases=profile.aliases.length?ctx.detailLine('曾用名',profile.aliases.join(' / ')):'';
    const metaCard=(accounts||aliases)?'<div class="card member-meta-card">'+aliases+accounts+'</div>':'';
    const totalTickets=allTime.count;
    const nextMilestone=Math.max(100,Math.floor(totalTickets/100+1)*100);
    const firstMetDate=profile.first_met||(allTime.first||'').slice(0,10);
    const firstMet=firstMetDate||'暂无';
    const html='<div class="profile-heading">'+avatar(ctx,profile)+'<div><h2>'+ctx.esc(profile.name)+'</h2><p>'+ctx.esc(profile.groups.join(' / ')||'未设置团体')+'</p></div></div>'+
      '<div class="actions member-actions"><button id="edit-profile" class="outline">编辑资料</button><button id="quick-member" class="primary">＋ 补记互动</button></div>'+
      metaCard+
      '<div class="card">'+ctx.detailLine('累计特典',summary.count+' 张')+(summary.phoneCount?ctx.detailLine('手机合影',summary.phoneCount+' 张'):'')+ctx.detailLine('初识天数',daysSince(firstMetDate))+ctx.detailLine('初次见面',firstMet)+ctx.detailLine('最近互动',(summary.latest||'').slice(0,10)||'暂无')+(nextMilestone?ctx.detailLine(nextMilestone===100?'距离百切':'距离'+nextMilestone+'切',(nextMilestone-totalTickets)+' 张'):'')+'</div>'+
      (summary.forms.length?'<details class="member-details"><summary>特典分类</summary>'+summary.forms.map(row=>ctx.detailLine(row.name,row.count+' 张')).join('')+'</details>':'')+
      (summary.months.length?'<details class="member-details"><summary>互动趋势 · 按拍摄月份</summary>'+summary.months.map(row=>ctx.detailLine(row.name,row.count+' 张')).join('')+'</details>':'')+
      (profile.note?'<p class="notice" style="margin-top:12px">'+ctx.esc(profile.note)+'</p>':'')+'<p class="subtle">距离百切按全部时间特典券累计计算，以下每条互动显示该条实付金额。</p>';
    history(ctx,profile.name+' · 互动记录',{member:profile.id,dateBasis},html);
  }
  function manageMembers(ctx) {
    let query = '', limit = 30;
    ctx.modal('成员档案管理', '<div class="row"><input id="manage-query" autocomplete="off" placeholder="搜索姓名、曾用名或团体"><button id="manage-create" class="primary compact">新建成员</button></div><p class="subtle">包含未记账与已归档成员。</p><div id="managed-members"></div>');
    function results() {
      const profiles = ctx.C.memberCatalog(ctx.state).filter(profile => ctx.C.search(profile, query, root.IdolPinyin));
      document.querySelector('#managed-members').innerHTML = profiles.slice(0, limit).map(profile =>
        '<button class="profile-row" data-manage-member="' + ctx.esc(profile.id) + '">' + avatar(ctx, profile) + '<span><strong>' + ctx.esc(ctx.C.memberLabel(profile,ctx.state)) + '</strong><small>' + ctx.esc(profile.groups.join(' / ') || '未设置团体') + (profile.archived ? ' · 已归档' : '') + '</small></span><span>编辑 ›</span></button>'
      ).join('') + (profiles.length ? '' : ctx.empty('暂无匹配的成员')) + (profiles.length > limit ? '<button id="manage-more" class="outline">再显示 30 位</button>' : '');
      ctx.allOn('[data-manage-member]', 'click', button => editProfile(ctx, button.dataset.manageMember, true));
      ctx.on('#manage-more', 'click', () => { limit += 30; results(); });
    }
    ctx.on('#manage-create', 'click', () => editProfile(ctx, '', true));
    function search(event) {
      if (event.isComposing) return;
      query = event.target.value;
      limit = 30;
      results();
    }
    ctx.on('#manage-query', 'input', search);
    ctx.on('#manage-query', 'compositionend', search);
    ctx.on('#manage-query', 'change', search);
    results();
  }
  function refreshCtx(ctx, nextState) {
    return Object.assign({}, ctx, { state: ctx.C.validateState(nextState) });
  }
  function batchChecklistModal(ctx, config) {
    let query = '', onlyUnassigned = false;
    const chosen = new Set(config.selected || []);
    function renderBody() {
      const visible = config.items.filter(item =>
        (!onlyUnassigned || !chosen.has(item.key)) &&
        ctx.C.search({ name: item.search || item.title + ' ' + (item.meta || '') }, query, root.IdolPinyin)
      );
      document.querySelector('#batch-summary').textContent = '已选 ' + chosen.size + ' 项';
      document.querySelector('#batch-list').innerHTML = visible.map((item, idx) => {
        const on = chosen.has(item.key);
        return '<button type="button" class="profile-row batch-item' + (on ? ' active' : '') + '" data-batch-index="' + idx + '" data-batch-key="' + ctx.esc(item.key) + '">' +
          '<span class="batch-mark" aria-hidden="true">' + (on ? '✓' : '') + '</span>' +
          (item.avatarHtml || '') +
          '<span><strong>' + ctx.esc(item.title) + '</strong>' + (item.meta ? '<small>' + ctx.esc(item.meta) + '</small>' : '') + '</span>' +
          '<span>' + (on ? '已选' : '选择') + '</span></button>';
      }).join('') || ctx.empty(config.emptyText || '暂无可选项');
      ctx.allOn('[data-batch-index]', 'click', button => {
        const item = visible[Number(button.dataset.batchIndex)];
        if (!item) return;
        if (chosen.has(item.key)) chosen.delete(item.key);
        else chosen.add(item.key);
        renderBody();
      });
    }
    ctx.modal(
      config.title,
      '<p class="subtle">' + ctx.esc(config.hint || '') + '</p>' +
        '<div class="row"><input id="batch-query" autocomplete="off" placeholder="' + ctx.esc(config.placeholder || '搜索名称或拼音') + '"><button type="button" id="batch-toggle-filter" class="outline compact">仅看未选</button></div>' +
        '<div class="row" style="margin:10px 0"><small id="batch-summary">已选 ' + chosen.size + ' 项</small><button type="button" id="batch-select-visible" class="text">全选当前列表</button></div>' +
        '<div id="batch-list" class="batch-list"></div>' +
        '<div id="form-error" class="error"></div>' +
        '<div class="actions"><button type="button" id="batch-back" class="outline">返回</button><button type="button" id="save-batch-assign" class="primary">保存批量设置</button></div>',
      true,
    );
    const onSearch = event => { if (!event.isComposing) { query = event.target.value; renderBody(); } };
    ctx.on('#batch-query', 'input', onSearch);
    ctx.on('#batch-query', 'compositionend', onSearch);
    ctx.on('#batch-toggle-filter', 'click', () => {
      onlyUnassigned = !onlyUnassigned;
      document.querySelector('#batch-toggle-filter').classList.toggle('active', onlyUnassigned);
      renderBody();
    });
    ctx.on('#batch-select-visible', 'click', () => {
      const visible = config.items.filter(item =>
        (!onlyUnassigned || !chosen.has(item.key)) &&
        ctx.C.search({ name: item.search || item.title + ' ' + (item.meta || '') }, query, root.IdolPinyin)
      );
      visible.forEach(item => chosen.add(item.key));
      renderBody();
    });
    ctx.on('#batch-back', 'click', () => config.onBack(ctx));
    ctx.on('#save-batch-assign', 'click', () => config.onSave(Array.from(chosen)));
    renderBody();
  }
  function batchAssignEvents(ctx, organizerName) {
    const events = ctx.state.records.slice().sort((a, b) => ((a.event_type === 'performance' ? 0 : 1) - (b.event_type === 'performance' ? 0 : 1)) || b.date.localeCompare(a.date));
    const current = events.filter(ev => ctx.C.eventOrganizers(ev).includes(organizerName)).map(ev => ev.id);
    batchChecklistModal(ctx, {
      title: '批量设置主办演出 · ' + organizerName,
      hint: '勾选由该事务所主办的演出或活动，保存后会批量关联到该事务所，不影响联合主办的其他事务所。',
      placeholder: '搜索活动名称、城市、场地或日期',
      emptyText: '暂无活动记录',
      selected: current,
      items: events.map(ev => {
        const orgs = ctx.C.eventOrganizers(ev);
        return {
          key: ev.id,
          title: ev.event_name || '未命名活动',
          meta: ev.date + (ev.venue && ev.venue !== '-' ? ' · ' + ev.venue : '') + (orgs.length ? ' · ' + orgs.join(' / ') : ''),
          search: [ev.event_name, ev.date, ev.city, ev.venue, ...orgs].join(' '),
        };
      }),
      onBack: c => showOrganizer(c, organizerName),
      onSave: keys => {
        const res = ctx.C.setOrganizerEvents(ctx.state, organizerName, keys);
        ctx.persist(res.state);
        ctx.rerender();
        ctx.notify('已更新「' + organizerName + '」主办的 ' + keys.length + ' 场活动');
        showOrganizer(refreshCtx(ctx, res.state), organizerName);
      },
    });
  }
  function batchAssignGroups(ctx, organizerName) {
    const catalog = ctx.C.groupCatalog(ctx.state);
    const current = catalog.filter(name => (ctx.C.groupProfile(ctx.state, name).organizers || []).includes(organizerName));
    batchChecklistModal(ctx, {
      title: '批量添加旗下团体 · ' + organizerName,
      hint: '勾选归属于该事务所的团体，支持多团批量关联或调整归属。',
      placeholder: '搜索团体名称或拼音',
      emptyText: '暂无团体档案',
      selected: current,
      items: catalog.map(name => {
        const gp = ctx.C.groupProfile(ctx.state, name);
        return {
          key: name,
          avatarHtml: avatar(ctx, gp),
          title: name,
          meta: (gp.organizers || []).length ? '所属：' + gp.organizers.join(' / ') : '暂未关联事务所',
          search: [name, ...(gp.organizers || [])].join(' '),
        };
      }),
      onBack: c => showOrganizer(c, organizerName),
      onSave: keys => {
        const res = ctx.C.setOrganizerGroups(ctx.state, organizerName, keys);
        ctx.persist(res.state);
        ctx.rerender();
        ctx.notify('已更新「' + organizerName + '」旗下团体（共 ' + keys.length + ' 个）');
        showOrganizer(refreshCtx(ctx, res.state), organizerName);
      },
    });
  }
  function editOrganizer(ctx, originalName, onBack) {
    const profile = ctx.C.organizerProfile(ctx.state, originalName || '');
    let pendingAvatar = profile.avatar;
    const token = String(Date.now()) + Math.random().toString(36).slice(2);
    const eventsCount = originalName ? ctx.state.records.filter(ev => ctx.C.eventOrganizers(ev).includes(originalName)).length : 0;
    ctx.modal(
      originalName ? '编辑事务所资料' : '新建事务所',
      (originalName ? '<div class="card">' + ctx.detailLine('当前名称', originalName) + ctx.detailLine('关联活动', eventsCount + ' 场') + '</div>' : '') +
        '<div class="avatar-picker-row"><span id="entity-avatar-preview">' + avatar(ctx, Object.assign({}, profile, { name: originalName || '社' })) + '</span><button type="button" id="choose-avatar" class="outline">选择头像</button><button type="button" id="clear-avatar" class="text">移除头像</button></div>' +
        ctx.field(originalName ? '事务所名称（修改将一键同步全部关联活动与团体）' : '事务所名称', 'organizer-rename-input', originalName || '', 'text', 'maxlength="300" autocomplete="off"') +
        ctx.textArea('备注', 'organizer-note', profile.note || '') +
        '<div id="form-error" class="error"></div>' +
        '<button type="button" id="confirm-organizer-rename" class="primary" style="width:100%">' + (originalName ? '保存并同步记录' : '保存事务所') + '</button>' +
        '<button type="button" id="organizer-edit-back" class="outline" style="width:100%;margin-top:8px">返回</button>',
      true,
    );
    setupAvatarPicker(ctx, token, '#confirm-organizer-rename', '#entity-avatar-preview', Object.assign({}, profile, { name: originalName || '社' }), data => { pendingAvatar = data; });
    ctx.on('#organizer-edit-back', 'click', () => onBack ? onBack(ctx) : (originalName ? showOrganizer(ctx, originalName) : manageOrganizers(ctx)));
    ctx.on('#confirm-organizer-rename', 'click', () => {
      const nextName = ctx.read('organizer-rename-input');
      if (!nextName) throw new Error('请填写事务所名称');
      if (!originalName && ctx.C.organizerCatalog(ctx.state).includes(nextName)) throw new Error('该事务所已存在');
      const runSave = () => {
        const saved = ctx.C.saveOrganizerProfile(ctx.state, originalName || '', { name: nextName, avatar: pendingAvatar, note: ctx.read('organizer-note') });
        ctx.persist(saved.state);
        if (originalName && originalName !== saved.name && ctx.onRenameOrganizer) ctx.onRenameOrganizer(originalName, saved.name);
        ctx.rerender();
        ctx.notify(saved.updated ? '已保存「' + saved.name + '」，同步更新 ' + saved.updated + ' 条活动' : '已保存事务所「' + saved.name + '」');
        const nextCtx = refreshCtx(ctx, saved.state);
        if (originalName) showOrganizer(nextCtx, saved.name);
        else manageOrganizers(nextCtx);
      };
      if (originalName && nextName !== originalName && ctx.C.organizerCatalog(ctx.state).includes(nextName)) {
        (ctx.askConfirm || ((m, fn) => { if (confirm(m)) fn(); }))({ title: '合并事务所', message: '事务所「' + nextName + '」已存在，是否将「' + originalName + '」及全部关联记录合并到该事务所？', okText: '确认合并' }, runSave);
        return;
      }
      runSave();
    });
  }
  function showOrganizer(ctx, name) {
    const profile = ctx.C.organizerProfile(ctx.state, name);
    const events = ctx.state.records.filter(ev => ctx.C.eventOrganizers(ev).includes(name)).sort((a, b) => b.date.localeCompare(a.date));
    const groups = ctx.C.groupCatalog(ctx.state).filter(g => (ctx.C.groupProfile(ctx.state, g).organizers || []).includes(name));
    const groupHtml = groups.length
      ? groups.map((g, idx) => {
          const gp = ctx.C.groupProfile(ctx.state, g);
          return '<button class="profile-row" data-organizer-group="' + idx + '">' + avatar(ctx, gp) + '<span><strong>' + ctx.esc(g) + '</strong><small>' + ctx.esc(gp.note || '旗下团体') + '</small></span><span>详情 ›</span></button>';
        }).join('')
      : ctx.empty('暂无旗下团体，可点击上方「批量添团体」关联');
    const eventHtml = events.length
      ? events.slice(0, 30).map(ev => '<button class="interaction-card" data-organizer-event="' + ctx.esc(ev.id) + '"><div class="row"><strong>' + ctx.esc(ev.event_name || '未命名活动') + '</strong><strong>' + ctx.money(ctx.C.eventTotal(ev)) + '</strong></div><p>' + ctx.esc(ev.date + (ev.venue && ev.venue !== '-' ? ' · ' + ev.venue : '')) + '</p></button>').join('')
      : ctx.empty('暂未关联主办演出');
    ctx.modal(
      name + ' · 事务所详情',
      '<div class="profile-heading">' + avatar(ctx, profile) + '<div><h2>' + ctx.esc(name) + '</h2><p>' + groups.length + ' 个旗下团体 · ' + events.length + ' 场主办活动</p></div></div>' +
        '<div class="actions member-actions"><button id="edit-organizer-profile" class="outline">编辑 / 一键更名</button><button id="organizer-batch-groups" class="outline">批量添团体</button><button id="organizer-batch-events" class="primary">批量设主办演出</button></div>' +
        (profile.note ? '<p class="notice" style="margin-bottom:12px">' + ctx.esc(profile.note) + '</p>' : '') +
        '<div class="section-title row"><h3>旗下团体</h3><small>' + groups.length + ' 个</small></div>' + groupHtml +
        '<div class="section-title row"><h3>主办演出</h3><small>' + events.length + ' 场</small></div>' + eventHtml +
        '<div class="actions"><button id="organizer-back-list" class="outline">返回列表</button>' +
        (events.length
          ? '<button id="organizer-view-records" class="outline">在记录页查看全部 (' + events.length + ')</button>'
          : (!groups.length ? '<button id="remove-unused-organizer" class="danger">移除未使用预设</button>' : '')) +
        '</div>',
    );
    ctx.on('#edit-organizer-profile', 'click', () => editOrganizer(ctx, name, c => showOrganizer(c, name)));
    ctx.on('#organizer-batch-groups', 'click', () => batchAssignGroups(ctx, name));
    ctx.on('#organizer-batch-events', 'click', () => batchAssignEvents(ctx, name));
    ctx.allOn('[data-organizer-group]', 'click', btn => {
      const g = groups[Number(btn.dataset.organizerGroup)];
      if (g) showGroup(ctx, g, 'activity');
    });
    ctx.allOn('[data-organizer-event]', 'click', btn => ctx.onEvent(btn.dataset.organizerEvent));
    ctx.on('#organizer-back-list', 'click', () => manageOrganizers(ctx));
    ctx.on('#organizer-view-records', 'click', () => {
      ctx.closeModal(true);
      if (ctx.onFilterOrganizer) ctx.onFilterOrganizer(name);
    });
    ctx.on('#remove-unused-organizer', 'click', () => {
      const next = ctx.C.clone(ctx.state);
      next.config.organizers = (next.config.organizers || []).filter(item => item !== name);
      if (Array.isArray(next.config.organizer_profiles)) {
        next.config.organizer_profiles = next.config.organizer_profiles.filter(p => p.name !== name);
      }
      ctx.persist(next);
      ctx.rerender();
      ctx.notify('已移除未使用事务所「' + name + '」');
      manageOrganizers(refreshCtx(ctx, next));
    });
  }
  function manageOrganizers(ctx) {
    let query = '', limit = 30;
    const eventCounts = new Map();
    const groupCounts = new Map();
    for (const event of ctx.state.records) {
      for (const name of ctx.C.eventOrganizers(event)) eventCounts.set(name, (eventCounts.get(name) || 0) + 1);
    }
    for (const g of ctx.C.groupCatalog(ctx.state)) {
      for (const org of (ctx.C.groupProfile(ctx.state, g).organizers || [])) {
        groupCounts.set(org, (groupCounts.get(org) || 0) + 1);
      }
    }
    ctx.modal(
      '事务所管理',
      '<div class="row"><input id="organizer-query" autocomplete="off" placeholder="搜索事务所名称或拼音"><button id="organizer-create" class="primary compact">＋ 新建</button></div>' +
        '<p class="subtle">支持设置头像与备注、批量关联旗下团体与演出，或一键更名同步全部历史记录。</p>' +
        '<div id="managed-organizers"></div>',
    );
    function results() {
      const catalog = ctx.C.organizerCatalog(ctx.state).filter(name => ctx.C.search({ name }, query, root.IdolPinyin));
      document.querySelector('#managed-organizers').innerHTML =
        catalog.slice(0, limit).map((name, index) => {
          const evCount = eventCounts.get(name) || 0;
          const gpCount = groupCounts.get(name) || 0;
          const desc = [gpCount ? gpCount + ' 个旗下团体' : '', evCount ? evCount + ' 场活动' : ''].filter(Boolean).join(' · ') || '预设事务所 · 暂未关联';
          return (
            '<button class="profile-row" data-manage-organizer="' +
            index +
            '">' + avatar(ctx, ctx.C.organizerProfile(ctx.state, name)) + '<span><strong>' +
            ctx.esc(name) +
            '</strong><small>' +
            ctx.esc(desc) +
            '</small></span><span>详情 ›</span></button>'
          );
        }).join('') +
        (catalog.length ? '' : ctx.empty('暂无匹配的事务所，可点击右上角新建')) +
        (catalog.length > limit ? '<button id="organizer-more" class="outline" style="width:100%">再显示 30 个</button>' : '');
      ctx.allOn('[data-manage-organizer]', 'click', button => {
        const picked = catalog[Number(button.dataset.manageOrganizer)];
        if (picked) showOrganizer(ctx, picked);
      });
      ctx.on('#organizer-more', 'click', () => { limit += 30; results(); });
    }
    ctx.on('#organizer-create', 'click', () => editOrganizer(ctx, '', c => manageOrganizers(c)));
    function search(event) {
      if (event.isComposing) return;
      query = event.target.value;
      limit = 30;
      results();
    }
    ctx.on('#organizer-query', 'input', search);
    ctx.on('#organizer-query', 'compositionend', search);
    ctx.on('#organizer-query', 'change', search);
    results();
  }
  function editGroup(ctx, originalName, onBack) {
    const profile = ctx.C.groupProfile(ctx.state, originalName || '');
    let pendingAvatar = profile.avatar;
    const token = String(Date.now()) + Math.random().toString(36).slice(2);
    ctx.modal(
      originalName ? '编辑团体资料' : '新建团体',
      '<div class="avatar-picker-row"><span id="entity-avatar-preview">' + avatar(ctx, Object.assign({}, profile, { name: originalName || '团' })) + '</span><button type="button" id="choose-avatar" class="outline">选择头像</button><button type="button" id="clear-avatar" class="text">移除头像</button></div>' +
        ctx.field(originalName ? '团体名称（修改将一键同步全部成员与活动记录）' : '团体名称', 'group-rename-input', originalName || '', 'text', 'maxlength="300" autocomplete="off"') +
        ctx.field('归属事务所，多个用逗号分隔', 'group-organizers', (profile.organizers || []).join('，'), 'text', 'autocomplete="off"') +
        ctx.historyPicker('group-organizer-history') +
        ctx.textArea('备注', 'group-note', profile.note || '') +
        '<div id="form-error" class="error"></div>' +
        '<button type="button" id="confirm-group-save" class="primary" style="width:100%">' + (originalName ? '保存并同步记录' : '保存团体') + '</button>' +
        '<button type="button" id="group-edit-back" class="outline" style="width:100%;margin-top:8px">返回</button>',
      true,
    );
    setupAvatarPicker(ctx, token, '#confirm-group-save', '#entity-avatar-preview', Object.assign({}, profile, { name: originalName || '团' }), data => { pendingAvatar = data; });
    ctx.bindHistory('group-organizer-history', 'group-organizers', () => ctx.C.organizerCatalog(ctx.state), (selected, previous) => {
      document.querySelector('#group-organizers').value = ctx.C.names([].concat(ctx.C.names(previous), [selected])).join('，');
    });
    ctx.on('#group-edit-back', 'click', () => onBack ? onBack(ctx) : (originalName ? showGroup(ctx, originalName) : manageGroups(ctx)));
    ctx.on('#confirm-group-save', 'click', () => {
      const nextName = ctx.read('group-rename-input');
      if (!nextName) throw new Error('请填写团体名称');
      if (!originalName && ctx.C.groupCatalog(ctx.state).includes(nextName)) throw new Error('该团体已存在');
      const runSave = () => {
        const saved = ctx.C.saveGroupProfile(ctx.state, originalName || '', {
          name: nextName,
          avatar: pendingAvatar,
          organizers: ctx.C.names(ctx.read('group-organizers')),
          note: ctx.read('group-note'),
        });
        ctx.persist(saved.state);
        ctx.rerender();
        ctx.notify(saved.updated ? '已保存「' + saved.name + '」，同步更新 ' + saved.updated + ' 处关联记录' : '已保存团体「' + saved.name + '」');
        const nextCtx = refreshCtx(ctx, saved.state);
        if (originalName) showGroup(nextCtx, saved.name);
        else manageGroups(nextCtx);
      };
      if (originalName && nextName !== originalName && ctx.C.groupCatalog(ctx.state).includes(nextName)) {
        (ctx.askConfirm || ((m, fn) => { if (confirm(m)) fn(); }))({ title: '合并团体', message: '团体「' + nextName + '」已存在，是否将「' + originalName + '」及全部关联记录合并到该团体？', okText: '确认合并' }, runSave);
        return;
      }
      runSave();
    });
  }
  function manageGroups(ctx) {
    let query = '', limit = 30;
    const memberCounts = new Map();
    for (const member of ctx.C.memberCatalog(ctx.state)) {
      for (const g of member.groups || []) memberCounts.set(g, (memberCounts.get(g) || 0) + 1);
    }
    ctx.modal(
      '团体管理',
      '<div class="row"><input id="group-manage-query" autocomplete="off" placeholder="搜索团体名称或拼音"><button id="group-manage-create" class="primary compact">＋ 新建</button></div>' +
        '<p class="subtle">支持设置团体头像、归属事务所与备注，或一键更名同步全部关联记录。</p>' +
        '<div id="managed-groups"></div>',
    );
    function results() {
      const catalog = ctx.C.groupCatalog(ctx.state).filter(name => ctx.C.search({ name }, query, root.IdolPinyin));
      document.querySelector('#managed-groups').innerHTML =
        catalog.slice(0, limit).map((name, index) => {
          const gp = ctx.C.groupProfile(ctx.state, name);
          const members = memberCounts.get(name) || 0;
          const meta = [
            (gp.organizers || []).length ? '所属：' + gp.organizers.join(' / ') : '',
            members ? members + ' 位成员' : '',
          ].filter(Boolean).join(' · ') || '暂未关联成员或事务所';
          return '<button class="profile-row" data-manage-group="' + index + '">' + avatar(ctx, gp) + '<span><strong>' + ctx.esc(name) + '</strong><small>' + ctx.esc(meta) + '</small></span><span>详情 ›</span></button>';
        }).join('') +
        (catalog.length ? '' : ctx.empty('暂无匹配的团体，可点击右上角新建')) +
        (catalog.length > limit ? '<button id="group-manage-more" class="outline" style="width:100%">再显示 30 个</button>' : '');
      ctx.allOn('[data-manage-group]', 'click', button => {
        const picked = catalog[Number(button.dataset.manageGroup)];
        if (picked) showGroup(ctx, picked, 'activity');
      });
      ctx.on('#group-manage-more', 'click', () => { limit += 30; results(); });
    }
    ctx.on('#group-manage-create', 'click', () => editGroup(ctx, '', c => manageGroups(c)));
    const search = event => { if (!event.isComposing) { query = event.target.value; limit = 30; results(); } };
    ctx.on('#group-manage-query', 'input', search);
    ctx.on('#group-manage-query', 'compositionend', search);
    ctx.on('#group-manage-query', 'change', search);
    results();
  }
  function mergeDialog(ctx,sourceId){
    const source=profileFor(ctx,sourceId),candidates=ctx.C.memberCatalog(ctx.state).filter(profile=>profile.id!==sourceId);
    ctx.modal('合并成员档案','<p class="notice">将 '+ctx.esc(source.name)+' 的历史互动和团体资料并入所选档案，同一条合影的重复身份会合并。消费金额与照片数量保留。</p>'+ctx.select('保留的成员档案','merge-member-target',Object.fromEntries(candidates.map(profile=>[profile.id,ctx.C.memberLabel(profile,ctx.state)])),candidates[0]&&candidates[0].id)+'<div id="form-error" class="error"></div><button id="confirm-member-merge" class="primary" style="width:100%">确认合并</button>');
    ctx.on('#confirm-member-merge','click',()=>{if(!candidates.length)throw new Error('请先创建另一份成员档案');(ctx.askConfirm||((o,fn)=>{if(confirm(o.message||o))fn();}))({title:'合并成员档案',message:'确认合并这两份成员档案？保存前会保留上一份状态。',okText:'确认合并'},()=>{ctx.persist(ctx.C.mergeMember(ctx.state,sourceId,ctx.read('merge-member-target')));ctx.closeModal(true);ctx.rerender();ctx.notify('档案与全部历史记录已合并');});});
  }
  function showGroup(ctx, name, dateBasis) {
    const profile=ctx.C.groupProfile(ctx.state,name);
    const events=ctx.C.filterRecords(ctx.state.records,{start:ctx.range.start,end:ctx.range.end}).filter(event=>ctx.C.names(event.performing_groups).includes(name));
    const orgHtml=(profile.organizers||[]).length?'<div class="chips" style="margin:6px 0 0">'+(profile.organizers||[]).map((org,idx)=>'<button type="button" data-group-organizer="'+idx+'">'+ctx.esc(org)+' ›</button>').join('')+'</div>':'<p>暂未关联事务所</p>';
    const heading='<div class="profile-heading">'+avatar(ctx,profile)+'<div><h2>'+ctx.esc(name)+'</h2>'+orgHtml+'</div></div>'+
      '<div class="actions member-actions"><button id="edit-group-profile" class="outline">编辑团体资料</button></div>'+
      (profile.note?'<p class="notice" style="margin-bottom:12px">'+ctx.esc(profile.note)+'</p>':'');
    const lineup=events.length?'<details class="group-performances"><summary>参演活动 '+events.length+' 场</summary>'+events.map(event=>'<button class="interaction-card" data-interaction-event="'+ctx.esc(event.id)+'">'+ctx.esc(event.date+' · '+event.event_name)+'</button>').join('')+'</details>':'';
    const summary=ctx.C.groupSummary(ctx.state,name,{start:ctx.range.start,end:ctx.range.end,dateBasis});
    const distribution='<div class="card">'+ctx.detailLine('总花费',ctx.money(summary.shared))+'</div><details class="member-details"><summary>成员互动分布</summary>'+summary.members.map(member=>ctx.detailLine(ctx.C.memberLabel(ctx.C.resolveMember(ctx.state,member.id),ctx.state),member.count+' 张 · '+ctx.money(member.cost))).join('')+'</details>';
    history(ctx, name + ' · 团体', {
      group: name,
      dateBasis,
      onPaint: () => {
        ctx.on('#edit-group-profile', 'click', () => editGroup(ctx, name, c => showGroup(c, name, dateBasis)));
        ctx.allOn('[data-group-organizer]', 'click', btn => {
          const org = (profile.organizers || [])[Number(btn.dataset.groupOrganizer)];
          if (org) showOrganizer(ctx, org);
        });
      },
    }, heading + lineup + distribution + '<p class="subtle">同一条互动在本团体中只计一次，跨团合影可同时出现在多个团体中。</p>');
  }

  function editProfile(ctx, originalName,fromManager) {
    const profile = ctx.C.clone(profileFor(ctx, originalName));
    if(!originalName)profile.id=ctx.uid();
    let pendingAvatar = profile.avatar;
    const defaultFirstMet = (ctx.C.memberSummary(ctx.state, profile.id, {}).first || '').slice(0, 10);
    let clearedFirstMet = false;
    const token = String(Date.now()) + Math.random().toString(36).slice(2);
    const palette=[['红色','#FF3B30'],['水色','#7EDFFF'],['蓝色','#2563EB'],['黄色','#FFD93D'],['淡粉色','#FFCCE0'],['玫粉色','#E83E8C'],['紫色','#9B5DE5'],['橙色','#FF9500'],['绿色','#34C759'],['白色','#FFFFFF'],['黑色','#111111']];
    const rgb=[1,3,5].map(index=>parseInt(profile.color.slice(index,index+2),16));
    let accounts=ctx.C.clone(profile.social_accounts||[]);
    ctx.modal(originalName?'编辑成员资料':'新建成员',ctx.field('成员姓名','profile-name',profile.name,'text','maxlength="300" autocomplete="off"')+ctx.field('曾用名，多个用逗号分隔','profile-aliases',(profile.aliases||[]).join('，'),'text','autocomplete="off"')+ctx.select('档案状态','profile-archived',{active:'正常显示',archived:'归档'},profile.archived?'archived':'active')+
      '<div class="avatar-picker-row"><span id="profile-avatar-preview">'+avatar(ctx,profile)+'</span><button id="choose-avatar" class="outline">选择头像</button><button id="clear-avatar" class="text">移除头像</button></div>'+
      ctx.field('初次见面日期','profile-first-met',profile.first_met||defaultFirstMet||'','date')+
      (defaultFirstMet?'<div class="row" style="margin:-8px 0 8px"><small class="muted">默认使用历史首次互动日期 '+defaultFirstMet+'</small><button type="button" id="reset-first-met" class="text">恢复默认</button></div>':'<p class="subtle" style="margin:-8px 0 8px">未填写时默认采用最早一次互动的日期。</p>')+
      '<h3>应援色</h3><input id="profile-color" type="hidden" value="'+ctx.esc(profile.color)+'"><div class="color-palette">'+palette.map(([name,color])=>'<button type="button" data-cheer-color="'+color+'" aria-label="'+name+'"><i style="background:'+color+'"></i><span>'+name+'</span></button>').join('')+'</div>'+
      '<div class="rgb-fields">'+['R','G','B'].map((label,index)=>ctx.field(label,'profile-'+label.toLowerCase(),rgb[index],'number','min="0" max="255" inputmode="numeric"')).join('')+'</div><div class="color-result"><i id="profile-color-preview" style="background:'+profile.color+'"></i><span id="profile-color-code">'+profile.color+'</span></div>'+
      ctx.field('归属团体，多个用逗号分隔','profile-groups',profile.groups.join('，'),'text','autocomplete="off"')+ctx.historyPicker('profile-group-history')+
      '<div class="section-title row"><h3>社媒账号</h3><button id="add-social" class="outline compact">＋ 添加社媒</button></div><div id="social-accounts"></div>'+
      ctx.textArea('备注','profile-note',profile.note||'')+'<div id="form-error" class="error"></div><button id="save-profile" class="primary" style="width:100%">保存成员资料</button>'+(originalName?'<button id="merge-profile" class="outline" style="width:100%;margin-top:8px">合并到其它成员</button>':''),true);
    ctx.on('#reset-first-met','click',()=>{clearedFirstMet=true;const input=document.querySelector('#profile-first-met');if(input)input.value=defaultFirstMet||'';ctx.notify('保存后恢复默认初次互动日期');});
    ctx.on('#profile-first-met','input',()=>{clearedFirstMet=false;});
    ctx.on('#profile-first-met','change',()=>{clearedFirstMet=false;});
    ctx.on('#merge-profile','click',()=>mergeDialog(ctx,profile.id));
    ctx.bindHistory('profile-group-history','profile-groups',()=>ctx.C.groupCatalog(ctx.state),(selected,previous)=>{document.querySelector('#profile-groups').value=ctx.C.names([].concat(ctx.C.names(previous),[selected])).join('，');});
    function colorFromInputs(){
      const channels=['r','g','b'].map(channel=>ctx.read('profile-'+channel));
      if(channels.some(channel=>!/^\d{1,3}$/.test(channel)||Number(channel)>255))throw new Error('RGB 各通道须为 0 至 255 的整数');
      return '#'+channels.map(channel=>Number(channel).toString(16).padStart(2,'0')).join('').toUpperCase();
    }
    function previewColor(){
      const color=colorFromInputs();
      document.querySelector('#profile-color').value=color;
      document.querySelector('#profile-color-preview').style.backgroundColor=color;
      document.querySelector('#profile-color-code').textContent=color;
      document.querySelectorAll('[data-cheer-color]').forEach(button=>button.classList.toggle('active',button.dataset.cheerColor.toUpperCase()===color));
    }
    ctx.allOn('[data-cheer-color]','click',button=>{[1,3,5].forEach((index,channel)=>{document.querySelector('#profile-'+['r','g','b'][channel]).value=parseInt(button.dataset.cheerColor.slice(index,index+2),16);});previewColor();});
    for(const channel of ['r','g','b'])ctx.on('#profile-'+channel,'input',()=>{try{previewColor();}catch(_){}});
    previewColor();
    function collectAccounts(){return accounts.map((_,index)=>({platform:ctx.read('social-platform-'+index),account:ctx.read('social-account-'+index)}));}
    function renderAccounts(){
      document.querySelector('#social-accounts').innerHTML=accounts.map((account,index)=>'<div class="social-account-row">'+ctx.field('平台名称','social-platform-'+index,account.platform,'text','maxlength="80"')+ctx.field('账号或主页地址','social-account-'+index,account.account,'text','maxlength="2000"')+'<button type="button" class="text danger" data-remove-social="'+index+'">删除</button></div>').join('');
      ctx.allOn('[data-remove-social]','click',button=>{accounts=collectAccounts();accounts.splice(Number(button.dataset.removeSocial),1);renderAccounts();});
    }
    ctx.on('#add-social','click',()=>{accounts=collectAccounts();if(accounts.length>=32)throw new Error('最多添加 32 条社媒账号');accounts.push({platform:'',account:''});renderAccounts();});
    renderAccounts();
    setupAvatarPicker(ctx, token, '#save-profile', '#profile-avatar-preview', profile, data => { pendingAvatar = data; });
    ctx.on('#save-profile', 'click', () => {
      const next = ctx.C.clone(ctx.state);
      const name = ctx.read('profile-name');
      if (!name) throw new Error('请填写成员姓名');
      const rawFirstMet = ctx.read('profile-first-met');
      let savedFirstMet = '';
      if (rawFirstMet) {
        const validFirst = ctx.C.validDate(rawFirstMet);
        savedFirstMet = (clearedFirstMet || (!profile.first_met && validFirst === defaultFirstMet)) ? '' : validFirst;
      }
      if(originalName)ctx.C.renameMember(next,profile.id,name);
      const updated = Object.assign({}, profile, { id:profile.id,name,aliases:ctx.C.names([...(ctx.C.names(ctx.read('profile-aliases'))),...(originalName&&profile.name!==name?[profile.name]:[])]).filter(alias=>alias!==name),archived:ctx.read('profile-archived')==='archived',avatar: pendingAvatar, first_met: savedFirstMet, color: colorFromInputs(), groups: ctx.C.names(ctx.read('profile-groups')), social_accounts: collectAccounts().filter(account=>account.platform||account.account), note: ctx.read('profile-note') });
      const index = next.members.findIndex(member => member.id === profile.id);
      if (index < 0) next.members.push(updated); else next.members[index] = updated;
      ctx.persist(next);
      if (originalName && view.member === originalName) view.member = profile.id;
      ctx.closeModal(true); ctx.rerender(); ctx.notify('成员资料已保存');if(fromManager)manageMembers(refreshCtx(ctx, next));
    });
  }

  root.onNativeAvatar = (token, data) => { if (avatarReceiver && avatarReceiver.token === token) avatarReceiver.receive(data); };
  root.IdolPeople = { render, bind, manageMembers, manageOrganizers, manageGroups, showOrganizer, avatar, profileFor, showMember, showGroup, navigation, setSection: section => { view.section = section; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
