(function(){
'use strict';
const C=window.IdolCore,$=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const E={performance:'演出',bonus_only:'单独特典会',online_cheki:'电切',theme_homework:'宿题/主题',merch_only:'周边',off_meeting:'off会',phone_photo:'手机合影',other:'其它活动'};
const E_CREATE={performance:'演出',bonus_only:'单独特典会',online_cheki:'电切',theme_homework:'宿题/主题',merch_only:'周边',off_meeting:'off会',other:'其它活动'};
const F={cheki:'普通切',signed:'签名切',unsigned:'无签切',online:'电切',theme:'主题切',homework:'宿题/主题',other:'其它特典'};
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const cash=v=>'¥'+C.money(v),today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const uid=()=>window.crypto&&crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):Date.now().toString(36)+Math.random().toString(36).slice(2);
let state,storageError='',tab='home',period='month',anchor=today(),customStart=today().slice(0,7)+'-01',customEnd=today(),query='',eventType='',venueFilter='',memberFilter='',organizerFilter='',limit=30,closeGuard=null,toastTimer;
function notice(msg){clearTimeout(toastTimer);$('#toast').textContent=msg;$('#toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),5000);}
window.onNativeNotice=(msg)=>notice(msg);
function showError(err){const target=$('#modal').classList.contains('hidden')?null:$('#form-error');if(target){target.textContent=err.message;target.scrollIntoView({block:'nearest'});}else notice(err.message);}
function guard(fn){return function(e){try{const result=fn(e);if(result&&typeof result.then==='function')result.catch(showError);return result;}catch(err){showError(err);}};}
function on(sel,type,fn){const el=$(sel);if(el)el.addEventListener(type,guard(fn));}
function allOn(sel,type,fn){$$(sel).forEach(el=>el.addEventListener(type,guard(e=>fn(el,e))));}
function read(key){return $('#'+key).value.trim();}
function opts(map,value){const all=Object.assign({},map);if(value&&!Object.prototype.hasOwnProperty.call(all,value))all[value]=value;return Object.entries(all).map(([k,v])=>'<option value="'+esc(k)+'"'+(k===value?' selected':'')+'>'+esc(v)+'</option>').join('');}
function field(label,id,value='',type='text',extra=''){return '<label class="field"><span>'+label+'</span><input id="'+id+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';}
function select(label,id,map,value){return '<label class="field"><span>'+label+'</span><select id="'+id+'">'+opts(map,value)+'</select></label>';}
function textArea(label,id,value=''){return '<label class="field"><span>'+label+'</span><textarea id="'+id+'">'+esc(value)+'</textarea></label>';}
function empty(msg='这一时段还没有记录'){return '<div class="empty">'+esc(msg)+'</div>';}
function detailLine(k,v){return '<div class="detail-line"><span>'+esc(k)+'</span><span>'+esc(v)+'</span></div>';}
function modal(title,html,guardClose){$('#modal-title').textContent=title;$('#modal-body').onclick=null;$('#modal-body').innerHTML=html;$('#modal').classList.remove('hidden');$('.sheet').scrollTop=0;document.body.style.overflow='hidden';closeGuard=guardClose||null;}
function askConfirm(opts,onYes){const cfg=typeof opts==='string'?{message:opts}:Object.assign({},opts);const box=$('#confirm-dialog');if(!box){if(confirm(cfg.message))onYes();return;}$('#confirm-title').textContent=cfg.title||'请确认';$('#confirm-message').textContent=cfg.message||'';const ok=$('#confirm-ok'),cancel=$('#confirm-cancel');ok.textContent=cfg.okText||'确认';cancel.textContent=cfg.cancelText||'取消';ok.classList.toggle('danger',!!cfg.danger);ok.classList.toggle('primary',!cfg.danger);box.classList.remove('hidden');cancel.onclick=()=>{box.classList.add('hidden');};ok.onclick=()=>{box.classList.add('hidden');onYes();};}
function finishCloseModal(){$('#modal').classList.add('hidden');document.body.style.overflow='';closeGuard=null;}
function closeModal(force){if(!force&&closeGuard){askConfirm({title:'放弃尚未保存的修改？',message:'当前填写或调整的内容还未保存，关闭后将不会保留。',okText:'放弃修改',cancelText:'继续编辑',danger:true},finishCloseModal);return;}finishCloseModal();}
on('#modal-close','click',()=>closeModal(false));
window.onNativeBack=()=>{const c=$('#confirm-dialog');if(c&&!c.classList.contains('hidden')){c.classList.add('hidden');return true;}if(window.IdolPhotos&&window.IdolPhotos.closeLightbox&&window.IdolPhotos.closeLightbox())return true;if(!$('#modal').classList.contains('hidden')){closeModal(false);return true;}if(tab!=='home'){navigate('home');return true;}return false;};
function persist(next){let valid=C.validateState(next);valid.updated_at=new Date().toISOString();const text=JSON.stringify(valid);if(window.AndroidBridge){const result=JSON.parse(AndroidBridge.writeState(text));if(!result.ok)throw new Error(result.error||'保存失败，请重试');if(result.state)valid=C.validateState(result.state);}else{localStorage.setItem('idol-previous',localStorage.getItem('idol-state')||'');localStorage.setItem('idol-state',text);}state=valid;storageError='';return true;}
function commitEvent(event,isNew){const next=C.clone(state);const i=next.records.findIndex(r=>r.id===event.id);event.updated_at=new Date().toISOString();if(i>=0)next.records[i]=event;else if(isNew)next.records.push(event);else throw new Error('活动已不存在，请重新打开');persist(next);render();}
function range(){if(period==='custom'){C.validDate(customStart);C.validDate(customEnd);if(customStart>customEnd)throw new Error('开始日期不能晚于结束日期');return{start:customStart,end:customEnd,label:customStart+' 至 '+customEnd};}return C.periodRange(period,anchor);}
function inRange(records){const r=range();return period==='all'?records:C.filterRecords(records,{start:r.start,end:r.end});}
function periodBar(){const r=range();return '<div class="filters"><div class="segmented">'+Object.entries({week:'周',month:'月',quarter:'季度',year:'年',all:'全部',custom:'自定义'}).map(([k,v])=>'<button data-period="'+k+'" class="'+(period===k?'active':'')+'">'+v+'</button>').join('')+'</div>'+(period==='all'?'<div class="period-note">全部历史记录</div>':period==='custom'?'<div class="filter-grid">'+field('开始日期','range-start',customStart,'date')+field('结束日期','range-end',customEnd,'date')+'</div>':'<div class="period-controls"><button id="prev-period" aria-label="上一时段">‹</button><input id="anchor" type="date" value="'+esc(anchor)+'" aria-label="选择日期"><button id="next-period" aria-label="下一时段">›</button></div><div class="period-note">'+esc(r.start)+' — '+esc(r.end)+(period==='week'?' · 周一至周日':'')+'</div>')+'</div>';}
function shiftPeriod(direction){const d=new Date(anchor+'T12:00:00');if(period==='week')d.setDate(d.getDate()+7*direction);else if(period==='month'||period==='quarter'){d.setDate(1);d.setMonth(d.getMonth()+(period==='quarter'?3:1)*direction);}else{d.setDate(1);d.setMonth(0);d.setFullYear(d.getFullYear()+direction);}anchor=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');limit=30;render();}
function bindPeriod(){allOn('[data-period]','click',el=>{period=el.dataset.period;limit=30;render();});on('#anchor','change',()=>{anchor=C.validDate(read('anchor'));limit=30;render();});on('#prev-period','click',()=>shiftPeriod(-1));on('#next-period','click',()=>shiftPeriod(1));on('#range-start','change',()=>{const v=C.validDate(read('range-start'));if(v>customEnd)throw new Error('开始日期不能晚于结束日期');customStart=v;render();});on('#range-end','change',()=>{const v=C.validDate(read('range-end'));if(v<customStart)throw new Error('结束日期不能早于开始日期');customEnd=v;render();});}
function organizerBadges(e){
 const orgs=C.eventOrganizers(e);
 if(!orgs.length||!window.IdolPeople||!window.IdolPeople.avatar)return '';
 const ctx={esc,C,state};
 return '<div class="event-organizers">'+orgs.map(name=>'<span class="organizer-badge">'+window.IdolPeople.avatar(ctx,C.organizerProfile(state,name),'sm')+'<span>'+esc(name)+'</span></span>').join('')+'</div>';
}
function eventCard(e){const names=Array.from(new Set((e.interactions||[]).map(i=>C.itemName(i)).filter(Boolean)));return '<article class="card event click" data-event="'+esc(e.id)+'"><div class="row"><span class="tag">'+esc(E[e.event_type]||e.event_type)+'</span><small>'+esc(e.date)+'</small></div><div class="row" style="margin-top:10px"><h3>'+esc(e.event_name||'未命名活动')+'</h3><span class="amount">'+cash(C.eventTotal(e))+'</span></div><div class="meta">'+esc([e.city,e.venue].filter(x=>x&&x!=='-').join(' · ')||'未填写场地')+'</div>'+organizerBadges(e)+(names.length?'<div class="names">'+esc(names.slice(0,5).join(' / '))+(names.length>5?' 等':'')+'</div>':'')+'<div class="foot"><small>'+e.interactions.length+' 条消费明细</small><span class="muted">查看 / 补记 ›</span></div></article>';}
function bindEvents(){allOn('[data-event]','click',el=>showEvent(el.dataset.event));}
function overviewMetric(kind,label,value){
 return '<button class="overview-metric" data-overview-detail="'+kind+'"><strong>'+value+'</strong><small>'+label+' ›</small></button>';
}
function itemAvatars(item){
 if(!item||!window.IdolPeople||!window.IdolPeople.avatar)return '';
 const ids=C.participantIds(item);if(!ids.length)return '';
 const ctx={esc,C,state};
 return '<div class="avatar-stack">'+ids.map(id=>window.IdolPeople.avatar(ctx,C.resolveMember(state,id))).join('')+'</div>';
}
function showOverviewDetail(kind,records,label){
 const titles={total:'总支出',events:'活动记录',performances:'演出场次',benefits:'特典',phone:'手机合影',days:'有记录的日期',ticket:'门票',drink:'Drink代',merch:'周边'};
 const rows=[];
 for(const event of records){
  if(kind==='performances'&&event.event_type!=='performance')continue;
  if(['benefits','phone','merch'].includes(kind)||kind.startsWith('form.')){
   for(const item of event.interactions){
    const k=C.kind(item),phone=C.isPhone(item,event);
    if(kind==='benefits'&&(k==='merch'||phone))continue;
    if(kind==='phone'&&!phone)continue;
    if(kind==='merch'&&k!=='merch')continue;
    if(kind.startsWith('form.')&&(k==='merch'||phone||C.form(item,event.event_type,event)!==kind.slice(5)))continue;
    rows.push({event,item,cost:C.itemTotal(item)});
   }
  }else{
   const cost=kind==='ticket'?C.cents(event.ticket_fee):kind==='drink'?C.cents(event.drink_fee):C.eventTotal(event);
   if(kind==='drink'&&!cost||kind==='ticket'&&!cost&&!(event.ticket_quantity>0))continue;
   rows.push({event,cost});
  }
 }
 let visible=30;
 function paint(){
  const total=rows.reduce((sum,row)=>sum+row.cost,0),count=rows.reduce((sum,row)=>sum+(row.item?C.count(row.item):1),0);
  const days=new Set(rows.map(row=>row.event.date)).size;
  modal((titles[kind]||F[kind.slice(5)]||'消费')+' · 详情','<p class="subtle">'+esc(label||'全部历史')+' · 按活动日期</p><div class="card">'+detailLine('金额合计',cash(total))+detailLine('记录数',rows.length+' 条')+(rows.some(row=>row.item)?detailLine('数量合计',count+(kind==='merch'?' 件':' 张')):detailLine('有记录的日期',days+' 天'))+'</div>'+rows.slice(0,visible).map(row=>{const faces=row.item?itemAvatars(row.item):'',title=esc(row.item?C.itemName(row.item):row.event.event_name),heading=faces?'<div class="item-member">'+faces+'<strong>'+title+'</strong></div>':'<strong>'+title+'</strong>';return '<button class="interaction-card" data-detail-event="'+esc(row.event.id)+'"><div class="row">'+heading+'<strong class="nowrap">'+cash(row.cost)+'</strong></div><p>'+esc(row.event.date+' · '+(row.item?row.event.event_name:[row.event.city,row.event.venue].filter(Boolean).join(' · ')))+'</p>'+(row.item?'<p>'+C.count(row.item)+(kind==='merch'?' 件':' 张')+'</p>':'')+'</button>';}).join('')+(rows.length?'':empty('本时段暂无记录'))+(rows.length>visible?'<button id="more-overview-detail" class="outline" style="width:100%">再显示 30 条</button>':''));
  allOn('[data-detail-event]','click',element=>showEvent(element.dataset.detailEvent));
  on('#more-overview-detail','click',()=>{visible+=30;paint();});
 }
 paint();
}
function renderHome(){
 const month=today().slice(0,7),rows=state.records.filter(e=>e.date.startsWith(month)),s=C.stats(rows),budget=C.budgetForMonth(state.config,month),left=budget-s.total;
 const homeCosts=[['ticket','门票',s.ticket],['drink','Drink代',s.drink],['benefits','特典',s.benefit],...(s.phone||s.phoneCount?[['phone','手机合影',s.phone]]:[]),['merch','周边',s.merch]];
 return '<div class="intro"><p>'+esc(month)+' · 本月手账</p></div><div class="home-columns"><section class="hero"><small>本月总支出</small><button class="value overview-metric" data-overview-detail="total" aria-label="查看总支出详情"><span>¥ </span>'+C.money(s.total)+' ›</button><div class="hero-grid">'+overviewMetric('events','活动记录',s.eventCount)+overviewMetric('performances','演出场次',s.eventTypes.performance||0)+overviewMetric('benefits','特典张',s.ticketCount)+'</div><div class="separator"></div><div class="row"><small>'+(budget?'月预算 '+cash(budget):'尚未设置月预算')+'</small><small>'+(budget?(left>=0?'剩余 '+cash(left):'超出 '+cash(-left)):'在设置页设置')+'</small></div>'+(budget?'<div class="budget-track"><i class="'+(left<0?'over':'')+'" style="width:'+Math.min(100,s.total/budget*100)+'%"></i></div>':'')+'</section><section><div class="section-title"><h3>本月消费</h3></div><div class="card">'+homeCosts.map(([kind,label,value])=>'<button class="overview-cost" data-overview-detail="'+kind+'">'+detailLine(label,cash(value)+' ›')+'</button>').join('')+'</div><button id="month-stats" class="outline" style="margin-top:12px;width:100%">打开本月详细统计 ↗</button></section></div><div class="section-title row"><h3>最近的相见</h3><button class="text" id="all-records">全部 '+state.records.length+' 条 ›</button></div>'+state.records.slice(0,5).map(eventCard).join('')+(state.records.length?'':empty('还没有记录，点右上角记下第一场活动'));
}
function choiceMap(values,label){return Object.fromEntries([['',label],...C.names(values).sort((a,b)=>a.localeCompare(b,'zh')).map(value=>[value,value])]);}
function renderRecords(){
 const venues=state.records.map(event=>event.venue).filter(value=>value&&value!=='-');
 const organizers=state.records.flatMap(event=>[...C.eventOrganizers(event),...(event.interactions||[]).flatMap(it=>C.names(it.merch_organizers))]);
 return '<div class="intro"><h1>活动记录</h1></div>'+periodBar()+
  '<div class="filter-grid">'+select('活动类型','event-type',Object.assign({'':'全部活动类型'},E),eventType)+select('场地','record-venue',choiceMap(venues,'全部场地'),venueFilter)+
  select('成员','record-member',Object.fromEntries([['','全部成员'],...C.memberCatalog(state).map(profile=>[profile.id,C.memberLabel(profile,state)])]),memberFilter)+select('主办事务所','record-organizer',choiceMap(organizers,'全部主办'),organizerFilter)+'</div>'+
  '<input id="search" class="search search-below-filters" placeholder="搜索活动、成员、场地、主办或拼音" value="'+esc(query)+'">'+
  '<div id="records-results"></div>';
}
function recordResults(){
 const rows=C.filterRecords(inRange(state.records),{state,query,type:eventType,venue:venueFilter,member:memberFilter,organizer:organizerFilter,pinyin:window.IdolPinyin});
 $('#records-results').innerHTML='<div class="filter-hint">共 '+rows.length+' 条 · 合计 '+cash(C.stats(rows).total)+'</div>'+rows.slice(0,limit).map(eventCard).join('')+(rows.length>limit?'<button id="load-more" class="outline" style="width:100%">再显示 30 条</button>':'')+(rows.length?'':empty());
 bindEvents();on('#load-more','click',()=>{limit+=30;recordResults();});
}
function lastBackupTime(){return window.AndroidBridge?(AndroidBridge.lastExportTime?Number(AndroidBridge.lastExportTime()):0):Number(localStorage.getItem('idol-last-export')||0);}
function backupTimeLabel(){const timestamp=lastBackupTime();return timestamp?'最近完整备份导出 '+new Date(timestamp).toLocaleString('zh-CN'):'';}
window.onNativeExported=()=>{if(tab==='backup')render();};
function showFootprintDetail(which,name,city){
 const rows=inRange(state.records).filter(event=>which==='cities'?event.city===name:event.venue===name&&(event.city||'未知城市')===city);let visible=30;
 function paint(){modal(name+' · 足迹详情','<p class="subtle">'+esc(range().label)+' · 按活动日期</p><div class="card">'+detailLine('活动次数',rows.length+' 次')+detailLine('支出合计',cash(C.stats(rows).total))+'</div>'+rows.slice(0,visible).map(eventCard).join('')+(rows.length?'':empty())+(rows.length>visible?'<button id="more-footprint" class="outline">再显示 30 条</button>':''));bindEvents();on('#more-footprint','click',()=>{visible+=30;paint();});}
 paint();
}
function uiSvg(body){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+body+'</svg>';}
function renderBackup(){
 const ico={
  pref:uiSvg('<path d="M4 7h10M18 7h2M14 4.5v5M4 17h4M12 17h8M8 14.5v5"/>'),
  price:uiSvg('<path d="M12.5 4H6a2 2 0 0 0-2 2v6.5a2 2 0 0 0 .6 1.4l6.5 6.5a2 2 0 0 0 2.8 0l6.5-6.5a2 2 0 0 0 0-2.8L13.9 4.6a2 2 0 0 0-1.4-.6z"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>'),
  member:uiSvg('<circle cx="12" cy="8.2" r="3.4"/><path d="M5.2 19.6a6.8 6.8 0 0 1 13.6 0"/>'),
  group:uiSvg('<circle cx="9.2" cy="8.8" r="2.9"/><path d="M3.8 19a5.4 5.4 0 0 1 10.8 0"/><circle cx="16.4" cy="9.6" r="2.2"/><path d="M16.4 13.8a4 4 0 0 1 4 4.2"/>'),
  org:uiSvg('<rect x="4" y="5" width="16" height="15" rx="2.8"/><path d="M8.5 10h2M13.5 10h2M8.5 14h2M13.5 14h2M10.5 20v-2.6a1.5 1.5 0 0 1 3 0V20"/>'),
  budget:uiSvg('<rect x="3.5" y="6" width="17" height="12.5" rx="2.8"/><path d="M15.5 12.2h5M3.5 9.5h17"/>'),
  exp:uiSvg('<path d="M12 14.5V4.5m0 0l-3.8 3.8M12 4.5l3.8 3.8M4.5 14.8v2.7A2 2 0 0 0 6.5 19.5h11a2 2 0 0 0 2-2v-2.7"/>'),
  imp:uiSvg('<path d="M12 4.5v10m0 0l-3.8-3.8M12 14.5l3.8-3.8M4.5 14.8v2.7A2 2 0 0 0 6.5 19.5h11a2 2 0 0 0 2-2v-2.7"/>'),
  undo:uiSvg('<path d="M4.5 11.5A7.5 7.5 0 1 1 6.7 16.8"/><path d="M4.5 6.8v4.7h4.7"/>'),
 };
 const shortcut=(id,key,label)=>'<button id="'+id+'" class="outline"><span class="shortcut-ico" aria-hidden="true">'+ico[key]+'</span><span>'+label+'</span></button>';
 return '<div class="intro"><h1>设置</h1></div><div class="settings-shortcuts">'+shortcut('backup-preferences','pref','显示设置')+shortcut('backup-pricing','price','价格与特典')+shortcut('backup-members','member','管理成员')+shortcut('backup-groups','group','管理团体')+shortcut('backup-organizers','org','管理事务所')+shortcut('backup-budget','budget','预算管理')+'</div><p class="subtle" id="last-backup-time">'+esc(backupTimeLabel())+'</p><div class="card"><div class="hero-grid backup-counts"><div><strong>'+state.records.length+'</strong><small>条活动</small></div><div><strong>'+C.stats(state.records).interactionCount+'</strong><small>条明细</small></div></div><p class="subtle">本机离线保存 · 每次保存自动保留前一个版本。</p></div><div class="stack" style="margin-top:16px"><button id="export-full" class="backup-action"><span class="symbol" aria-hidden="true">'+ico.exp+'</span><span><strong>导出完整备份</strong><small>保存 ZIP 备份，包含活动、照片、设置与头像，上限 10 GB</small></span></button><button id="import" class="backup-action"><span class="symbol" aria-hidden="true">'+ico.imp+'</span><span><strong>导入备份</strong><small>仅支持导入 v1.2.0 及以上版本的手机完整备份（ZIP / JSON）</small></span></button><button id="restore-previous" class="backup-action"><span class="symbol" aria-hidden="true">'+ico.undo+'</span><span><strong>恢复上一次保存</strong><small>预览后恢复，误删或误改时使用</small></span></button></div><p class="subtle">偶像活动手账 '+esc(C.APP_VERSION)+' · 离线版 · 适用于 Android 8.0 及以上</p>';
}
function selectStatsSection(section){
 window.IdolPeople.setSection(section);period=section==='overview'?'month':'all';anchor=today();render();
}
function navigate(value,section){
 if(value==='stats'&&(tab!=='stats'||section)){const target=section||'members';window.IdolPeople.setSection(target);period=target==='overview'?'month':'all';anchor=today();}
 tab=value;render();window.scrollTo(0,0);
}
function render(){
 applyAppearance();
 if(storageError){renderStorageError();return;}
 $('.app-header').classList.toggle('hidden',tab!=='home');
 $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='home')$('#main').innerHTML=renderHome();
 else if(tab==='records')$('#main').innerHTML=renderRecords();
 else if(tab==='backup')$('#main').innerHTML=renderBackup();
 else if(tab==='photos'){$('#main').innerHTML=window.IdolPhotos.page(peopleContext());window.IdolPhotos.bindPage(peopleContext());}
 else{const ctx=peopleContext();$('#main').innerHTML=window.IdolPeople.navigation()+periodBar()+window.IdolPeople.render(ctx);window.IdolPeople.bind(ctx);}
 bindPeriod();bindEvents();
 allOn('[data-overview-detail]','click',element=>showOverviewDetail(element.dataset.overviewDetail,state.records.filter(event=>event.date.startsWith(today().slice(0,7))),today().slice(0,7)));
 on('#month-stats','click',()=>{period='month';anchor=today();navigate('stats','overview');});
 on('#all-records','click',()=>{period='all';query='';eventType='';venueFilter='';memberFilter='';organizerFilter='';navigate('records');});
 if(tab==='records'){
  recordResults();on('#search','input',()=>{query=read('search');limit=30;recordResults();});
  on('#event-type','change',()=>{eventType=read('event-type');limit=30;recordResults();});
  on('#record-venue','change',()=>{venueFilter=read('record-venue');limit=30;recordResults();});
  on('#record-member','change',()=>{memberFilter=read('record-member');limit=30;recordResults();});
  on('#record-organizer','change',()=>{organizerFilter=read('record-organizer');limit=30;recordResults();});
 }
 if(tab==='backup')bindBackup();
}

function statsContext(){return{C,state,records:inRange(state.records),range:range(),periodKind:period,anchor,esc,money:cash,onMember:showMember,onGroup:name=>window.IdolPeople.showGroup(peopleContext(),name,'activity'),onOrganizer:name=>window.IdolPeople.showOrganizer(peopleContext(),name),onLocation:(which,name,city)=>showFootprintDetail(which,name,city),onDetail:kind=>showOverviewDetail(kind,inRange(state.records),range().label),onFilter:type=>{eventType=type;query='';venueFilter='';memberFilter='';organizerFilter='';navigate('records');},onPeriod:(p,a)=>{period=p;anchor=a||anchor;render();},onCustom:(s,e)=>{customStart=s;customEnd=e;period='custom';render();},notify:notice};}
function peopleContext(){
 const ctx=statsContext();
 return Object.assign(ctx,{on,allOn,field,select,textArea,detailLine,modal,closeModal,askConfirm,read,empty,persist,historyPicker,bindHistory,rerender:render,onSection:selectStatsSection,onEvent:showEvent,uid,onQuick:quickMember,onEditEvent:editEvent,onEditItem:editItem,onFilterOrganizer:organizer=>{eventType='';query='';venueFilter='';memberFilter='';organizerFilter=organizer;period='all';limit=30;navigate('records');},onRenameOrganizer:(oldName,newName)=>{if(organizerFilter===oldName)organizerFilter=newName;},renderOverview:()=>window.IdolStats.render(ctx),bindOverview:()=>window.IdolStats.bind(ctx),renderFootprints:()=>window.IdolStats.renderFootprints(ctx),bindFootprints:()=>window.IdolStats.bind(ctx)});
}
function showEvent(id){
 const e=state.records.find(r=>r.id===id);if(!e)throw new Error('未找到活动');
 const onlineType=['online_cheki','theme_homework','merch_only'].includes(e.event_type);
 const orgList=C.eventOrganizers(e);
 const orgLine=orgList.length?'<div class="detail-line detail-line-chips"><span>主办事务所</span><div class="chips event-org-chips">'+orgList.map((org,idx)=>'<button type="button" class="organizer-chip" data-event-organizer="'+idx+'">'+window.IdolPeople.avatar(peopleContext(),C.organizerProfile(state,org),'sm')+'<span>'+esc(org)+'</span></button>').join('')+'</div></div>':'';
 const venueText=e.standalone_merch?'不绑定活动（仅买周边）':onlineType?(e.venue&&e.venue!=='-'?e.venue:'线上购买'):[e.city,e.venue].filter(Boolean).join(' · ');
 const showFees=!onlineType||C.cents(e.ticket_fee)>0||C.cents(e.drink_fee)>0||e.ticket_quantity>0;
 let html='<div class="card event-detail-card"><div class="row event-detail-head"><span class="tag">'+esc(E[e.event_type]||e.event_type)+'</span><strong>'+cash(C.eventTotal(e))+'</strong></div>'+
  detailLine('日期',e.date)+
  detailLine(onlineType?'购买渠道':'城市 / 场地',venueText)+
  orgLine+
  (e.event_type!=='merch_only'&&C.names(e.performing_groups).length?detailLine('参演团体',C.names(e.performing_groups).join(' / ')):'')+
  (showFees?detailLine('门票',cash(C.cents(e.ticket_fee))+(e.ticket_quantity?' · '+e.ticket_quantity+' 张 · '+(e.ticket_type||'未设票种')+(e.ticket_is_free?' · 免费':''):''))+(e.session?detailLine('场次',e.session):'')+detailLine('Drink代',cash(C.cents(e.drink_fee))):'')+
  (C.names(e.tags).length?detailLine('标签',C.names(e.tags).join(' / ')):'')+
  '</div>'+
  (e.note?'<div class="notice" style="margin-top:10px">'+esc(e.note)+'</div>':'')+
  window.IdolPhotos.gallery(peopleContext(),e.attachments,'event-photo')+
  '<div class="actions"><button id="edit-basics" class="outline">修改活动</button><button id="delete-event" class="danger">删除活动</button></div>'+
  '<div class="section-title row"><h3>消费明细 · '+e.interactions.length+' 条</h3><button id="add-item" class="primary compact">＋ 补记</button></div>'+
  e.interactions.map((it,i)=>{
   const faces=itemAvatars(it),k=C.kind(it),heading=faces?'<div class="item-member">'+faces+'<strong>'+esc(C.itemName(it))+'</strong></div>':'<strong>'+esc(C.itemName(it))+'</strong>';
   const kindText=k==='merch'?'周边':(C.isGroupItem(it)?(k==='phone'?'团体 · ':'团体特典 · '):k==='multi'?'多人特典 · ':'单人 · ')+C.benefitLabel(it,state,e),unitText=k==='merch'?' 件':' 张';
   const merchTargets=k==='merch'?[C.names(it.merch_members).length?'成员 '+C.names(it.merch_members).join(' / '):'',C.names(it.affiliated_groups||it.affiliated_group).length?'团体 '+C.names(it.affiliated_groups||it.affiliated_group).join(' / '):'',C.names(it.merch_organizers).length?'事务所 '+C.names(it.merch_organizers).join(' / '):''].filter(Boolean).join(' · '):'';
   return '<div class="item-card"><div class="row">'+heading+'<strong class="nowrap">'+cash(C.itemTotal(it))+'</strong></div><div class="item-note">'+esc(kindText)+' · '+C.count(it)+unitText+(identityDescription(it,e)?' · '+esc(identityDescription(it,e)):merchTargets?' · '+esc(merchTargets):'')+'</div>'+(k!=='merch'&&it.shot_at?'<div class="item-note">拍摄 '+esc(it.shot_at.slice(0,10))+'</div>':'')+(it.note?'<div class="item-note">'+esc(it.note)+'</div>':'')+(it.order_number?'<div class="item-note">订单 / 运单 '+esc(it.order_number)+'</div>':'')+window.IdolPhotos.gallery(peopleContext(),it.attachments,'item-photo-'+i)+'<div class="buttons"><button data-edit-item="'+i+'">修改明细</button><button class="danger" data-delete-item="'+i+'">删除</button></div></div>';
  }).join('')+(e.interactions.length?'':empty('可以只看演出，也可以稍后补记特典和周边。'));
 modal(e.event_name||'活动详情',html);
 allOn('[data-event-organizer]','click',btn=>{const org=orgList[Number(btn.dataset.eventOrganizer)];if(org)window.IdolPeople.showOrganizer(peopleContext(),org);});
 window.IdolPhotos.bindGallery(peopleContext(),e.attachments||[],'event-photo',()=>showEvent(id));
 e.interactions.forEach((item,index)=>window.IdolPhotos.bindGallery(peopleContext(),item.attachments||[],'item-photo-'+index,()=>showEvent(id)));
 on('#edit-basics','click',()=>editEvent(id));
 on('#add-item','click',()=>editItem(id));
 on('#delete-event','click',()=>{askConfirm({title:'删除活动',message:'删除这场活动及其全部消费明细？可在设置页恢复上一次保存。',okText:'确认删除',danger:true},()=>{const next=C.clone(state);next.records=next.records.filter(r=>r.id!==id);persist(next);closeModal(true);render();notice('活动已删除');});});
 allOn('[data-edit-item]','click',el=>editItem(id,Number(el.dataset.editItem)));
 allOn('[data-delete-item]','click',el=>{askConfirm({title:'删除消费明细',message:'确认删除这条消费明细？',okText:'确认删除',danger:true},()=>{const n=C.clone(e);n.interactions.splice(Number(el.dataset.deleteItem),1);commitEvent(n);showEvent(id);});});
}
// History choices stay in the document flow; input fields never open WebView datalist popups.
function historyPicker(id,summaryText){return '<details class="history-picker" id="'+id+'-picker"><summary id="'+id+'-summary">'+(summaryText||'从历史记录选择')+'</summary><input id="'+id+'-search" type="text" autocomplete="off" placeholder="搜索历史名称或拼音" aria-label="搜索历史名称"><div class="history-options" id="'+id+'"></div></details>';}
function bindHistory(id,inputId,values,onChoose){
 const panel=$('#'+id+'-picker'),search=$('#'+id+'-search'),input=$('#'+inputId);
 function refresh(){const entries=values().map(item=>typeof item==='string'?{value:item,label:item,search:item}:item),matches=entries.filter(item=>C.search({name:item.search||item.label||item.value},search.value,window.IdolPinyin)),visible=matches.slice(0,80);$('#'+id).innerHTML=visible.map((item,index)=>'<button type="button" data-history-index="'+index+'">'+esc(item.label)+'</button>').join('')+(matches.length>80?'<p class="subtle">显示前 80 项，请搜索缩小范围。</p>':'')+(matches.length?'':'<p class="subtle">暂无匹配的历史名称，可直接在上方填写。</p>');allOn('#'+id+' [data-history-index]','click',el=>{const chosen=visible[Number(el.dataset.historyIndex)],previous=input.value;input.value=chosen.value;panel.open=false;search.value='';if(onChoose)onChoose(input.value,previous,chosen);input.focus();});}
 let composing=false;
 on('#'+id+'-search','compositionstart',()=>{composing=true;});
 on('#'+id+'-search','compositionend',()=>{composing=false;refresh();});
 on('#'+id+'-search','input',()=>{if(!composing)refresh();});
 panel.addEventListener('toggle',guard(()=>{if(panel.open)refresh();}));
 on('#'+inputId,'focus',()=>{panel.open=false;});
 refresh();return refresh;
}
function identityDescription(item,event){
 return C.participantIds(item).map(id=>C.resolveMember(state,id).name+'（'+(C.identityGroups(item,state,event,id).join(' / ')||'身份未指定')+'）').join('、');
}
function identityEditor(host,event,item){
 const values=new Map();let members=[];
 function collect(){return members.map((profile,index)=>{
  const group=read(host+'-role-'+index),activity=(event.member_roles||[]).find(role=>role.member_id===profile.id);
  return {member:profile.name,member_id:profile.id,group,...(host==='item-identities'&&activity&&activity.group!==group?{override:true}:{})};
 });}
 function refresh(nextMembers){
  for(const role of collect())values.set(role.member_id,role.group);
  members=C.names(nextMembers).map(member=>C.resolveMember(state,member));
  $('#'+host).innerHTML=members.length?'<h3>'+(host==='item-identities'?'本条互动成员身份':'本场默认成员身份')+'</h3><p class="subtle">候选来自该成员资料和实际互动过的团体。本条互动可单独调整身份。</p>'+members.map((profile,index)=>{
   const id=profile.id,value=values.has(id)?values.get(id):C.preferredIdentity(item,state,event,id);
   return select(profile.name+' · 代表团体',host+'-role-'+index,Object.fromEntries([['','未指定'],...C.memberGroups(state,id).map(group=>[group,group])]),value);
  }).join(''):'';
 }
 return {refresh,collect};
}
function applyRoles(event,roles,propagate){
 const merged=new Map((event.member_roles||[]).map(role=>[role.member_id,role]));
 for(const role of roles)if(propagate||!merged.has(role.member_id))merged.set(role.member_id,role);
 event.member_roles=Array.from(merged.values());
 if(propagate)for(const item of event.interactions){
  const defaults=new Map((item.participant_groups||[]).map(role=>[role.member_id,role]));
  for(const role of roles)if(C.participantIds(item).includes(role.member_id)&&!(defaults.get(role.member_id)||{}).override)defaults.set(role.member_id,C.clone(role));
  item.participant_groups=Array.from(defaults.values());
 }
}
function quickMember(id){
 const member=C.resolveMember(state,id),recent=state.records[0];
 modal('给 '+member.name+' 补记',select('归入活动','quick-event',Object.fromEntries(state.records.map(event=>[event.id,event.date+' · '+event.event_name])),recent&&recent.id)+'<div id="form-error" class="error"></div><div class="actions"><button id="quick-open" class="primary">继续补记</button><button id="quick-new-event" class="outline">新建活动</button></div>');
 on('#quick-open','click',()=>{const eventId=read('quick-event');if(!eventId)throw new Error('请先创建活动');editItem(eventId,null,id);});
 on('#quick-new-event','click',()=>editEvent(null,id));
}
function applyAppearance(){
 const root=document.documentElement;if(!root)return;
 root.dataset.theme=state&&state.config.theme||'system';root.style.setProperty('--font-scale',String(state&&state.config.font_scale||1));
}
function editEvent(id,quickMemberId){
 const old=id?state.records.find(event=>event.id===id):null;
 const event=old?C.clone(old):{id:uid(),date:today(),event_type:'performance',event_name:'',city:'',venue:'',ticket_fee:0,drink_fee:0,interactions:[],created_at:new Date().toISOString()};
 modal(old?'修改活动':'记一场新的活动',
  '<div class="form-grid">'+field('日期','e-date',event.date,'date')+select('活动类型','e-type',E_CREATE,event.event_type)+'</div>'+
  '<div id="event-name-wrap">'+field('活动名称','e-name',event.event_name,'text','maxlength="300" autocomplete="off"')+'</div>'+
  '<p id="online-type-notice" class="notice hidden">线上进行（购买渠道默认线上购买），无需填写城市、场地、门票及 Drink 代。</p>'+
  '<div id="event-location-fields" class="form-grid"><div>'+field('城市','e-city',event.city,'text','autocomplete="off"')+historyPicker('cities')+'</div><div>'+field('场地 / 购买渠道','e-venue',event.venue,'text','autocomplete="off"')+historyPicker('venues')+'</div></div>'+
  '<div id="event-fee-fields"><div class="form-grid">'+field('门票（元）','e-ticket',C.money(C.cents(event.ticket_fee)),'text','inputmode="decimal"')+field('Drink代（元）','e-drink',C.money(C.cents(event.drink_fee)),'text','inputmode="decimal"')+'</div>'+
  '<details><summary>门票票种与场次</summary><div class="form-grid">'+field('门票张数','e-ticket-quantity',event.ticket_quantity==null?(C.cents(event.ticket_fee)>0?1:0):event.ticket_quantity,'number','min="0" max="1000000" inputmode="numeric"')+select('门票状态','e-ticket-status',{none:'未记录门票',paid:'付费',free:'免费'},(event.ticket_quantity||C.cents(event.ticket_fee))?(event.ticket_is_free||!C.cents(event.ticket_fee)?'free':'paid'):'none')+'</div>'+field('票种','e-ticket-type',event.ticket_type||'','text','maxlength="100" placeholder="预售 / 现场 / 学生 / 女性 / VIP"')+historyPicker('ticket-types')+field('场次','e-session',event.session||'','text','maxlength="100" placeholder="第一部 / 第二部 / 昼 / 夜"')+'<p class="subtle">上方门票金额填写本场门票实付金额，免费场也可记录张数。</p></details></div>'+
  '<div id="organizer-field">'+field('主办事务所，联合主办用逗号分隔','e-organizer',C.eventOrganizers(event).join('，'),'text','maxlength="2000" autocomplete="off"')+historyPicker('organizers')+'</div>'+
  '<div id="event-performing-field">'+field('参演团体，多个用逗号分隔','e-performing',C.names(event.performing_groups).join('，'),'text','autocomplete="off"')+historyPicker('performers')+'<div id="event-identities"></div></div>'+
  field('标签（逗号分隔）','e-tags',Array.isArray(event.tags)?event.tags.join('，'):event.tags||'')+textArea('活动备注','e-note',event.note||'')+
  '<div id="event-photos"></div>'+
  '<p id="event-type-hint" class="subtle"></p><div id="form-error" class="error"></div><button id="save-event" class="primary" style="width:100%">保存活动'+(old?'':'，继续补记')+'</button>',true);
 const photos=window.IdolPhotos.editor(peopleContext(),'event-photos',event.attachments);
 bindHistory('ticket-types','e-ticket-type',()=>C.names(state.records.map(event=>event.ticket_type)));
 on('#e-ticket','input',()=>{try{if(C.cents(read('e-ticket'))>0){$('#e-ticket-status').value='paid';if(Number(read('e-ticket-quantity'))===0)$('#e-ticket-quantity').value=1;}}catch(_){}});
 on('#e-ticket-status','change',()=>{const status=read('e-ticket-status');if(status==='none'){$('#e-ticket-quantity').value=0;$('#e-ticket').value='0.00';}else{if(Number(read('e-ticket-quantity'))===0)$('#e-ticket-quantity').value=1;if(status==='free')$('#e-ticket').value='0.00';}});
 const appendNames=(selected,previous)=>C.names([].concat(C.names(previous),[selected])).join('，');
 bindHistory('performers','e-performing',()=>C.groupCatalog(state),(selected,previous)=>{$('#e-performing').value=appendNames(selected,previous);});
 bindHistory('organizers','e-organizer',()=>C.organizerCatalog(state),(selected,previous)=>{$('#e-organizer').value=appendNames(selected,previous);});
 const identities=identityEditor('event-identities',event,{});
 identities.refresh(event.interactions.flatMap(C.participantIds));
 const refreshVenues=bindHistory('venues','e-venue',()=>C.frequent(state.records,'venue',{city:read('e-city'),eventType:read('e-type'),limit:Number.MAX_SAFE_INTEGER}));
 bindHistory('cities','e-city',()=>C.frequent(state.records,'city',{limit:Number.MAX_SAFE_INTEGER}),refreshVenues);
 function suggestions(){
  const type=read('e-type');
  const online=['online_cheki','theme_homework','merch_only'].includes(type);
  const merch=type==='merch_only';
  $('#event-location-fields').classList.toggle('hidden',online);
  $('#event-fee-fields').classList.toggle('hidden',online);
  $('#organizer-field').classList.toggle('hidden',type!=='performance');
  $('#event-performing-field').classList.toggle('hidden',merch);
  $('#online-type-notice').classList.toggle('hidden',!online);
  const nameLabel=$('#event-name-wrap .field>span');if(nameLabel)nameLabel.textContent=merch?'购买名称 / 订单说明':'活动名称';
  const saveBtn=$('#save-event');if(saveBtn)saveBtn.textContent=old?'保存修改':(merch?'保存并添加周边':'保存活动，继续补记');
  $('#event-type-hint').textContent=merch?'周边通常线上购买（无城市、场地、门票及参演团体），保存后可直接一次录入多种周边并关联成员、团体或事务所。':online?'该类型为线上购买，无需填写城市、场地、门票与 Drink 代。':'保存活动后可继续补记拍切、宿题/主题或周边。';
  if(!online)refreshVenues();
 }
 on('#e-city','input',suggestions);
 on('#e-type','change',suggestions);
 suggestions();
 on('#save-event','click',()=>{
  event.date=C.validDate(read('e-date'));event.event_type=read('e-type');event.event_name=read('e-name');
  if(!event.event_name)throw new Error(event.event_type==='merch_only'?'请填写周边购买名称':'请填写活动名称');
  const online=['online_cheki','theme_homework','merch_only'].includes(event.event_type);
  if(event.event_type==='performance'){event.organizers=C.names(read('e-organizer'));event.organizer=event.organizers.join('，');}
  else{delete event.organizers;delete event.organizer;}
  applyRoles(event,identities.collect(),true);
  event.performing_groups=event.event_type==='merch_only'?[]:C.names(read('e-performing'));
  if(online){
   event.city='-';event.venue='线上购买';event.ticket_fee=0;event.drink_fee=0;event.ticket_quantity=0;event.ticket_type='';event.session='';event.ticket_is_free=true;
  }else{
   event.city=read('e-city')||'-';event.venue=read('e-venue')||'-';
   event.ticket_fee=C.amount(C.cents(read('e-ticket')));event.drink_fee=C.amount(C.cents(read('e-drink')));
   event.ticket_quantity=Number(read('e-ticket-quantity'));if(event.ticket_fee>0&&event.ticket_quantity===0)event.ticket_quantity=1;
   event.ticket_type=read('e-ticket-type');event.session=read('e-session');event.ticket_is_free=read('e-ticket-status')==='free';
  }
  event.tags=C.names(read('e-tags'));event.note=read('e-note');event.attachments=photos.get();
  commitEvent(event,!old);notice(event.event_type==='merch_only'?'周边订单已保存':'活动已保存');
  if(!old&&event.event_type==='merch_only')editItem(event.id,null,quickMemberId,'merch');
  else if(quickMemberId)editItem(event.id,null,quickMemberId);
  else showEvent(event.id);
 });
}
function editItem(eventId,index,selectedMember,overrideKind){
 const merchMode=overrideKind==='merch',phoneMode=overrideKind==='phone';
 const original=eventId?state.records.find(event=>event.id===eventId):(merchMode?{id:uid(),date:today(),event_name:'仅买周边',event_type:'merch_only',standalone_merch:true,city:'-',venue:'线上购买',ticket_fee:0,drink_fee:0,interactions:[]}:{id:uid(),date:today(),event_name:'独立手机合影',event_type:'phone_photo',standalone_phone:true,city:'-',venue:'-',ticket_fee:0,drink_fee:0,interactions:[]});
 if(!original)throw new Error('活动不存在');
 const old=index==null?null:original.interactions[index];
 const item=old?C.clone(old):{id:uid(),type:'cheki',cheki_type:'individual',benefit_format:original.event_type==='theme_homework'?'homework':original.event_type==='online_cheki'?'online':'cheki',tickets:1,note:'',created_at:new Date().toISOString()};
 if(phoneMode&&!old){item.type='phone';item.cheki_type='individual';item.price_per_ticket=0;item.total_cost=0;}
 if((merchMode||(!phoneMode&&original.event_type==='merch_only'))&&!old){item.type='merch';item.quantity=1;}
 if(selectedMember&&!old){const profile=C.resolveMember(state,selectedMember);item.member=profile.name;item.member_id=profile.id;if(item.type==='merch'){item.merch_members=[profile.name];item.merch_member_ids=[profile.id];}}
 const initialKind=C.kind(item),initialPrice=initialKind==='merch'?item.price:item.price_per_ticket;
 let phoneTarget=old&&C.isGroupItem(item)?'group':'member',phoneTargetManual=false;
 const initialName=initialKind==='multi'?C.participantIds(item).map(id=>C.memberLabel(C.resolveMember(state,id),state)).join('，'):(initialKind==='individual'||(initialKind==='phone'&&phoneTarget==='member'))&&item.member?C.memberLabel(C.resolveMember(state,item.member_id||item.member),state):C.itemName(item)==='未命名'?'':C.itemName(item);
 const eventOptions=Object.fromEntries([['','不绑定具体活动'],...state.records.filter(ev=>!ev.standalone_phone&&!ev.standalone_merch).map(ev=>[ev.id,ev.date+' · '+ev.event_name])]);
 modal(phoneMode?(old?'修改手机合影':'补记手机合影'):(merchMode&&!eventId)?'补记周边购买':(old?'修改消费明细':'补记消费明细'),
  ((!eventId)?'':'<div class="notice">'+esc(original.date+' · '+original.event_name)+'</div>')+
  (phoneMode?'<input id="i-kind" type="hidden" value="phone">':select('消费类别','i-kind',{individual:'单人特典',multi:'多人特典',group:'团体特典',merch:'周边商品',phone:'手机合影'},initialKind))+
  '<label class="field"><span id="i-name-label">'+(initialKind==='phone'?'成员 / 团体':initialKind==='merch'?'周边商品名称':'成员 / 团体名称')+'</span><input id="i-name" type="text" value="'+esc(initialName)+'" autocomplete="off" maxlength="1000"></label>'+
  '<div id="phone-target-row" class="chips"><button type="button" data-phone-target="member">按成员</button><button type="button" data-phone-target="group">按团体</button></div>'+
  '<p id="multi-hint" class="subtle">多人特典请填写所有成员，使用逗号分隔，至少两位。实付单价填写单张特典的实付金额。</p>'+historyPicker('names',initialKind==='phone'?'选择成员或团体':'从历史记录选择')+
  '<div id="phone-event-link">'+field('合影日期','i-phone-date',original.date,'date')+select('绑定活动（选填）','i-phone-event',eventOptions,original.standalone_phone?'':original.id)+'</div>'+
  '<div id="merch-event-link" class="hidden">'+field('购买日期','merch-date',original.date,'date')+select('绑定活动（选填）','merch-event',Object.assign({'':'不绑定具体活动（仅买周边）'},Object.fromEntries(Object.entries(eventOptions).slice(1))),original.standalone_merch?'':original.id)+'</div>'+
  '<div id="form-field">'+select('特典形式','i-form',C.benefitTypes(state),C.form(item,original.event_type,original))+'</div>'+
  '<div id="benefit-attributes" class="form-grid">'+select('尺寸','i-size',{'':'未指定',3:'3寸',5:'5寸',other:'其它尺寸'},item.photo_size||'')+select('签名','i-signature',{'':'未指定',signed:'有签',unsigned:'无签'},item.signature||(item.benefit_format==='signed'?'signed':item.benefit_format==='unsigned'?'unsigned':''))+'</div>'+
  '<div id="item-identities"></div>'+
  '<div id="merch-targets" class="hidden">'+field('关联成员，多个用逗号分隔（选填）','merch-members',(item.merch_member_ids?item.merch_member_ids.map(id=>C.memberLabel(C.resolveMember(state,id),state)):C.names(item.merch_members)).join('，'),'text','autocomplete="off"')+historyPicker('merch-member-history','从历史成员选择')+'</div>'+
  '<div id="item-group-field"><label class="field"><span id="item-group-label">所属团体，多个用逗号分隔（选填）</span><input id="i-group" type="text" value="'+esc(C.names(item.affiliated_groups||item.affiliated_group).join('，'))+'" autocomplete="off"></label>'+historyPicker('item-groups')+'</div>'+
  '<div id="merch-org-field" class="hidden">'+field('关联事务所，多个用逗号分隔（选填）','merch-organizers',C.names(item.merch_organizers).join('，'),'text','autocomplete="off"')+historyPicker('merch-org-history','从历史事务所选择')+'</div>'+
  '<div id="i-shot-field">'+field('拍摄日期（选填，未填采用活动日期）','i-shot',(item.shot_at||'').slice(0,10),'date')+'</div>'+
  '<div class="form-grid">'+field('实付单价（元）','i-price',initialPrice==null?'':C.money(C.cents(initialPrice)),'text','inputmode="decimal"')+field('数量（张 / 件）','i-qty',C.count(item),'text','inputmode="numeric"')+'</div><div id="price-options" class="chips"></div>'+
  (!old?'<div id="merch-extra-panel" class="hidden"><div id="merch-extra-rows"></div><button type="button" id="add-merch-line" class="outline compact" style="margin:6px 0 12px">＋ 再加一种周边商品</button></div>':'')+
  textArea('备注','i-note',item.note||'')+field('订单号（选填）','i-order',item.order_number||'')+
  '<div id="item-photos"></div><div id="form-error" class="error"></div><div class="actions"><button id="back-event" class="outline">'+(eventId?'返回活动':'取消')+'</button><button id="save-item" class="primary">保存明细</button></div>',true);
 const photos=window.IdolPhotos.editor(peopleContext(),'item-photos',item.attachments,{allowVideo:initialKind==='phone'});
 let pricingChanged=false,pickedKind='',extraMerch=[];
 const identities=identityEditor('item-identities',original,item);
 const appendChoice=(id,selected,previous)=>{$('#'+id).value=C.names([].concat(C.names(previous),[selected])).join('，');};
 bindHistory('item-groups','i-group',()=>C.groupCatalog(state),(selected,previous)=>appendChoice('i-group',selected,previous));
 bindHistory('merch-member-history','merch-members',()=>C.memberCatalog(state).filter(p=>!p.archived).map(p=>C.memberLabel(p,state)),(selected,previous)=>appendChoice('merch-members',selected,previous));
 bindHistory('merch-org-history','merch-organizers',()=>C.organizerCatalog(state),(selected,previous)=>appendChoice('merch-organizers',selected,previous));
 function renderExtraMerch(){
  const host=$('#merch-extra-rows');if(!host)return;
  host.innerHTML=extraMerch.map((row,idx)=>'<div class="merch-sub-card" data-merch-row="'+idx+'"><div class="row"><strong>第 '+(idx+2)+' 件周边</strong><button type="button" class="text danger" data-merch-del="'+idx+'">移除</button></div>'+field('商品名称','merch-sub-name-'+idx,row.name,'text','maxlength="300" autocomplete="off"')+'<div class="form-grid">'+field('实付单价（元）','merch-sub-price-'+idx,row.price,'text','inputmode="decimal"')+field('数量（件）','merch-sub-qty-'+idx,row.qty,'text','inputmode="numeric"')+'</div></div>').join('');
  allOn('[data-merch-del]','click',btn=>{syncExtraMerch();extraMerch.splice(Number(btn.dataset.merchDel),1);renderExtraMerch();});
 }
 function syncExtraMerch(){
  extraMerch=extraMerch.map((_,idx)=>({name:$('#merch-sub-name-'+idx)?$('#merch-sub-name-'+idx).value:'',price:$('#merch-sub-price-'+idx)?$('#merch-sub-price-'+idx).value:'',qty:$('#merch-sub-qty-'+idx)?$('#merch-sub-qty-'+idx).value:'1'}));
 }
 if(!old){on('#add-merch-line','click',()=>{syncExtraMerch();if(extraMerch.length>=30)throw new Error('单次最多同时添加 31 件周边');extraMerch.push({name:'',price:'',qty:'1'});renderExtraMerch();});}
 const refreshNames=bindHistory('names','i-name',()=>{
  const kind=read('i-kind');
  if(kind==='phone'){
   if(phoneTarget==='group')return C.groupCatalog(state).map(group=>({value:group,label:'团体 · '+group,search:group,kind:'group'}));
   return C.memberCatalog(state).filter(profile=>!profile.archived).map(profile=>({value:C.memberLabel(profile,state),label:'成员 · '+C.memberLabel(profile,state),search:[profile.name,...(profile.aliases||[]),...(profile.groups||[])].join(' '),kind:'member'}));
  }
  if(kind==='individual'||kind==='multi')return C.memberCatalog(state).filter(profile=>!profile.archived).map(profile=>C.memberLabel(profile,state));
  return kind==='merch'?C.frequent(state.records,'item_name',{eventType:original.event_type,limit:Number.MAX_SAFE_INTEGER}):C.groupCatalog(state);
 },(selected,previous,chosen)=>{
  if(read('i-kind')==='multi')$('#i-name').value=C.names([].concat(C.names(previous),[selected])).join('，');
  if(read('i-kind')==='phone'&&chosen&&chosen.kind){phoneTarget=chosen.kind;phoneTargetManual=true;pickedKind=chosen.kind;}
  contextChanged();
 });
 function syncPhoneTarget(){
  if(read('i-kind')!=='phone')return;
  const typed=read('i-name');
  if(!phoneTargetManual&&typed){
   const inGroup=C.groupCatalog(state).includes(typed);
   const inMember=C.memberCatalog(state).some(profile=>profile.name===typed||C.memberLabel(profile,state)===typed||(profile.aliases||[]).includes(typed));
   if(inGroup&&!inMember)phoneTarget='group';else if(inMember)phoneTarget='member';
  }
  $$('[data-phone-target]').forEach(btn=>btn.classList.toggle('active',btn.dataset.phoneTarget===phoneTarget));
 }
 function markPricing(){pricingChanged=true;}
 function recommendations(){
  const kind=read('i-kind');
  if(photos&&photos.setAllowVideo)photos.setAllowVideo(kind==='phone');
  syncPhoneTarget();
  $('#i-name-label').textContent=kind==='phone'?'成员 / 团体':kind==='merch'?'周边商品名称':'成员 / 团体名称';
  $('#i-name').placeholder=kind==='phone'?(phoneTarget==='group'?'输入或选择团体名称':'输入或选择成员姓名'):kind==='merch'?'输入商品名称，如 立牌 / 生写':'';
  $('#names-summary').textContent=kind==='phone'?(phoneTarget==='group'?'选择团体':'选择成员'):'从历史记录选择';
  $('#phone-target-row').classList.toggle('hidden',kind!=='phone');
  $('#form-field').classList.toggle('hidden',(kind==='merch'||kind==='phone'));
  $('#phone-event-link').classList.toggle('hidden',kind!=='phone');
  $('#merch-event-link').classList.toggle('hidden',kind!=='merch');
  $('#merch-targets').classList.toggle('hidden',kind!=='merch');
  $('#merch-org-field').classList.toggle('hidden',kind!=='merch');
  if($('#merch-extra-panel'))$('#merch-extra-panel').classList.toggle('hidden',kind!=='merch');
  $('#benefit-attributes').classList.toggle('hidden',kind==='merch'||kind==='phone');
  $('#item-group-field').classList.toggle('hidden',kind==='individual'||kind==='multi'||kind==='phone');
  if($('#item-group-label'))$('#item-group-label').textContent=kind==='merch'?'关联团体，多个用逗号分隔（选填）':'所属团体，多个用逗号分隔（选填）';
  $('#i-shot-field').classList.toggle('hidden',kind==='phone'||kind==='merch');
  let options=[];
  try{
   identities.refresh((kind==='individual'||(kind==='phone'&&phoneTarget==='member'))?[read('i-name')].filter(Boolean):kind==='multi'?C.names(read('i-name')):[]);
   const historyTarget=kind==='individual'&&read('i-name')?C.resolveMember(state,read('i-name')).id:kind==='multi'?C.names(read('i-name')).map(name=>C.resolveMember(state,name).id).join('，'):read('i-name');
   options=C.prices(state.records,historyTarget,kind,read('i-form'),original.event_type,5,kind==='merch'?null:{size:read('i-size'),signature:read('i-signature'),themed:read('i-form')==='theme'});
   if(kind==='individual'&&(!old||pricingChanged)){
    const person=kind==='individual'&&read('i-name')?C.resolveMember(state,read('i-name')):null,roles=identities.collect();
    const preset=C.presetPrice(state,{member:person&&person.id,group:roles[0]&&roles[0].group||read('i-group'),format:read('i-form'),size:read('i-size'),signature:read('i-signature'),themed:read('i-form')==='theme'});
    if(preset&&read('i-price')===''){$('#i-price').value=C.money(C.cents(preset.price));markPricing();}
   }
  }catch(_){identities.refresh([]);}
  $('#multi-hint').classList.toggle('hidden',kind!=='multi');
  refreshNames();
  $('#price-options').innerHTML=options.length?'<small style="width:100%">同对象、同形式的历史单价</small>'+options.map(price=>'<button data-price="'+price+'">'+cash(C.cents(price))+'</button>').join(''):(kind==='phone'?'':'<small>没有匹配的历史单价，请按实际填写。</small>');
  allOn('[data-price]','click',element=>{$('#i-price').value=element.dataset.price;markPricing();});
 }
 function contextChanged(){pricingChanged=true;$('#i-price').value='';recommendations();if(read('i-kind')==='phone'){$('#i-price').value='0.00';markPricing();}}
 allOn('[data-phone-target]','click',btn=>{const nextTarget=btn.dataset.phoneTarget;if(pickedKind&&pickedKind!==nextTarget){$('#i-name').value='';pickedKind='';}phoneTarget=nextTarget;phoneTargetManual=true;if($('#names-search'))$('#names-search').value='';recommendations();});
 on('#i-kind','change',contextChanged);
 on('#i-name','input',event=>{if(!event.isComposing){pickedKind='';phoneTargetManual=false;contextChanged();}});
 on('#i-name','compositionend',()=>{pickedKind='';phoneTargetManual=false;contextChanged();});
 on('#i-form','change',()=>{const format=read('i-form');if(format==='signed'||format==='unsigned')$('#i-signature').value=format;contextChanged();});
 for(const id of ['i-size','i-signature'])on('#'+id,'change',contextChanged);
 on('#item-identities','change',()=>{if(!old)contextChanged();});
 on('#i-price','input',markPricing);on('#i-price','change',markPricing);on('#i-qty','input',markPricing);on('#i-qty','change',markPricing);recommendations();
 on('#back-event','click',()=>{if(!eventId)closeModal(false);else askConfirm({title:'放弃本条修改？',message:'放弃本条尚未保存的修改，返回活动详情？',okText:'放弃并返回',cancelText:'继续编辑',danger:true},()=>showEvent(eventId));});
 function saveItem(){
  const before=C.clone(state);
  const kind=read('i-kind'),target=read('i-name');
  if(!target)throw new Error(kind==='phone'?'请填写成员或团体':kind==='merch'?'请填写周边商品名称':'请填写成员或团体名称');
  const count=C.quantity(read('i-qty'));
  const keepOldPrice=!pricingChanged&&old&&(initialPrice==null&&read('i-price')===''||initialPrice!=null&&read('i-price')===C.money(C.cents(initialPrice)));
  const unit=read('i-price')===''&&old&&initialPrice==null&&!pricingChanged?null:C.amount(C.cents(read('i-price')));
  const total=keepOldPrice?C.amount(C.itemTotal(old)):C.amount(C.cents(read('i-price'))*count);
  let extraMerchItems=[];
  if(kind==='merch'){
   syncExtraMerch();
   item.type='merch';item.item_name=target;item.quantity=count;
   if(unit!=null)item.price=unit;
   const mProfiles=C.names(read('merch-members')).map(n=>C.resolveMember(state,n));
   const mGroups=C.names(read('i-group'));
   const mOrgs=C.names(read('merch-organizers'));
   if(mProfiles.length){item.merch_members=mProfiles.map(p=>p.name);item.merch_member_ids=mProfiles.map(p=>p.id);}else{delete item.merch_members;delete item.merch_member_ids;}
   if(mOrgs.length)item.merch_organizers=mOrgs;else delete item.merch_organizers;
   for(const key of ['cheki_type','member','member_id','members','member_ids','group_name','tickets','price_per_ticket','benefit_format','benefit_label','shot_at','photo_size','signature','is_theme'])delete item[key];
   for(let idx=0;idx<extraMerch.length;idx++){
    const sub=extraMerch[idx],subName=(sub.name||'').trim();
    if(!subName&&!(sub.price||'').trim())continue;
    if(!subName)throw new Error('请填写第 '+(idx+2)+' 件周边的商品名称');
    const subQty=C.quantity(sub.qty||'1'),subUnit=C.amount(C.cents(sub.price||'0'));
    const subObj={id:uid(),type:'merch',item_name:subName,quantity:subQty,price:subUnit,total_cost:C.amount(C.cents(sub.price||'0')*subQty),affiliated_groups:mGroups,affiliated_group:mGroups.join('，'),note:read('i-note'),order_number:read('i-order'),created_at:new Date().toISOString()};
    if(mProfiles.length){subObj.merch_members=[...item.merch_members];subObj.merch_member_ids=[...item.merch_member_ids];}
    if(mOrgs.length)subObj.merch_organizers=[...mOrgs];
    extraMerchItems.push(subObj);
   }
  }else{
   item.type=kind==='phone'?'phone':'cheki';item.cheki_type=kind==='phone'?(phoneTarget==='group'?'group':'individual'):kind;item.tickets=count;
   for(const key of ['item_name','price','quantity','member','member_id','members','member_ids','group_name','merch_members','merch_member_ids','merch_organizers'])delete item[key];
   if(kind==='multi'){const profiles=C.names(target).map(name=>C.resolveMember(state,name));item.members=profiles.map(profile=>profile.name);item.member_ids=profiles.map(profile=>profile.id);if(new Set(item.member_ids).size<2)throw new Error('多人特典至少填写两位不同成员');}
   else if(kind==='individual'||(kind==='phone'&&phoneTarget!=='group')){const profile=C.resolveMember(state,target);item.member=profile.name;item.member_id=profile.id;}
   else item.group_name=target;
   if(kind==='phone'){item.benefit_format='phone';item.benefit_label='手机合影';item.photo_size='';item.signature='';item.is_theme=false;}
   else{item.benefit_format=read('i-form');item.benefit_label=C.benefitTypes(state)[item.benefit_format]||item.benefit_label||'其它特典';item.photo_size=read('i-size');item.signature=read('i-signature');item.is_theme=item.benefit_format==='theme';}
   if(unit!=null)item.price_per_ticket=unit;
   if(kind!=='phone'&&read('i-shot'))item.shot_at=C.validDate(read('i-shot').slice(0,10));else delete item.shot_at;
  }
  item.total_cost=total;item.note=read('i-note');item.order_number=read('i-order');item.attachments=photos.get();
  const next=C.clone(original);
  if(kind==='individual'||kind==='multi'||(kind==='phone'&&phoneTarget!=='group')){
   item.participant_groups=identities.collect();
   applyRoles(next,item.participant_groups);
  }else{
   delete item.participant_groups;
   if(kind==='phone'){delete item.affiliated_groups;delete item.affiliated_group;}
   else{item.affiliated_groups=C.names(read('i-group'));item.affiliated_group=item.affiliated_groups.join('，');}
  }
  const allNewItems=[item,...extraMerchItems];
  if(kind!=='phone'&&allNewItems.some(entry=>(entry.attachments||[]).some(a=>a.media_type==='video'||/\.(?:mp4|webm|mov|mkv|3gp|m4v)(?:$|\?)/i.test(a.data)||/^data:video\//i.test(a.data))))throw new Error('仅手机合影支持保存视频，请先移除视频或将消费类别改为手机合影');
  if(index==null)next.interactions.push(...allNewItems);else next.interactions[index]=item;
  let destinationId=original.id;
  if(kind==='phone'||kind==='merch'){
   const isPhone=kind==='phone';
   const linked=isPhone?read('i-phone-event'):read('merch-event');
   const date=C.validDate(isPhone?read('i-phone-date'):read('merch-date'));
   const isSameStandalone=isPhone?(!linked&&original.standalone_phone):(!linked&&original.standalone_merch);
   const targetId=isSameStandalone?original.id:linked;
   if(isSameStandalone)next.date=date;
   if(isPhone)item.shot_at=date;
   if(targetId!==original.id){
    const updated=C.clone(state);const source=updated.records.find(ev=>ev.id===original.id);if(source&&index!=null)source.interactions.splice(index,1);
    let destination=linked?updated.records.find(ev=>ev.id===linked):null;
    if(linked&&!destination)throw new Error('所选活动已不存在');
    if(!destination){destination=isPhone?{id:uid(),date,event_name:'独立手机合影',event_type:'phone_photo',standalone_phone:true,city:'-',venue:'-',ticket_fee:0,drink_fee:0,interactions:[]}:{id:uid(),date,event_name:'仅买周边',event_type:'merch_only',standalone_merch:true,city:'-',venue:'线上购买',ticket_fee:0,drink_fee:0,interactions:[]};updated.records.push(destination);}
    destination.interactions.push(...allNewItems);destinationId=destination.id;
    updated.records=updated.records.filter(ev=>(!ev.standalone_phone&&!ev.standalone_merch)||ev.interactions.length>0||(ev.attachments||[]).length>0);
    persist(updated);render();
   }else commitEvent(next,!eventId);
  }else commitEvent(next,!eventId);
  const expected=JSON.stringify(state);
  showEvent(destinationId);
  $('#modal-body').insertAdjacentHTML('afterbegin','<button id="undo-last-item" class="text">撤销刚才的保存</button>');
  on('#undo-last-item','click',()=>{if(JSON.stringify(state)!==expected)throw new Error('后续数据已更新，可通过设置页恢复上一份状态');persist(before);render();if(eventId&&state.records.some(event=>event.id===eventId))showEvent(eventId);else closeModal(true);notice('刚才的明细保存已撤销');});
  notice(kind==='phone'&&!read('i-phone-event')?'手机合影已保存':kind==='merch'?'已保存 '+allNewItems.length+' 项周边':'明细已保存，归入原活动');
 }
 on('#save-item','click',saveItem);
}
function showMember(name,kind){
 const ctx=peopleContext();
 if(kind==='group')window.IdolPeople.showGroup(ctx,name,'activity');else window.IdolPeople.showMember(ctx,name,'activity');
}
function exportData(){const text=JSON.stringify(state);if(window.AndroidBridge)AndroidBridge.exportBackup(text);else{const blob=new Blob([text],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='idol-backup-'+today()+'.json';a.click();localStorage.setItem('idol-last-export',String(Date.now()));if(tab==='backup')render();setTimeout(()=>URL.revokeObjectURL(a.href),3000);}}
function requestImport(){if(window.AndroidBridge)AndroidBridge.importBackup();else{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=guard(async()=>{if(input.files[0].size>50*1024*1024)throw new Error('文件不能超过 50 MB');window.onNativeImport(await input.files[0].text());});input.click();}}
window.onNativeImport=text=>{try{if(closeGuard){askConfirm({title:'打开备份预览？',message:'打开备份预览会放弃当前未保存的修改，是否继续？',okText:'继续打开',danger:true},()=>previewImport(text,'导入备份'));return;}previewImport(text,'导入备份');}catch(e){notice('无法导入：'+e.message);}};
function previewImport(text,title,onlyReplace,allowLegacy){const incoming=C.parseBackup(text,{allowLegacy:!!allowLegacy});const stats=C.stats(incoming.records);const merged=state?C.mergeStates(state,incoming):null;modal(title,'<div class="card">'+detailLine('活动 / 明细',incoming.records.length+' 条 / '+stats.interactionCount+' 条')+detailLine('总支出',cash(stats.total))+detailLine('成员档案',incoming.members.length+' 位')+detailLine('时间范围',incoming.records.length?incoming.records[incoming.records.length-1].date+' 至 '+incoming.records[0].date:'无记录')+'</div><div class="notice warn" style="margin-top:14px">恢复整份将覆盖本机现有记录、预算、成员、团体与事务所档案。</div>'+(merged&&!onlyReplace?'<div class="notice" style="margin-top:12px">合并预览：新增 '+merged.added+' 条，完全重复 '+merged.skipped+' 条，同 ID 冲突 '+merged.conflicts+' 条。<br>成员档案新增 '+merged.membersAdded+' 位，资料冲突 '+merged.memberConflicts+' 位。冲突保留本机内容，合并保留本机预算。'+'</div>':'')+'<div class="actions">'+(merged&&!onlyReplace?'<button id="merge-import" class="primary">合并新增记录</button>':'')+'<button id="replace-import" class="'+(merged?'outline':'primary')+'">恢复整份备份</button></div><p class="subtle">仅支持 v1.2.0 及以上版本的手机完整备份。执行前会自动保存当前状态为上一个版本。</p><div id="form-error" class="error"></div>');
on('#merge-import','click',()=>{persist(merged.state);closeModal(true);render();notice('合并完成：新增 '+merged.added+' 条，保留本机冲突 '+merged.conflicts+' 条');});on('#replace-import','click',()=>{askConfirm({title:'恢复整份备份',message:'确定用这份备份的 '+incoming.records.length+' 条活动替换本机全部记录？执行前会自动保留上一份状态。',okText:'确认替换',danger:true},()=>{persist(incoming);closeModal(true);render();notice('备份恢复完成');});});}
function previous(){const text=window.AndroidBridge?AndroidBridge.readPreviousState():localStorage.getItem('idol-previous');if(!text)throw new Error('暂无上一次保存的副本');previewImport(text,'恢复上一次保存',true,true);}
function bindBackup(){on('#backup-preferences','click',()=>window.IdolExtras.preferences(peopleContext()));on('#backup-pricing','click',()=>window.IdolExtras.pricing(peopleContext()));on('#backup-members','click',()=>window.IdolPeople.manageMembers(peopleContext()));on('#backup-groups','click',()=>window.IdolPeople.manageGroups(peopleContext()));on('#backup-organizers','click',()=>window.IdolPeople.manageOrganizers(peopleContext()));on('#backup-budget','click',()=>window.IdolExtras.budgetManager(peopleContext()));on('#export-full','click',()=>exportData());on('#import','click',requestImport);on('#restore-previous','click',previous);}
function renderStorageError(){$('#main').innerHTML='<div class="intro"><h1>数据需要恢复</h1></div><div class="notice warn">'+esc(storageError)+'<br>原数据未被清空，请选择恢复副本或导入备份。</div><div class="stack" style="margin-top:20px"><button id="error-previous" class="primary">预览上一次保存</button><button id="error-import">导入备份</button></div>';on('#error-previous','click',previous);on('#error-import','click',requestImport);}
allOn('#nav [data-tab]','click',el=>{if(!storageError)navigate(el.dataset.tab);});on('#add-event','click',()=>{if(storageError)throw new Error('请先恢复数据');editEvent();});
async function start(){
 try{
  const stored=window.AndroidBridge?AndroidBridge.readState():localStorage.getItem('idol-state');
  if(stored){
   const meta=JSON.parse(stored);
   if(meta.__storageError)throw new Error(meta.__storageError);
   const normalized=C.parseBackup(stored,{allowLegacy:true});
   if(meta.version!==C.SCHEMA_VERSION||meta.app_version!==C.APP_VERSION){
    persist(normalized);
    notice('已升级到 '+C.APP_VERSION+'，本机记录和预算已保留');
   }else state=normalized;
  }else persist(C.createEmptyState());
  render();
 }catch(e){storageError=e.message;renderStorageError();}
}
start();
})();
