(function (root) {
  'use strict';
  const view = { section: 'members', query: '', member: '', order: 'latest', limit: 30, memberSort: 'count', memberKind: 'individual', memberLimit: 30 };
  const labels = { overview: '总览', members: '成员', photos: '拍切记录', groups: '团体', footprints: '足迹' };
  const formats = { cheki: '普通切', signed: '签名切', unsigned: '无签切', online: '电切 / 网签', theme: '主题切', homework: '宿题/主题', other: '其它特典' };
  let avatarReceiver = null;

  function avatar(ctx, profile) {
    const color = /^#[0-9a-f]{6}$/i.test(profile.color || '') ? profile.color : '#FFFFFF';
    const face = profile.avatar ? '<img src="' + ctx.esc(profile.avatar) + '" alt="' + ctx.esc(profile.name) + '的头像">' : ctx.esc(Array.from(profile.name || '?')[0]);
    return '<span class="member-avatar" style="--member-color:' + color + '">' + face + '</span>';
  }

  function navigation() {
    return '<div class="stats-tabs" aria-label="统计目录">' + Object.entries(labels).map(([key,label]) => '<button data-stats-section="' + key + '" class="' + (view.section === key ? 'active' : '') + '">' + label + '</button>').join('') + '</div>';
  }

  function profileFor(ctx, name) {
    return ctx.state.members.find(profile => profile.name === name) || { name, groups: [], color: '#FFFFFF', avatar: '', social_accounts: [] };
  }

  function rowCard(ctx, row) {
    const C = ctx.C;
    const participants = C.participants(row.item);
    const faces = participants.map(name => avatar(ctx, profileFor(ctx, name))).join('');
    const kind = C.kind(row.item);
    return '<button class="interaction-card" data-interaction-event="' + ctx.esc(row.event.id) + '"><div class="row"><small>' + ctx.esc(row.date.replace('T', ' ')) + '</small><strong>' + ctx.money(C.itemTotal(row.item)) + '</strong></div><div class="interaction-target"><div class="avatar-stack">' + faces + '</div><strong>' + ctx.esc(C.itemName(row.item)) + '</strong></div><p>' + ctx.esc((kind === 'multi' ? '多人合影 · ' : kind === 'group' ? '团切 · ' : '') + (formats[C.form(row.item, row.event.event_type, row.event)] || '其它特典')) + ' · ' + C.count(row.item) + ' 张 / 份</p><p>' + ctx.esc(row.event.event_name || '未命名活动') + '</p>' + (row.groups.length ? '<p>' + ctx.esc(row.groups.join(' / ')) + '</p>' : '') + (row.item.note ? '<p>' + ctx.esc(row.item.note) + '</p>' : '') + '</button>';
  }

  function bindRows(ctx) {
    ctx.allOn('[data-interaction-event]', 'click', element => ctx.onEvent(element.dataset.interactionEvent));
  }

  function render(ctx) {
    if (view.section === 'overview') return ctx.renderOverview();
    if (view.section === 'footprints') return ctx.renderFootprints();
    if (view.section === 'photos') {
      const members = ctx.C.memberCatalog(ctx.state);
      return '<input id="photo-search" autocomplete="off" placeholder="搜索成员、活动、备注或拼音" value="' + ctx.esc(view.query) + '"><div class="filter-grid">' + ctx.select('成员', 'photo-member', Object.fromEntries([['', '全部成员'], ...members.map(profile => [profile.name, profile.name])]), view.member) + ctx.select('时间顺序', 'photo-order', { latest: '最新拍摄在前', oldest: '最早拍摄在前' }, view.order) + '</div><div id="photo-results"></div>';
    }
    if (view.section === 'members') {
      return '<div class="row"><input id="member-search" autocomplete="off" placeholder="搜索成员、团体、社媒账号" value="' + ctx.esc(view.query) + '"><button id="add-profile" class="primary compact member-add">＋ 新建成员</button></div>' +
        '<div class="filter-grid">' + ctx.select('排行对象','member-kind',{individual:'个人',group:'团体特典'},view.memberKind) +
        ctx.select('排序','member-order',{count:'按互动数量',cost:'按金额',latest:'按最新拍切日期'},view.memberSort) + '</div><p id="member-scope-note" class="subtle"></p><div id="member-results" class="member-list"></div>';
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
        const members = ctx.C.memberMetrics(ctx.state, { start:range.start,end:range.end,photosOnly:false,kind:view.memberKind,sort:view.memberSort });
        const filtered = members.filter(member => member.count > 0 && ctx.C.search(Object.assign({},profileFor(ctx,member.name),member),view.query,root.IdolPinyin));
        const unit = ' 张 / 份';
        document.querySelector('#member-scope-note').textContent = (range.start ? range.start + ' 至 ' + range.end : '全部历史') + ' · 全部特典张 / 份数 · 多人合影金额按参与人数均摊';
        document.querySelector('#member-results').innerHTML = filtered.slice(0,view.memberLimit).map((member,index) => {
          const profile=profileFor(ctx,member.name);
          const main=view.memberSort === 'cost'?ctx.money(member.cost):view.memberSort === 'latest'?(member.last_date.replace('T',' ')||'暂无拍切'):member.count+unit;
          return '<button class="profile-row member-ranking" data-member-profile="' + ctx.esc(member.name) + '"><span class="rank-index">' + (index+1) + '</span>' + (view.memberKind === 'individual'?avatar(ctx,profile):'') + '<span class="member-identity"><strong>' + ctx.esc(member.name) + '</strong><small>' + ctx.esc(profile.groups.join(' / ')) + '</small><small>最近 ' + ctx.esc(member.last_date.replace('T',' ')||'暂无记录') + '</small></span><span class="member-numbers"><strong>' + ctx.esc(main) + '</strong><small>' + (view.memberSort === 'cost'?member.count+unit:ctx.money(member.cost)) + '</small></span></button>';
        }).join('') + (filtered.length?'':ctx.empty('暂无匹配的成员记录')) + (filtered.length>view.memberLimit?'<button id="more-members" class="outline">再显示 30 位</button>':'');
        ctx.allOn('[data-member-profile]','click',element => {
          const target=Object.assign({},ctx,{range});
          if(view.memberKind === 'group')showGroup(target,element.dataset.memberProfile);
          else showMember(target,element.dataset.memberProfile);
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
        '<button class="profile-row" data-group-profile="'+ctx.esc(group.name)+'"><span><strong>'+ctx.esc(group.name)+'</strong><small>'+group.count+' 条互动 · '+ctx.money(group.cost)+' · '+group.events+' 场参演活动</small></span><span>›</span></button>'
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
      if (options.member) ctx.on('#edit-profile', 'click', () => editProfile(ctx, options.member));
    }
    paint();
  }

  function showMember(ctx, name, dateBasis) {
    const profile = profileFor(ctx, name);
    const accounts = (profile.social_accounts||[]).map(account => ctx.detailLine(account.platform,account.account)).join('');
    const html = '<div class="profile-heading">' + avatar(ctx, profile) + '<div><h2>' + ctx.esc(name) + '</h2><p>' + ctx.esc(profile.groups.join(' / ') || '未设置团体') + '</p></div><button id="edit-profile" class="outline compact">编辑资料</button></div>' + accounts + (profile.note ? '<p class="notice">' + ctx.esc(profile.note) + '</p>' : '') + '<p class="subtle">多人合影在每位参与成员的记录中展示。关联金额为整条实付金额，排行按参与成员均摊。</p>';
    history(ctx, name + ' · 互动记录', { member: name, dateBasis }, html);
  }

  function showGroup(ctx, name, dateBasis) {
    const events=ctx.C.filterRecords(ctx.state.records,{start:ctx.range.start,end:ctx.range.end}).filter(event=>ctx.C.names(event.performing_groups).includes(name));
    const lineup=events.length?'<details class="group-performances"><summary>参演活动 '+events.length+' 场</summary>'+events.map(event=>'<button class="interaction-card" data-interaction-event="'+ctx.esc(event.id)+'">'+ctx.esc(event.date+' · '+event.event_name)+'</button>').join('')+'</details>':'';
    history(ctx, name + ' · 团体', { group: name, dateBasis },lineup+'<p class="subtle">同一条互动在本团体中只计一次，跨团合影可同时出现在多个团体中。</p>');
  }

  function editProfile(ctx, originalName) {
    const profile = ctx.C.clone(profileFor(ctx, originalName));
    let pendingAvatar = profile.avatar;
    const token = String(Date.now()) + Math.random().toString(36).slice(2);
    const palette=[['红色','#FF3B30'],['水色','#7EDFFF'],['蓝色','#2563EB'],['黄色','#FFD93D'],['淡粉色','#FFCCE0'],['玫粉色','#E83E8C'],['紫色','#9B5DE5'],['橙色','#FF9500'],['绿色','#34C759'],['白色','#FFFFFF'],['黑色','#111111']];
    const rgb=[1,3,5].map(index=>parseInt(profile.color.slice(index,index+2),16));
    let accounts=ctx.C.clone(profile.social_accounts||[]);
    ctx.modal(originalName?'编辑成员资料':'新建成员',ctx.field('成员姓名','profile-name',profile.name,'text','maxlength="300" autocomplete="off"')+
      '<div class="profile-heading"><span id="profile-avatar-preview">'+avatar(ctx,profile)+'</span><button id="choose-avatar" class="outline">选择头像</button><button id="clear-avatar" class="text">移除头像</button></div>'+
      '<h3>应援色</h3><input id="profile-color" type="hidden" value="'+ctx.esc(profile.color)+'"><div class="color-palette">'+palette.map(([name,color])=>'<button type="button" data-cheer-color="'+color+'" aria-label="'+name+'"><i style="background:'+color+'"></i><span>'+name+'</span></button>').join('')+'</div>'+
      '<div class="rgb-fields">'+['R','G','B'].map((label,index)=>ctx.field(label,'profile-'+label.toLowerCase(),rgb[index],'number','min="0" max="255" inputmode="numeric"')).join('')+'</div><div class="color-result"><i id="profile-color-preview" style="background:'+profile.color+'"></i><span id="profile-color-code">'+profile.color+'</span></div>'+
      ctx.field('归属团体，多个用逗号分隔','profile-groups',profile.groups.join('，'),'text','autocomplete="off"')+ctx.historyPicker('profile-group-history')+
      '<div class="section-title row"><h3>社媒账号</h3><button id="add-social" class="outline compact">＋ 添加社媒</button></div><div id="social-accounts"></div>'+
      ctx.textArea('备注','profile-note',profile.note||'')+'<div id="form-error" class="error"></div><button id="save-profile" class="primary" style="width:100%">保存成员资料</button>',true);
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
    const updateAvatar = data => {
      if (document.querySelector('#modal').classList.contains('hidden') || !document.querySelector('#save-profile') || document.querySelector('#save-profile').dataset.token !== token) return;
      pendingAvatar = data;
      document.querySelector('#profile-avatar-preview').innerHTML = avatar(ctx, Object.assign({}, profile, { avatar: data }));
    };
    document.querySelector('#save-profile').dataset.token = token;
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
    ctx.on('#save-profile', 'click', () => {
      const next = ctx.C.clone(ctx.state);
      const name = ctx.read('profile-name');
      if (!name) throw new Error('请填写成员姓名');
      if (name !== originalName && ctx.C.memberCatalog(next).some(member => member.name === name)) throw new Error('已有同名成员，请在对应档案中编辑');
      const updated = Object.assign({}, profile, { name, avatar: pendingAvatar, color: colorFromInputs(), groups: ctx.C.names(ctx.read('profile-groups')), social_accounts: collectAccounts().filter(account=>account.platform||account.account), note: ctx.read('profile-note') });
      const index = next.members.findIndex(member => member.name === originalName);
      if (index < 0) next.members.push(updated); else next.members[index] = updated;
      if (originalName && originalName !== name) for (const event of next.records) {
        for (const role of event.member_roles || []) if (role.member === originalName) role.member = name;
        for (const item of event.interactions) {
        for (const role of item.participant_groups || []) if (role.member === originalName) role.member = name;
        if (ctx.C.kind(item) === 'individual' && String(item.member) === originalName) item.member = name;
        if (ctx.C.kind(item) === 'multi') item.members = item.members.map(member => member === originalName ? name : member);
      }
      }
      ctx.persist(next);
      if (originalName && view.member === originalName) view.member = name;
      ctx.closeModal(true); ctx.rerender(); ctx.notify('成员资料已保存');
    });
  }

  root.onNativeAvatar = (token, data) => { if (avatarReceiver && avatarReceiver.token === token) avatarReceiver.receive(data); };
  root.IdolPeople = { render, bind, avatar, profileFor, showMember, showGroup, navigation, setSection: section => { view.section = section; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
