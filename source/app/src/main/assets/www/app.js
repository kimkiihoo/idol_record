(function(){
'use strict';
const C=window.IdolCore,$=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const E={performance:'演出',bonus_only:'仅特典',online_cheki:'电切 / 网签',theme_homework:'宿题/主题',merch_only:'仅买周边',off_meeting:'Off会',other:'其它活动'};
const F={cheki:'普通切',signed:'签名切',unsigned:'无签切',online:'电切 / 网签',theme:'主题切',homework:'宿题/主题',other:'其它特典'};
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
function closeModal(force){if(!force&&closeGuard&&!confirm('放弃尚未保存的修改？'))return;$('#modal').classList.add('hidden');document.body.style.overflow='';closeGuard=null;}
on('#modal-close','click',()=>closeModal(false));
window.onNativeBack=()=>{if(!$('#modal').classList.contains('hidden')){closeModal(false);return true;}if(tab!=='home'){navigate('home');return true;}return false;};
function persist(next){const valid=C.validateState(next);valid.updated_at=new Date().toISOString();const text=JSON.stringify(valid);if(window.AndroidBridge){const result=JSON.parse(AndroidBridge.writeState(text));if(!result.ok)throw new Error(result.error||'保存失败，请重试');}else{localStorage.setItem('idol-previous',localStorage.getItem('idol-state')||'');localStorage.setItem('idol-state',text);}state=valid;storageError='';return true;}
function commitEvent(event,isNew){const next=C.clone(state);const i=next.records.findIndex(r=>r.id===event.id);event.updated_at=new Date().toISOString();if(i>=0)next.records[i]=event;else if(isNew)next.records.push(event);else throw new Error('活动已不存在，请重新打开');persist(next);render();}
function range(){if(period==='custom'){C.validDate(customStart);C.validDate(customEnd);if(customStart>customEnd)throw new Error('开始日期不能晚于结束日期');return{start:customStart,end:customEnd,label:customStart+' 至 '+customEnd};}return C.periodRange(period,anchor);}
function inRange(records){const r=range();return period==='all'?records:C.filterRecords(records,{start:r.start,end:r.end});}
function periodBar(){const r=range();return '<div class="filters"><div class="segmented">'+Object.entries({week:'周',month:'月',quarter:'季度',year:'年',all:'全部',custom:'自定义'}).map(([k,v])=>'<button data-period="'+k+'" class="'+(period===k?'active':'')+'">'+v+'</button>').join('')+'</div>'+(period==='all'?'<div class="period-note">全部历史记录</div>':period==='custom'?'<div class="filter-grid">'+field('开始日期','range-start',customStart,'date')+field('结束日期','range-end',customEnd,'date')+'</div>':'<div class="period-controls"><button id="prev-period" aria-label="上一时段">‹</button><input id="anchor" type="date" value="'+esc(anchor)+'" aria-label="选择日期"><button id="next-period" aria-label="下一时段">›</button></div><div class="period-note">'+esc(r.start)+' — '+esc(r.end)+(period==='week'?' · 周一至周日':'')+'</div>')+'</div>';}
function shiftPeriod(direction){const d=new Date(anchor+'T12:00:00');if(period==='week')d.setDate(d.getDate()+7*direction);else if(period==='month'||period==='quarter'){d.setDate(1);d.setMonth(d.getMonth()+(period==='quarter'?3:1)*direction);}else{d.setDate(1);d.setMonth(0);d.setFullYear(d.getFullYear()+direction);}anchor=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');limit=30;render();}
function bindPeriod(){allOn('[data-period]','click',el=>{period=el.dataset.period;limit=30;render();});on('#anchor','change',()=>{anchor=C.validDate(read('anchor'));limit=30;render();});on('#prev-period','click',()=>shiftPeriod(-1));on('#next-period','click',()=>shiftPeriod(1));on('#range-start','change',()=>{const v=C.validDate(read('range-start'));if(v>customEnd)throw new Error('开始日期不能晚于结束日期');customStart=v;render();});on('#range-end','change',()=>{const v=C.validDate(read('range-end'));if(v<customStart)throw new Error('结束日期不能早于开始日期');customEnd=v;render();});}
function eventCard(e){const names=Array.from(new Set((e.interactions||[]).map(i=>C.itemName(i)).filter(Boolean)));return '<article class="card event click" data-event="'+esc(e.id)+'"><div class="row"><span class="tag">'+esc(E[e.event_type]||e.event_type)+'</span><small>'+esc(e.date)+'</small></div><div class="row" style="margin-top:10px"><h3>'+esc(e.event_name||'未命名活动')+'</h3><span class="amount">'+cash(C.eventTotal(e))+'</span></div><div class="meta">'+esc([e.city,e.venue].filter(x=>x&&x!=='-').join(' · ')||'未填写场地')+'</div>'+(names.length?'<div class="names">'+esc(names.slice(0,5).join(' / '))+(names.length>5?' 等':'')+'</div>':'')+'<div class="foot"><small>'+e.interactions.length+' 条消费明细</small><span class="muted">查看 / 补记 ›</span></div></article>';}
function bindEvents(){allOn('[data-event]','click',el=>showEvent(el.dataset.event));}
function overviewMetric(kind,label,value){
 return '<button class="overview-metric" data-overview-detail="'+kind+'"><strong>'+value+'</strong><small>'+label+' ›</small></button>';
}
function showOverviewDetail(kind,records,label){
 const titles={total:'总支出',events:'活动记录',performances:'演出场次',benefits:'特典',days:'有记录的日期',ticket:'门票',drink:'Drink代',merch:'周边'};
 const rows=[];
 for(const event of records){
  if(kind==='performances'&&event.event_type!=='performance')continue;
  if(['benefits','merch'].includes(kind)||kind.startsWith('form.')){
   for(const item of event.interactions){
    if(kind==='benefits'&&C.kind(item)==='merch'||kind==='merch'&&C.kind(item)!=='merch')continue;
    if(kind.startsWith('form.')&&(C.kind(item)==='merch'||C.form(item,event.event_type,event)!==kind.slice(5)))continue;
    rows.push({event,item,cost:C.itemTotal(item)});
   }
  }else{
   const cost=kind==='ticket'?C.cents(event.ticket_fee):kind==='drink'?C.cents(event.drink_fee):C.eventTotal(event);
   if((kind==='ticket'||kind==='drink')&&!cost)continue;
   rows.push({event,cost});
  }
 }
 let visible=30;
 function paint(){
  const total=rows.reduce((sum,row)=>sum+row.cost,0),count=rows.reduce((sum,row)=>sum+(row.item?C.count(row.item):1),0);
  const days=new Set(rows.map(row=>row.event.date)).size;
  modal((titles[kind]||F[kind.slice(5)]||'消费')+' · 详情','<p class="subtle">'+esc(label||'全部历史')+' · 按活动日期</p><div class="card">'+detailLine('金额合计',cash(total))+detailLine('记录数',rows.length+' 条')+(rows.some(row=>row.item)?detailLine('数量合计',count+(kind==='merch'?' 件':' 张 / 份')):detailLine('有记录的日期',days+' 天'))+'</div>'+rows.slice(0,visible).map(row=>'<button class="interaction-card" data-detail-event="'+esc(row.event.id)+'"><div class="row"><strong>'+esc(row.item?C.itemName(row.item):row.event.event_name)+'</strong><strong>'+cash(row.cost)+'</strong></div><p>'+esc(row.event.date+' · '+(row.item?row.event.event_name:[row.event.city,row.event.venue].filter(Boolean).join(' · ')))+'</p>'+(row.item?'<p>'+C.count(row.item)+(kind==='merch'?' 件':' 张 / 份')+'</p>':'')+'</button>').join('')+(rows.length?'':empty('本时段暂无记录'))+(rows.length>visible?'<button id="more-overview-detail" class="outline">再显示 30 条</button>':''));
  allOn('[data-detail-event]','click',element=>showEvent(element.dataset.detailEvent));
  on('#more-overview-detail','click',()=>{visible+=30;paint();});
 }
 paint();
}
function renderHome(){
 const month=today().slice(0,7),rows=state.records.filter(e=>e.date.startsWith(month)),s=C.stats(rows),budget=C.cents(state.config.monthly_budget||0),left=budget-s.total;
 return '<div class="intro"><p>'+esc(month)+' · 本月手账</p></div><div class="home-columns"><section class="hero"><small>本月总支出</small><button class="value overview-metric" data-overview-detail="total" aria-label="查看总支出详情"><span>¥ </span>'+C.money(s.total)+' ›</button><div class="hero-grid">'+overviewMetric('events','活动记录',s.eventCount)+overviewMetric('performances','演出场次',s.eventTypes.performance||0)+overviewMetric('benefits','特典张 / 份',s.ticketCount)+'</div><div class="separator"></div><div class="row"><small>'+(budget?'月预算 '+cash(budget):'尚未设置月预算')+'</small><small>'+(budget?(left>=0?'剩余 '+cash(left):'超出 '+cash(-left)):'在备份页设置')+'</small></div>'+(budget?'<div class="budget-track"><i class="'+(left<0?'over':'')+'" style="width:'+Math.min(100,s.total/budget*100)+'%"></i></div>':'')+'</section><section><div class="section-title"><h3>本月消费</h3></div><div class="card">'+['ticket','drink','benefits','merch'].map((kind,index)=>'<button class="overview-cost" data-overview-detail="'+kind+'">'+detailLine(['门票','Drink代','特典','周边'][index],cash([s.ticket,s.drink,s.benefit,s.merch][index])+' ›')+'</button>').join('')+'</div><button id="month-stats" class="outline" style="margin-top:12px;width:100%">打开本月详细统计 ↗</button></section></div><div class="section-title row"><h3>最近的相见</h3><button class="text" id="all-records">全部 '+state.records.length+' 条 ›</button></div>'+state.records.slice(0,5).map(eventCard).join('')+(state.records.length?'':empty('还没有记录，点右上角记下第一场活动'));
}
function choiceMap(values,label){return Object.fromEntries([['',label],...C.names(values).sort((a,b)=>a.localeCompare(b,'zh')).map(value=>[value,value])]);}
function renderRecords(){
 const venues=state.records.map(event=>event.venue).filter(value=>value&&value!=='-');
 const organizers=state.records.flatMap(C.eventOrganizers);
 return '<div class="intro"><h1>活动记录</h1></div>'+periodBar()+
  '<input id="search" class="search" placeholder="搜索活动、成员、场地、主办或拼音" value="'+esc(query)+'">'+
  '<div class="filter-grid">'+select('活动类型','event-type',Object.assign({'':'全部活动类型'},E),eventType)+select('场地','record-venue',choiceMap(venues,'全部场地'),venueFilter)+
  select('成员','record-member',choiceMap(C.memberCatalog(state).map(profile=>profile.name),'全部成员'),memberFilter)+select('主办事务所','record-organizer',choiceMap(organizers,'全部主办'),organizerFilter)+'</div><button id="reset-filter" class="outline">清除筛选</button><div id="records-results"></div>';
}
function recordResults(){
 const rows=C.filterRecords(inRange(state.records),{query,type:eventType,venue:venueFilter,member:memberFilter,organizer:organizerFilter,pinyin:window.IdolPinyin});
 $('#records-results').innerHTML='<div class="filter-hint">共 '+rows.length+' 条 · 合计 '+cash(C.stats(rows).total)+'</div>'+rows.slice(0,limit).map(eventCard).join('')+(rows.length>limit?'<button id="load-more" class="outline" style="width:100%">再显示 30 条</button>':'')+(rows.length?'':empty());
 bindEvents();on('#load-more','click',()=>{limit+=30;recordResults();});
}
function renderBackup(){return '<div class="intro"><div class="eyebrow">KEEP YOUR MEMORIES SAFE</div><h1>备份与设置</h1><p>完整备份包含活动、预算与成员档案，换机后可恢复。</p></div><div class="card"><div class="hero-grid backup-counts"><div><strong>'+state.records.length+'</strong><small>条活动</small></div><div><strong>'+C.stats(state.records).interactionCount+'</strong><small>条明细</small></div></div><p class="subtle">本机离线保存 · 每次保存自动保留前一个版本。</p></div><div class="stack" style="margin-top:16px"><button id="export-full" class="backup-action"><span class="symbol">↗</span><span><strong>导出完整备份</strong><small>保存 JSON 文件到你选择的位置，包含活动、设置与成员头像</small></span></button><button id="import" class="backup-action"><span class="symbol">↙</span><span><strong>导入备份 / 电脑记录</strong><small>支持完整备份和桌面版 records.json，导入前可预览</small></span></button><button id="export-desktop" class="backup-action"><span class="symbol">▤</span><span><strong>导出桌面兼容记录</strong><small>仅导出 records.json 列表；预算与成员档案请用完整备份保存</small></span></button><button id="restore-previous" class="backup-action"><span class="symbol">↶</span><span><strong>恢复上一次保存</strong><small>预览后恢复，误删或误改时使用</small></span></button></div><div class="section-title"><h3>每月预算</h3></div><div class="card">'+field('金额（元）；0 表示不设置预算','budget',state.config.monthly_budget||0,'text','inputmode="decimal"')+'<button id="save-budget" class="primary" style="width:100%">保存预算</button><p class="subtle">预算只按自然月使用；周、季度、年统计不套用月预算。</p></div><div class="section-title"><h3>使用说明</h3></div><div class="notice">演出、单独特典、Off会、宿题/主题、电切、周边可分别记账。同一场演出中的特典和周边请进入活动后补记。<br>完整备份是普通 JSON 文件，含个人活动和预算，请保存在可信的位置。卸载前请先导出。</div><p class="subtle">偶像活动手账 '+esc(C.APP_VERSION)+' · 离线版 · 适用于 Android 8.0 及以上<br>统计按活动记录日期归属时段，金额单位：人民币元。</p>';}
function selectStatsSection(section){
 window.IdolPeople.setSection(section);period=section==='overview'?'month':'all';anchor=today();render();
}
function navigate(value,section){
 if(value==='stats'&&(tab!=='stats'||section)){const target=section||'members';window.IdolPeople.setSection(target);period=target==='overview'?'month':'all';anchor=today();}
 tab=value;render();window.scrollTo(0,0);
}
function render(){
 if(storageError){renderStorageError();return;}
 $('.app-header').classList.toggle('hidden',tab==='records'||tab==='stats');
 $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='home')$('#main').innerHTML=renderHome();
 else if(tab==='records')$('#main').innerHTML=renderRecords();
 else if(tab==='backup')$('#main').innerHTML=renderBackup();
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
  on('#reset-filter','click',()=>{query='';eventType='';venueFilter='';memberFilter='';organizerFilter='';period='all';limit=30;render();});
 }
 if(tab==='backup')bindBackup();
}

function statsContext(){return{C,state,records:inRange(state.records),range:range(),periodKind:period,anchor,esc,money:cash,onMember:showMember,onDetail:kind=>showOverviewDetail(kind,inRange(state.records),range().label),onFilter:type=>{eventType=type;query='';venueFilter='';memberFilter='';organizerFilter='';navigate('records');},onPeriod:(p,a)=>{period=p;anchor=a||anchor;render();},onCustom:(s,e)=>{customStart=s;customEnd=e;period='custom';render();},notify:notice};}
function peopleContext(){
 const ctx=statsContext();
 return Object.assign(ctx,{on,allOn,field,select,textArea,detailLine,modal,closeModal,read,empty,persist,historyPicker,bindHistory,rerender:render,onSection:selectStatsSection,onEvent:showEvent,renderOverview:()=>window.IdolStats.render(ctx),bindOverview:()=>window.IdolStats.bind(ctx),renderFootprints:()=>window.IdolStats.renderFootprints(ctx),bindFootprints:()=>window.IdolStats.bind(ctx)});
}
function showEvent(id){const e=state.records.find(r=>r.id===id);if(!e)throw new Error('未找到活动');let html='<div class="row"><span class="tag">'+esc(E[e.event_type]||e.event_type)+'</span><strong>'+cash(C.eventTotal(e))+'</strong></div>'+detailLine('日期',e.date)+detailLine('城市 / 场地',[e.city,e.venue].filter(Boolean).join(' · '))+(C.eventOrganizers(e).length?detailLine('主办事务所',C.eventOrganizers(e).join(' / ')):'')+(C.names(e.performing_groups).length?detailLine('参演团体',C.names(e.performing_groups).join(' / ')):'')+detailLine('门票',cash(C.cents(e.ticket_fee)))+detailLine('Drink代',cash(C.cents(e.drink_fee)))+(e.tags?detailLine('标签',Array.isArray(e.tags)?e.tags.join(' / '):e.tags):'')+(e.note?'<div class="notice">'+esc(e.note)+'</div>':'')+'<div class="actions"><button id="edit-basics" class="outline">修改活动</button><button id="delete-event" class="danger">删除活动</button></div><div class="section-title row"><h3>消费明细 · '+e.interactions.length+' 条</h3><button id="add-item" class="primary compact">＋ 补记</button></div>'+e.interactions.map((it,i)=>'<div class="item-card"><div class="row"><strong>'+esc(C.itemName(it))+'</strong><strong>'+cash(C.itemTotal(it))+'</strong></div><div class="item-note">'+esc(C.kind(it)==='merch'?'周边':(C.kind(it)==='group'?'团切 · ':C.kind(it)==='multi'?'多人合影 · ':'单人 · ')+(F[C.form(it,e.event_type,e)]||C.form(it,e.event_type,e)))+' · '+C.count(it)+' 张 / 份'+(identityDescription(it,e)?' · '+esc(identityDescription(it,e)):'')+'</div>'+(it.shot_at?'<div class="item-note">拍摄 '+esc(it.shot_at.replace('T',' '))+'</div>':'')+(it.note?'<div class="item-note">'+esc(it.note)+'</div>':'')+(it.order_number?'<div class="item-note">订单 / 运单 '+esc(it.order_number)+'</div>':'')+'<div class="buttons"><button data-edit-item="'+i+'">修改明细</button><button class="danger" data-delete-item="'+i+'">删除</button></div></div>').join('')+(e.interactions.length?'':empty('可以只看演出，也可以稍后补记特典和周边。'));modal(e.event_name||'活动详情',html);on('#edit-basics','click',()=>editEvent(id));on('#add-item','click',()=>editItem(id));on('#delete-event','click',()=>{if(!confirm('删除这场活动及其全部消费明细？可在备份页恢复上一次保存。'))return;const next=C.clone(state);next.records=next.records.filter(r=>r.id!==id);persist(next);closeModal(true);render();notice('活动已删除');});allOn('[data-edit-item]','click',el=>editItem(id,Number(el.dataset.editItem)));allOn('[data-delete-item]','click',el=>{if(!confirm('删除这条消费明细？'))return;const n=C.clone(e);n.interactions.splice(Number(el.dataset.deleteItem),1);commitEvent(n);showEvent(id);});}
// History choices stay in the document flow; input fields never open WebView datalist popups.
function historyPicker(id){return '<details class="history-picker" id="'+id+'-picker"><summary>从历史记录选择</summary><input id="'+id+'-search" type="text" autocomplete="off" placeholder="搜索历史名称或拼音" aria-label="搜索历史名称"><div class="history-options" id="'+id+'"></div></details>';}
function bindHistory(id,inputId,values,onChoose){
 const panel=$('#'+id+'-picker'),search=$('#'+id+'-search'),input=$('#'+inputId);
 function refresh(){const matches=values().filter(value=>C.search({name:value},search.value,window.IdolPinyin)),visible=matches.slice(0,40);$('#'+id).innerHTML=visible.map((value,index)=>'<button type="button" data-history-index="'+index+'">'+esc(value)+'</button>').join('')+(matches.length>40?'<p class="subtle">显示前 40 项，请搜索缩小范围。</p>':'')+(matches.length?'':'<p class="subtle">暂无匹配的历史名称，可直接在上方填写。</p>');allOn('#'+id+' [data-history-index]','click',el=>{const previous=input.value;input.value=visible[Number(el.dataset.historyIndex)];panel.open=false;search.value='';if(onChoose)onChoose(input.value,previous);input.focus();});}
 let composing=false;
 on('#'+id+'-search','compositionstart',()=>{composing=true;});
 on('#'+id+'-search','compositionend',()=>{composing=false;refresh();});
 on('#'+id+'-search','input',()=>{if(!composing)refresh();});
 panel.addEventListener('toggle',guard(()=>{if(panel.open)refresh();}));
 on('#'+inputId,'focus',()=>{panel.open=false;});
 refresh();return refresh;
}
function identityDescription(item,event){
 return C.participants(item).map(member=>member+'（'+(C.identityGroups(item,state,event,member).join(' / ')||'身份未指定')+'）').join('、');
}
function identityEditor(host,event,item){
 const values=new Map(),edited=new Set();let members=[];
 function collect(){
  return members.map((member,index)=>({member,group:read(host+'-role-'+index)})).filter(role=>
   role.group||edited.has(role.member)||(event.member_roles||[]).some(saved=>saved.member===role.member)||(item.participant_groups||[]).some(saved=>saved.member===role.member));
 }
 function refresh(nextMembers){
  for(const role of collect())values.set(role.member,role.group);
  members=C.names(nextMembers);
  $('#'+host).innerHTML=members.length?'<h3>本场活动成员身份</h3><p class="subtle">每位成员填写本场代表的一个团体，留空表示未指定。同场活动的互动共用该身份。</p>'+members.map((member,index)=>{
   const value=values.has(member)?values.get(member):C.preferredIdentity(item,state,event,member);
   return field(member+' · 本场代表团体',host+'-role-'+index,value,'text','maxlength="300" autocomplete="off"')+historyPicker(host+'-history-'+index);
  }).join(''):'';
  members.forEach((member,index)=>{
   on('#'+host+'-role-'+index,'input',()=>edited.add(member));
   on('#'+host+'-role-'+index,'change',()=>edited.add(member));
   bindHistory(host+'-history-'+index,host+'-role-'+index,()=>{
   const profile=C.memberCatalog(state).find(profile=>profile.name===member);
   return C.names([...(profile?profile.groups:[]),...C.names(event.performing_groups),...C.groupCatalog(state)]);
   },()=>edited.add(member));
  });
 }
 return {refresh,collect};
}
function applyRoles(event,roles){
 const merged=new Map((event.member_roles||[]).map(role=>[role.member,role]));
 for(const role of roles)merged.set(role.member,role);
 event.member_roles=Array.from(merged.values());
}
function editEvent(id){
 const old=id?state.records.find(event=>event.id===id):null;
 const event=old?C.clone(old):{id:uid(),date:today(),event_type:'performance',event_name:'',city:'',venue:'',ticket_fee:0,drink_fee:0,interactions:[],created_at:new Date().toISOString()};
 modal(old?'修改活动':'记一场新的活动',
  '<div class="form-grid">'+field('日期','e-date',event.date,'date')+select('活动类型','e-type',E,event.event_type)+'</div>'+
  field('活动名称','e-name',event.event_name,'text','maxlength="300" autocomplete="off"')+
  '<div class="form-grid"><div>'+field('城市','e-city',event.city,'text','autocomplete="off"')+historyPicker('cities')+'</div><div>'+field('场地 / 购买渠道','e-venue',event.venue,'text','autocomplete="off"')+historyPicker('venues')+'</div></div>'+
  '<div class="form-grid">'+field('门票（元）','e-ticket',C.money(C.cents(event.ticket_fee)),'text','inputmode="decimal"')+field('Drink代（元）','e-drink',C.money(C.cents(event.drink_fee)),'text','inputmode="decimal"')+'</div>'+
  '<div id="organizer-field">'+field('主办事务所，联合主办用逗号分隔','e-organizer',C.eventOrganizers(event).join('，'),'text','maxlength="2000" autocomplete="off"')+historyPicker('organizers')+'</div>'+
  field('参演团体，多个用逗号分隔','e-performing',C.names(event.performing_groups).join('，'),'text','autocomplete="off"')+historyPicker('performers')+
  '<div id="event-identities"></div>'+
  field('标签（逗号分隔）','e-tags',Array.isArray(event.tags)?event.tags.join('，'):event.tags||'')+textArea('活动备注','e-note',event.note||'')+
  '<p id="event-type-hint" class="subtle"></p><div id="form-error" class="error"></div><button id="save-event" class="primary" style="width:100%">保存活动'+(old?'':'，继续补记')+'</button>',true);
 const appendNames=(selected,previous)=>C.names([].concat(C.names(previous),[selected])).join('，');
 bindHistory('performers','e-performing',()=>C.groupCatalog(state),(selected,previous)=>{$('#e-performing').value=appendNames(selected,previous);});
 bindHistory('organizers','e-organizer',()=>C.names(state.records.flatMap(C.eventOrganizers)),(selected,previous)=>{$('#e-organizer').value=appendNames(selected,previous);});
 const identities=identityEditor('event-identities',event,{});
 identities.refresh(event.interactions.flatMap(C.participants));
 const refreshVenues=bindHistory('venues','e-venue',()=>C.frequent(state.records,'venue',{city:read('e-city'),eventType:read('e-type'),limit:Number.MAX_SAFE_INTEGER}));
 bindHistory('cities','e-city',()=>C.frequent(state.records,'city',{limit:Number.MAX_SAFE_INTEGER}),refreshVenues);
 function suggestions(){
  const type=read('e-type');
  $('#organizer-field').classList.toggle('hidden',type!=='performance');
  $('#event-type-hint').textContent=['online_cheki','theme_homework'].includes(type)?'线上订单可将城市填为 -、场地填为线上 / 邮寄。门票与 Drink 无则填写 0。':'保存活动后可继续补记拍切、宿题/主题或周边。';
  refreshVenues();
 }
 on('#e-city','input',suggestions);
 on('#e-type','change',()=>{if(!old&&['online_cheki','theme_homework'].includes(read('e-type'))){if(!read('e-city'))$('#e-city').value='-';if(!read('e-venue'))$('#e-venue').value='线上/邮寄';}suggestions();});
 suggestions();
 on('#save-event','click',()=>{
  event.date=C.validDate(read('e-date'));event.event_type=read('e-type');event.event_name=read('e-name');
  if(!event.event_name)throw new Error('请填写活动名称');
  if(event.event_type==='performance'){event.organizers=C.names(read('e-organizer'));event.organizer=event.organizers.join('，');}
  applyRoles(event,identities.collect());
  event.performing_groups=C.names(read('e-performing'));
  event.city=read('e-city')||'-';event.venue=read('e-venue')||'-';
  event.ticket_fee=C.amount(C.cents(read('e-ticket')));event.drink_fee=C.amount(C.cents(read('e-drink')));
  event.tags=C.names(read('e-tags'));event.note=read('e-note');
  commitEvent(event,!old);notice('活动已保存');showEvent(event.id);
 });
}
function editItem(eventId,index){
 const original=state.records.find(event=>event.id===eventId);
 if(!original)throw new Error('活动不存在');
 const old=index==null?null:original.interactions[index];
 const item=old?C.clone(old):{id:uid(),type:'cheki',cheki_type:'individual',benefit_format:original.event_type==='theme_homework'?'homework':original.event_type==='online_cheki'?'online':'cheki',tickets:1,note:'',created_at:new Date().toISOString()};
 const initialKind=C.kind(item),initialPrice=initialKind==='merch'?item.price:item.price_per_ticket;
 const initialName=initialKind==='multi'?C.participants(item).join('，'):C.itemName(item)==='未命名'?'':C.itemName(item);
 modal(old?'修改消费明细':'补记拍切 / 宿题/主题 / 周边',
  '<div class="notice">'+esc(original.date+' · '+original.event_name)+'</div>'+
  select('消费类别','i-kind',{individual:'单人特典',multi:'多人合影',group:'团切 / 团体特典',merch:'周边商品'},initialKind)+
  field('成员 / 团体 / 商品名称','i-name',initialName,'text','autocomplete="off" maxlength="1000"')+
  '<p id="multi-hint" class="subtle">多人合影请填写所有成员，使用逗号分隔，至少两位。每条实付总额填写整张合影费用。</p>'+historyPicker('names')+
  '<div id="form-field">'+select('特典形式','i-form',F,C.form(item,original.event_type,original))+'</div>'+
  '<div id="item-identities"></div><div id="item-group-field">'+field('所属团体，多个用逗号分隔（选填）','i-group',C.names(item.affiliated_groups||item.affiliated_group).join('，'))+historyPicker('item-groups')+'</div>'+
  field('拍摄时间（选填，未填采用活动日期）','i-shot',item.shot_at||'','datetime-local')+
  '<div class="form-grid">'+field('单价（元）','i-price',initialPrice==null?'':C.money(C.cents(initialPrice)),'text','inputmode="decimal"')+field('数量（张 / 份 / 件）','i-qty',C.count(item),'text','inputmode="numeric"')+'</div><div id="price-options" class="chips"></div>'+
  field('本条实付总额（元）','i-total',old?C.money(C.itemTotal(item)):'','text','inputmode="decimal"')+
  '<p class="subtle">修改单价或数量时自动计算实付总额，折扣可手动调整。只改备注时保留历史金额。</p>'+
  textArea('宿题/主题题目 / 内容 / 备注','i-note',item.note||'')+field('订单号（选填）','i-order',item.order_number||'')+
  '<div id="form-error" class="error"></div><div class="actions"><button id="back-event" class="outline">返回活动</button><button id="save-item" class="primary">保存明细</button></div>',true);
 let pricingChanged=false;
 const identities=identityEditor('item-identities',original,item);
 bindHistory('item-groups','i-group',()=>C.groupCatalog(state),(selected,previous)=>{$('#i-group').value=C.names([].concat(C.names(previous),[selected])).join('，');});
 const refreshNames=bindHistory('names','i-name',()=>{
  const kind=read('i-kind');
  if(kind==='individual'||kind==='multi')return C.memberCatalog(state).map(profile=>profile.name);
  return kind==='merch'?C.frequent(state.records,'item_name',{eventType:original.event_type,limit:Number.MAX_SAFE_INTEGER}):C.groupCatalog(state);
 },(selected,previous)=>{if(read('i-kind')==='multi')$('#i-name').value=C.names([].concat(C.names(previous),[selected])).join('，');contextChanged();});
 function sum(){pricingChanged=true;try{$('#i-total').value=C.money(C.cents(read('i-price'))*C.quantity(read('i-qty')));}catch(_){$('#i-total').value='';}}
 function recommendations(){
  const kind=read('i-kind');
  $('#form-field').classList.toggle('hidden',kind==='merch');
  $('#item-group-field').classList.toggle('hidden',kind==='individual'||kind==='multi');
  identities.refresh(kind==='individual'?[read('i-name')].filter(Boolean):kind==='multi'?C.names(read('i-name')):[]);
  $('#multi-hint').classList.toggle('hidden',kind!=='multi');
  refreshNames();
  const options=C.prices(state.records,read('i-name'),kind,read('i-form'),original.event_type);
  $('#price-options').innerHTML=options.length?'<small style="width:100%">同对象、同形式的历史单价</small>'+options.map(price=>'<button data-price="'+price+'">'+cash(C.cents(price))+'</button>').join(''):'<small>没有匹配的历史单价，请按实际填写。</small>';
  allOn('[data-price]','click',element=>{$('#i-price').value=element.dataset.price;sum();});
 }
 function contextChanged(){pricingChanged=true;$('#i-price').value='';$('#i-total').value='';recommendations();}
 on('#i-kind','change',contextChanged);
 on('#i-name','input',event=>{if(!event.isComposing)contextChanged();});
 on('#i-name','compositionend',contextChanged);
 on('#i-form','change',contextChanged);
 on('#i-price','input',sum);on('#i-qty','input',sum);recommendations();
 on('#back-event','click',()=>{if(confirm('放弃本条尚未保存的修改，返回活动？'))showEvent(eventId);});
 on('#save-item','click',()=>{
  const kind=read('i-kind'),target=read('i-name');
  if(!target)throw new Error('请填写成员、团体或商品名称');
  const count=C.quantity(read('i-qty'));
  const unit=read('i-price')===''&&old&&initialPrice==null&&!pricingChanged?null:C.amount(C.cents(read('i-price')));
  const total=C.amount(C.cents(read('i-total')));
  if(kind==='merch'){
   item.type='merch';item.item_name=target;item.quantity=count;
   if(unit!=null)item.price=unit;
   for(const key of ['cheki_type','member','members','group_name','tickets','price_per_ticket','benefit_format','shot_at'])delete item[key];
  }else{
   item.type='cheki';item.cheki_type=kind;item.tickets=count;
   for(const key of ['item_name','price','quantity','member','members','group_name'])delete item[key];
   if(kind==='multi'){item.members=C.names(target);if(item.members.length<2)throw new Error('多人合影至少填写两位不同成员');}
   else item[kind==='group'?'group_name':'member']=target;
   item.benefit_format=read('i-form');
   if(unit!=null)item.price_per_ticket=unit;
   if(read('i-shot'))item.shot_at=read('i-shot');else delete item.shot_at;
  }
  item.total_cost=total;item.note=read('i-note');item.order_number=read('i-order');
  const next=C.clone(original);
  if(kind==='individual'||kind==='multi'){
   item.participant_groups=identities.collect();
   applyRoles(next,item.participant_groups);
  }else{
   delete item.participant_groups;
   item.affiliated_groups=C.names(read('i-group'));item.affiliated_group=item.affiliated_groups.join('，');
  }
  if(index==null)next.interactions.push(item);else next.interactions[index]=item;
  commitEvent(next);showEvent(eventId);notice('明细已保存，归入原活动');
 });
}
function showMember(name,kind){
 const ctx=peopleContext();
 if(kind==='group')window.IdolPeople.showGroup(ctx,name,'activity');else window.IdolPeople.showMember(ctx,name,'activity');
}
function exportData(full){const payload=full?state:state.records;const text=JSON.stringify(payload);if(window.AndroidBridge)AndroidBridge.exportBackup(text);else{const blob=new Blob([text],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=full?'idol-backup-'+today()+'.json':'records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);}}
function requestImport(){if(window.AndroidBridge)AndroidBridge.importBackup();else{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=guard(async()=>{if(input.files[0].size>10*1024*1024)throw new Error('文件不能超过 10 MB');window.onNativeImport(await input.files[0].text());});input.click();}}
window.onNativeImport=text=>{try{if(closeGuard&&!confirm('打开备份预览会放弃当前未保存的修改，是否继续？'))return;previewImport(text,'导入备份');}catch(e){notice('无法导入：'+e.message);}};
function previewImport(text,title,onlyReplace){const incoming=C.parseBackup(text,state?state.config:{});const raw=Array.isArray(JSON.parse(text.replace(/^\uFEFF/,'')));if(raw&&state)incoming.members=C.clone(state.members);const stats=C.stats(incoming.records);const merged=state?C.mergeStates(state,incoming):null;modal(title,'<div class="card">'+detailLine('活动 / 明细',incoming.records.length+' 条 / '+stats.interactionCount+' 条')+detailLine('总支出',cash(stats.total))+detailLine('成员档案',incoming.members.length+' 位')+detailLine('时间范围',incoming.records.length?incoming.records[incoming.records.length-1].date+' 至 '+incoming.records[0].date:'无记录')+'</div><div class="notice warn" style="margin-top:14px">'+(raw?'这是桌面记录列表，预算和成员档案沿用本机设置。':'恢复整份会采用备份中的记录、预算与成员档案，旧版备份未包含的成员档案会被清空。')+'</div>'+(merged&&!onlyReplace?'<div class="notice" style="margin-top:12px">合并预览：新增 '+merged.added+' 条，完全重复 '+merged.skipped+' 条，同 ID 冲突 '+merged.conflicts+' 条。<br>成员档案新增 '+merged.membersAdded+' 位，资料冲突 '+merged.memberConflicts+' 位。冲突保留本机内容，合并保留本机预算。'+'</div>':'')+'<div class="actions">'+(merged&&!onlyReplace?'<button id="merge-import" class="primary">合并新增记录</button>':'')+'<button id="replace-import" class="'+(merged?'outline':'primary')+'">恢复整份备份</button></div><p class="subtle">执行前会自动保存当前状态为上一个版本。需要长久保留时，请先导出完整备份。</p><div id="form-error" class="error"></div>');
on('#merge-import','click',()=>{persist(merged.state);closeModal(true);render();notice('合并完成：新增 '+merged.added+' 条，保留本机冲突 '+merged.conflicts+' 条');});on('#replace-import','click',()=>{if(!confirm('用这份备份的 '+incoming.records.length+' 条活动替换本机全部记录？'))return;persist(incoming);closeModal(true);render();notice('备份恢复完成');});}
function previous(){const text=window.AndroidBridge?AndroidBridge.readPreviousState():localStorage.getItem('idol-previous');if(!text)throw new Error('暂无上一次保存的副本');previewImport(text,'恢复上一次保存',true);}
function bindBackup(){on('#export-full','click',()=>exportData(true));on('#export-desktop','click',()=>exportData(false));on('#import','click',requestImport);on('#restore-previous','click',previous);on('#save-budget','click',()=>{const next=C.clone(state);next.config.monthly_budget=C.amount(C.cents(read('budget')));persist(next);render();notice('月预算已保存');});}
function renderStorageError(){$('#main').innerHTML='<div class="intro"><h1>数据需要恢复</h1></div><div class="notice warn">'+esc(storageError)+'<br>原数据未被清空，请选择恢复副本或导入备份。</div><div class="stack" style="margin-top:20px"><button id="error-previous" class="primary">预览上一次保存</button><button id="error-import">导入备份</button></div>';on('#error-previous','click',previous);on('#error-import','click',requestImport);}
allOn('#nav [data-tab]','click',el=>{if(!storageError)navigate(el.dataset.tab);});on('#add-event','click',()=>{if(storageError)throw new Error('请先恢复数据');editEvent();});
async function start(){
 try{
  const stored=window.AndroidBridge?AndroidBridge.readState():localStorage.getItem('idol-state');
  if(stored){
   const meta=JSON.parse(stored);
   if(meta.__storageError)throw new Error(meta.__storageError);
   const normalized=C.parseBackup(stored);
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
