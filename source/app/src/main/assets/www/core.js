(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IdolCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'idol-tracker-backup';
  const SCHEMA_VERSION = 7;
  const APP_VERSION = '1.3.0';
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
        if (omitImages && (depth === 0 && key === 'members' || key === 'attachments' || key === 'group_profiles' || key === 'organizer_profiles')) { out[key] = clone(value[key], depth + 1, false); continue; }
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
    if (item.type === 'phone') return 'phone';
    if (item.type === 'merch') return 'merch';
    if (item.type === 'group' || item.cheki_type === 'group') return 'group';
    return item.cheki_type === 'multi' ? 'multi' : 'individual';
  }
  function isGroupItem(item) {
    return kind(item) === 'group' || (kind(item) === 'phone' && (item.cheki_type === 'group' || (!item.member && !item.member_id && !!item.group_name)));
  }
  function isPhone(item, event) {
    return kind(item) === 'phone' || (kind(item) !== 'merch' && form(item, event && event.event_type, event) === 'phone');
  }
  function names(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[,，、;；\n]/);
    return Array.from(new Set(source.map(name => String(name).trim()).filter(Boolean)));
  }
  function participants(item) {
    if (kind(item) === 'multi') return Array.isArray(item.member_ids) ? item.members.map(String) : names(item.members);
    return (kind(item) === 'individual' || (kind(item) === 'phone' && !isGroupItem(item))) ? [String(item.member || '未知成员')] : [];
  }
  function itemName(item) {
    if (kind(item) === 'multi') return participants(item).join(' / ');
    return String(item.member || item.group_name || item.item_name || '未命名');
  }
  function validateAvatar(value, label) {
    const avatar = value == null ? '' : value;
    if (typeof avatar !== 'string' || avatar.length > 250000 || (avatar && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar))) {
      fail((label || '头像') + '格式无效或超过大小限制');
    }
    return avatar;
  }
  function validateMembers(input) {
    if (input == null) return [];
    if (!Array.isArray(input)) fail('成员档案必须为列表');
    const seen = new Set();
    return input.map(profile => {
      if (!plain(profile) || typeof profile.name !== 'string' || !profile.name.trim()) fail('请填写成员姓名');
      const clean = clone(profile, 1, true);
      clean.avatar = validateAvatar(profile.avatar, '成员头像');
      clean.name = clean.name.trim();
      clean.id = clean.id || legacyMemberId(clean.name);
      if (typeof clean.id !== 'string' || clean.id.length > 300 || !clean.id || clean.name.length > 300 || seen.has(clean.id)) fail('成员编号重复或姓名过长');
      seen.add(clean.id);
      clean.aliases = names(clean.aliases);
      clean.archived = clean.archived === true;
      clean.groups = names(clean.groups);
      clean.color = clean.color || '#FFFFFF';
      if (!/^#[0-9a-fA-F]{6}$/.test(clean.color)) fail('应援色须为六位颜色值');
      if (clean.first_met == null || clean.first_met === '') clean.first_met = '';
      else {
        if (typeof clean.first_met !== 'string') fail('初次见面日期格式错误');
        clean.first_met = validDate(clean.first_met.trim());
      }
      for (const key of ['weibo', 'douyin', 'xiaohongshu', 'note']) {
        if (clean[key] == null) clean[key] = '';
        if (typeof clean[key] !== 'string' || clean[key].length > 2000) fail('成员资料字段格式错误');
      }
      if (!own(clean, 'social_accounts')) {
        clean.social_accounts = [['微博', clean.weibo], ['抖音', clean.douyin], ['小红书', clean.xiaohongshu]]
          .filter(row => row[1]).map(row => ({ platform: row[0], account: row[1] }));
      }
      if (!Array.isArray(clean.social_accounts) || clean.social_accounts.length > 32) fail('社媒账号须为列表，最多 32 条');
      clean.social_accounts = clean.social_accounts.map(account => {
        if (!plain(account) || typeof account.platform !== 'string' || typeof account.account !== 'string') fail('社媒账号格式错误');
        const platform = account.platform.trim(), value = account.account.trim();
        if (!platform || !value || platform.length > 80 || value.length > 2000) fail('请完整填写社媒平台和账号');
        return { platform, account: value };
      });
      delete clean.weibo; delete clean.douyin; delete clean.xiaohongshu;
      return clean;
    });
  }
  function legacyMemberId(name) { return 'person-' + hash(String(name)); }
  function participantIds(item) {
    if (kind(item) === 'multi') return item.member_ids || participants(item).map(legacyMemberId);
    return (kind(item) === 'individual' || (kind(item) === 'phone' && !isGroupItem(item))) ? [item.member_id || legacyMemberId(participants(item)[0])] : [];
  }
  const catalogCache = new WeakMap();
  function memberCatalog(state) {
    if(catalogCache.has(state))return catalogCache.get(state);
    const catalog = new Map((state.members || []).map(profile => [profile.id || legacyMemberId(profile.name), Object.assign({},clone(profile),{id:profile.id || legacyMemberId(profile.name)})]));
    for (const event of state.records) for (const item of event.interactions || []) {
      participants(item).forEach((name,index)=>{
        const id=participantIds(item)[index];
        if (!catalog.has(id)) catalog.set(id, { id,name,aliases:[],archived:false,groups:[],color:'#FFFFFF',avatar:'',first_met:'',social_accounts:[],note:'' });
      });
    }
    const result=Array.from(catalog.values()).sort((a,b)=>a.name.localeCompare(b.name,'zh')||a.id.localeCompare(b.id));
    catalogCache.set(state,result);return result;
  }
  function memberLabel(profile,state) {
    if(memberCatalog(state).filter(other=>other.name===profile.name).length<2)return profile.name;
    let suffix=profile.id.slice(-6);
    if(memberCatalog(state).some(other=>other.id!==profile.id&&other.name===profile.name&&(other.groups[0]||'')===(profile.groups[0]||'')&&other.id.slice(-6)===suffix))suffix=profile.id;
    return profile.name+'（'+(profile.groups[0]||'未设置团体')+' · '+suffix+'）';
  }
  function resolveMember(state,key) {
    const catalog=memberCatalog(state),byId=catalog.find(profile=>profile.id===key);
    if(byId)return byId;
    const exact=catalog.filter(profile=>profile.name===key);
    if(exact.length>1)fail('存在同名成员，请从历史列表选取具体档案');
    if(exact.length===1)return exact[0];
    const byLabel=catalog.find(profile=>memberLabel(profile,state)===key);
    if(byLabel)return byLabel;
    const alias=catalog.filter(profile=>(profile.aliases||[]).includes(key));
    if(alias.length>1)fail('曾用名对应多位成员，请选择具体档案');
    return alias[0]||{id:legacyMemberId(key),name:key,aliases:[],archived:false,groups:[],color:'#FFFFFF',avatar:'',first_met:'',social_accounts:[],note:''};
  }
  function roleMatches(role,key) { return role.member_id ? role.member_id===key : role.member===key; }
  function memberGroups(state,key) {
    const profile=resolveMember(state,key),groups=[...profile.groups];
    for(const event of state.records)for(const item of event.interactions||[]){
      if(!participantIds(item).includes(profile.id))continue;
      const role=(item.participant_groups||[]).find(role=>roleMatches(role,profile.id)||!role.member_id&&role.member===profile.name);
      const fallback=(event.member_roles||[]).find(role=>roleMatches(role,profile.id)||!role.member_id&&role.member===profile.name);
      if(role&&role.group)groups.push(role.group);
      else if(fallback&&fallback.group)groups.push(fallback.group);
      else groups.push(...names(item.affiliated_groups||item.affiliated_group));
    }
    return names(groups);
  }
  function groupCatalog(state) {
    const groups = [...((state.config && state.config.group_profiles) || []).map(profile => profile.name), ...(state.members || []).flatMap(profile => profile.groups || [])];
    for (const event of state.records) {
      groups.push(...names(event.performing_groups), ...(event.member_roles || []).map(role => role.group));
      for (const item of event.interactions || []) {
        groups.push(...names(item.affiliated_groups), ...names(item.affiliated_group), ...(item.participant_groups || []).map(role => role.group));
        if (isGroupItem(item)) groups.push(String(item.group_name || '未知团体'));
      }
    }
    return names(groups).sort((a, b) => a.localeCompare(b, 'zh'));
  }
  function memberMetrics(state,options) {
    options=options||{};
    const metrics=new Map(),catalog=new Map(memberCatalog(state).map(profile=>[profile.id,profile]));
    if(options.kind!=='group')for(const profile of catalog.values())metrics.set(profile.id,{id:profile.id,name:profile.name,count:0,cost:0,last_date:''});
    for(const row of interactionRows(state,options)){
      const group=isGroupItem(row.item);
      if(group!==(options.kind==='group'))continue;
      const targets=group?[String(row.item.group_name||'未知团体')]:participantIds(row.item),cost=itemTotal(row.item),phone=isPhone(row.item,row.event);
      targets.forEach((id,index)=>{
        const name=group?id:(catalog.get(id)||{}).name||participants(row.item)[index];
        if(!metrics.has(id))metrics.set(id,{id,name,count:0,cost:0,last_date:''});
        const target=metrics.get(id);
        if(phone)target.phone_count=(target.phone_count||0)+count(row.item);else target.count=safe(target.count+count(row.item));
        target.cost=safe(target.cost+Math.floor(cost/targets.length)+(index<cost%targets.length?1:0));
        if(options.breakdown&&!phone){if(!target.breakdown)target.breakdown=Object.create(null);const label=benefitLabel(row.item,state,row.event);Object.defineProperty(target.breakdown,label,{value:(target.breakdown[label]||0)+count(row.item),writable:true,enumerable:true,configurable:true});}
        if(row.date>target.last_date)target.last_date=row.date;
      });
    }
    return Array.from(metrics.values()).sort((a,b)=>{
      const latest=b.last_date.localeCompare(a.last_date);
      return (options.sort==='latest'?latest:options.sort==='cost'?b.cost-a.cost:b.count-a.count)||latest||a.name.localeCompare(b.name,'zh')||a.id.localeCompare(b.id);
    });
  }
  function normalizeMemberLinks(state,upgrading) {
    const byId=new Map(state.members.map(profile=>[profile.id,profile]));
    const byName=new Map(),nameCounts=new Map();
    for(const profile of state.members)nameCounts.set(profile.name,(nameCounts.get(profile.name)||0)+1);
    for(const profile of state.members){
      for(const name of [profile.name,...profile.aliases])if(!byName.has(name))byName.set(name,profile);
    }
    function link(name,id){
      if(!id&&(nameCounts.get(String(name))||0)>1)fail('同名成员的记录缺少成员编号，请先指定对应档案');
      const profile=id?byId.get(id):byName.get(String(name));
      return {member:profile?profile.name:String(name),member_id:id||profile&&profile.id||legacyMemberId(name)};
    }
    for(const event of state.records){
      event.member_roles=(event.member_roles||[]).map(role=>Object.assign({},role,link(role.member,role.member_id)));
      const declaredRoles=new Set(event.member_roles.map(role=>role.member_id));
      for(const item of event.interactions){
        if(kind(item)==='individual'||(kind(item)==='phone'&&!isGroupItem(item))){
          const person=link(participants(item)[0],item.member_id);item.member=person.member;item.member_id=person.member_id;
        }else if(kind(item)==='multi'){
          if(item.member_ids&&(!Array.isArray(item.member_ids)||item.member_ids.length!==item.members.length))fail('多人特典成员编号与名单不匹配');
          const links=participants(item).map((name,index)=>link(name,item.member_ids&&item.member_ids[index]));
          item.members=links.map(role=>role.member);item.member_ids=links.map(role=>role.member_id);
          if(new Set(item.member_ids).size!==item.member_ids.length)fail('多人特典不能重复同一成员');
        }else if(kind(item)==='merch'){
          if(item.merch_members!=null||item.merch_member_ids!=null){
            const rawNames=names(item.merch_members);
            const rawIds=Array.isArray(item.merch_member_ids)?item.merch_member_ids.map(String):[];
            const entries=new Map();
            const totalLen=Math.max(rawNames.length,rawIds.length);
            for(let idx=0;idx<totalLen;idx++){const res=link(rawNames[idx]||rawIds[idx],rawIds[idx]);entries.set(res.member_id,res.member);}
            item.merch_member_ids=Array.from(entries.keys());
            item.merch_members=Array.from(entries.values());
          }
          if(item.merch_organizers!=null)item.merch_organizers=names(item.merch_organizers);
        }
        if(participantIds(item).some(id=>typeof id!=='string'||!id||id.length>300))fail('成员编号无效');
        item.participant_groups=(item.participant_groups||[]).map(role=>Object.assign({},role,link(role.member,role.member_id)));
        participants(item).forEach((name,index)=>{
          const id=participantIds(item)[index];
          const existing=item.participant_groups.find(role=>role.member_id===id);
          const activity=event.member_roles.find(role=>role.member_id===id);
          const first=(byId.get(id)||{}).groups||[];
          const legacy=names(item.affiliated_groups||item.affiliated_group);
          const fallback=declaredRoles.has(id)&&activity&&activity.group||legacy.length===1&&legacy[0]||activity&&activity.group||first[0]||'';
          if(existing&&activity&&existing.group&&existing.group!==activity.group)existing.override=true;
          if(!existing)item.participant_groups.push({member:name,member_id:id,group:fallback,...(activity&&activity.group!==fallback?{override:true}:{})});
          else if(upgrading&&!existing.group)existing.group=fallback;
          if(!activity)event.member_roles.push({member:name,member_id:id,group:(existing||item.participant_groups[item.participant_groups.length-1]).group});
          else if(upgrading&&!activity.group)activity.group=fallback;
        });
        if(item.photo_size!=null&&!['','3','5','other'].includes(item.photo_size))fail('拍立得尺寸无效');
        if(item.signature!=null&&!['','signed','unsigned'].includes(item.signature))fail('签名属性无效');
      }
      for(const key of ['ticket_type','session'])if(event[key]!=null&&(typeof event[key]!=='string'||event[key].length>100))fail('门票票种或场次格式无效');
      if(event.ticket_is_free!=null&&typeof event.ticket_is_free!=='boolean')fail('免费票标记无效');
      if(event.ticket_quantity!=null){const qty=Number(event.ticket_quantity);if(!Number.isInteger(qty)||qty<0||qty>1000000)fail('门票张数无效');event.ticket_quantity=qty;}
      const ticket=admission(event);
      if(!event.ticket_type||['未设票种','未设置','未指定'].includes(event.ticket_type.trim())){event.ticket_type=ticket.type;if(ticket.count)event.ticket_quantity=ticket.count;}
      event.ticket_is_free=ticket.free;
    }
  }
  function isPhysicalLocation(value) {
    const text=String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').toLowerCase();
    if(!text)return false;
    if(/^(?:[-—–_/\\|·.]+|线上(?:购买|[\/／、]邮寄)?|在线|网购|网络|邮寄|未统计|未记录|未填写|未指定(?:[\/／、]线上)?|未知(?:城市|场地)?|未知地点|未设置|未填|未标注|不详|待补充|未(?:指定|统计|记录|填写)(?:城市|场地|地点)|无|暂无|n\/?a|null|undefined)$/.test(text))return false;
    const parts=text.split(/[\/\\、|]+/).filter(Boolean);
    return !(parts.length>1&&parts.every(part=>!isPhysicalLocation(part)));
  }
  function benefitTypes(state) {
    return Object.assign({cheki:'普通切',signed:'签名切',unsigned:'无签切',online:'电切',theme:'主题切',homework:'宿题/主题',other:'其它特典'},Object.fromEntries((state.config.benefit_types||[]).map(type=>['custom:'+type.id,type.label])));
  }
  function isPhoto(item,state,event) {
    if(isPhone(item,event))return false;
    const format=form(item,event.event_type,event);
    return ['cheki','signed','unsigned','online','theme'].includes(format)||(state.config.benefit_types||[]).some(type=>'custom:'+type.id===format&&type.counts_as_photo);
  }
  function benefitLabel(item,state,event) {
    const format=form(item,event.event_type,event);
    const typeName=format==='phone'?'手机合影':(benefitTypes(state)[format]||item.benefit_label||'其它特典');
    return [typeName,item.photo_size?item.photo_size==='other'?'其它尺寸':item.photo_size+'寸':'',item.signature?item.signature==='signed'?'有签':'无签':'',item.is_theme&&format!=='theme'?'主题':''].filter(Boolean).join(' · ');
  }
  function validateEntityProfiles(input, withOrganizers, label) {
    if (!Array.isArray(input) || input.length > 2000) fail(label + '列表格式错误');
    const seen = new Set();
    return input.map(item => {
      if (!plain(item) || typeof item.name !== 'string') fail(label + '资料格式错误');
      const name = item.name.trim();
      if (!name || name.length > 300 || /[,，、;；\n]/.test(name) || seen.has(name)) fail(label + '名称无效或重复');
      seen.add(name);
      const avatar = validateAvatar(item.avatar, label + '头像');
      const note = item.note == null ? '' : item.note;
      if (typeof note !== 'string' || note.length > 2000) fail(label + '备注格式错误');
      const clean = { name, avatar, note };
      if (withOrganizers) {
        const orgs = names(item.organizers);
        if (orgs.some(o => o.length > 300)) fail('所属事务所名称过长');
        clean.organizers = orgs;
      }
      return clean;
    }).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }
  function budgetForMonth(config, month) {
    if (config && plain(config.monthly_budgets) && month && own(config.monthly_budgets, month)) return cents(config.monthly_budgets[month]);
    return cents(config && config.monthly_budget != null ? config.monthly_budget : 0);
  }
  function validatePreferences(config) {
    if(config.benefit_types!=null){
      if(!Array.isArray(config.benefit_types)||config.benefit_types.length>200)fail('自定义特典格式错误');
      const ids=new Set();
      for(const type of config.benefit_types){if(!plain(type)||typeof type.id!=='string'||!type.id||typeof type.label!=='string'||!type.label.trim()||type.label.length>100||ids.has(type.id))fail('自定义特典名称或编号无效');ids.add(type.id);type.label=type.label.trim();type.counts_as_photo=type.counts_as_photo===true;}
    }
    if(config.price_presets!=null){
      if(!Array.isArray(config.price_presets)||config.price_presets.length>1000)fail('价格预设格式错误');
      const ids=new Set();
      for(const preset of config.price_presets){
        if(!plain(preset)||typeof preset.id!=='string'||!preset.id||ids.has(preset.id)||!['all','member','group'].includes(preset.scope)||typeof preset.target!=='string'||typeof preset.format!=='string'||typeof preset.name!=='string'||!preset.name.trim())fail('价格预设内容无效');
        ids.add(preset.id);preset.price=amount(cents(preset.price));
        if(preset.scope!=='all'&&!preset.target)fail('请选择预设对应的成员或团体');
      }
    }
    if(config.theme!=null&&!['system','light','dark'].includes(config.theme))fail('主题设置无效');
    if(config.font_scale!=null&&![1,1.15,1.3].includes(config.font_scale))fail('字号设置无效');
    if(config.backup_reminder_days!=null&&![0,7,30].includes(config.backup_reminder_days))fail('备份提醒间隔无效');
    if(config.monthly_budgets!=null){
      if(!plain(config.monthly_budgets)||Object.keys(config.monthly_budgets).length>1200)fail('指定月预算格式错误');
      const normalized={};
      for(const [month,value]of Object.entries(config.monthly_budgets)){
        if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1)fail('预算月份格式须为 YYYY-MM');
        normalized[month]=amount(cents(value));
      }
      config.monthly_budgets=normalized;
    }
    if(config.organizers!=null){
      if(!Array.isArray(config.organizers)||config.organizers.length>1000)fail('事务所列表格式错误');
      config.organizers=names(config.organizers.map(name=>{if(typeof name!=='string'||!name.trim()||name.trim().length>300)fail('事务所名称无效');return name.trim();}));
    }
    if(config.organizer_profiles!=null)config.organizer_profiles=validateEntityProfiles(config.organizer_profiles,false,'事务所');
    if(config.group_profiles!=null)config.group_profiles=validateEntityProfiles(config.group_profiles,true,'团体');
  }
  function presetPrice(state,options) {
    return (state.config.price_presets||[]).filter(preset=>preset.format===options.format&&(!preset.size||preset.size===options.size)&&(!preset.signature||preset.signature===options.signature)&&(!preset.themed||options.themed)&&
      (preset.scope==='all'||preset.scope==='member'&&preset.target===options.member||preset.scope==='group'&&preset.target===options.group))
      .sort((a,b)=>({member:3,group:2,all:1}[b.scope]-{member:3,group:2,all:1}[a.scope])||Number(!!b.size)+Number(!!b.signature)+Number(!!b.themed)-Number(!!a.size)-Number(!!a.signature)-Number(!!a.themed))[0]||null;
  }
  function renameMember(state,id,name) {
    const profile=resolveMember(state,id),oldName=profile.name;
    const index=state.members.findIndex(member=>member.id===profile.id);
    profile.name=name;profile.aliases=names([...(profile.aliases||[]),oldName]).filter(alias=>alias!==name);
    if(index<0)state.members.push(profile);else state.members[index]=profile;
    for(const event of state.records){
      for(const role of event.member_roles||[])if(role.member_id===profile.id)role.member=name;
      for(const item of event.interactions){
        if((kind(item)==='individual'||(kind(item)==='phone'&&!isGroupItem(item)))&&item.member_id===profile.id)item.member=name;
        if(kind(item)==='multi')item.members=item.members.map((member,index)=>item.member_ids[index]===profile.id?name:member);
        if(kind(item)==='merch'&&Array.isArray(item.merch_member_ids))item.merch_members=(item.merch_members||[]).map((member,index)=>item.merch_member_ids[index]===profile.id?name:member);
        for(const role of item.participant_groups||[])if(role.member_id===profile.id)role.member=name;
      }
    }
    catalogCache.delete(state);
    return state;
  }
  function mergeMember(state,sourceId,targetId) {
    state=validateState(state);
    if(sourceId===targetId)fail('请选择另一位成员');
    const source=resolveMember(state,sourceId),target=resolveMember(state,targetId);
    if(!memberCatalog(state).some(profile=>profile.id===sourceId)||!memberCatalog(state).some(profile=>profile.id===targetId))fail('成员已不存在');
    function roles(list){const result=new Map();for(const role of list||[]){const updated=Object.assign({},role);if(updated.member_id===sourceId){updated.member_id=targetId;updated.member=target.name;}if(!result.has(updated.member_id)||role.member_id===targetId)result.set(updated.member_id,updated);}return Array.from(result.values());}
    for(const event of state.records){
      event.member_roles=roles(event.member_roles);
      for(const item of event.interactions){
        if((kind(item)==='individual'||(kind(item)==='phone'&&!isGroupItem(item)))&&item.member_id===sourceId){item.member_id=targetId;item.member=target.name;}
        if(kind(item)==='multi'){
          const entries=new Map();item.member_ids.forEach((id,index)=>{const key=id===sourceId?targetId:id;if(!entries.has(key))entries.set(key,key===targetId?target.name:item.members[index]);});
          item.member_ids=Array.from(entries.keys());item.members=Array.from(entries.values());
          if(item.member_ids.length===1){item.cheki_type='individual';item.member_id=item.member_ids[0];item.member=item.members[0];delete item.member_ids;delete item.members;}
        }
        if(kind(item)==='merch'&&Array.isArray(item.merch_member_ids)){
          const mEntries=new Map();
          item.merch_member_ids.forEach((id,index)=>{const key=id===sourceId?targetId:id;if(!mEntries.has(key))mEntries.set(key,key===targetId?target.name:(item.merch_members||[])[index]||target.name);});
          item.merch_member_ids=Array.from(mEntries.keys());item.merch_members=Array.from(mEntries.values());
        }
        item.participant_groups=roles(item.participant_groups);
      }
    }
    target.groups=names([...target.groups,...source.groups]);target.aliases=names([...target.aliases,...source.aliases,source.name]).filter(name=>name!==target.name);
    if(!target.avatar)target.avatar=source.avatar;
    if(target.first_met&&source.first_met)target.first_met=target.first_met<=source.first_met?target.first_met:source.first_met;else target.first_met=target.first_met||source.first_met||'';
    target.social_accounts=Array.from(new Map([...(target.social_accounts||[]),...(source.social_accounts||[])].map(account=>[account.platform+'\u0000'+account.account,account])).values());
    if(target.social_accounts.length>32)fail('合并后社媒超过 32 条，请先整理重复或不需要的账号');
    if(source.note&&source.note!==target.note)target.note=target.note?target.note+'\n\n合并档案「'+source.name+'」的备注\n'+source.note:source.note;
    state.members=state.members.filter(profile=>profile.id!==sourceId&&profile.id!==targetId);state.members.push(target);
    for(const preset of state.config.price_presets||[])if(preset.scope==='member'&&preset.target===sourceId)preset.target=targetId;
    catalogCache.delete(state);
    return validateState(state);
  }
  function memberSummary(state,key,options) {
    const profile=resolveMember(state,key),rows=interactionRows(state,Object.assign({},options,{member:profile.id}));
    const metric=memberMetrics(state,options).find(row=>row.id===profile.id)||{count:0,cost:0};
    const forms=new Map(),months=new Map(),days=new Set();
    for(const row of rows){
      const month=row.date.slice(0,7);days.add(row.date.slice(0,10));
      if(isPhone(row.item,row.event))continue;
      const label=benefitLabel(row.item,state,row.event);
      forms.set(label,(forms.get(label)||0)+count(row.item));months.set(month,(months.get(month)||0)+count(row.item));
    }
    return {count:metric.count,phoneCount:metric.phone_count||0,cost:metric.cost,records:rows.length,days:days.size,average:rows.length?Math.round(metric.cost/rows.length):0,first:rows.length?rows[rows.length-1].date:'',latest:rows.length?rows[0].date:'',forms:Array.from(forms,([name,count])=>({name,count})),months:Array.from(months,([name,count])=>({name,count})).sort((a,b)=>b.name.localeCompare(a.name))};
  }
  function groupSummary(state,name,options) {
    const rows=interactionRows(state,Object.assign({},options,{group:name}));let cost=0,shared=0;const members=new Map();
    for(const row of rows){
      const amount=itemTotal(row.item);cost=safe(cost+amount);
      if(isGroupItem(row.item)){shared=safe(shared+amount);continue;}
      const ids=participantIds(row.item);
      ids.forEach((id,index)=>{if(!identityGroups(row.item,state,row.event,id).includes(name))return;const share=Math.floor(amount/ids.length)+(index<amount%ids.length?1:0);shared=safe(shared+share);if(!members.has(id))members.set(id,{id,name:resolveMember(state,id).name,count:0,cost:0});const member=members.get(id);member.count+=count(row.item);member.cost+=share;});
    }
    return {records:rows.length,cost,shared,members:Array.from(members.values()).sort((a,b)=>b.count-a.count||b.cost-a.cost||a.id.localeCompare(b.id))};
  }
  function admission(event) {
    const cost=safe(cents(event.ticket_fee||0)+cents(event.drink_fee||0));
    const named=typeof event.ticket_type==='string'&&event.ticket_type.trim()&&!['未设票种','未设置','未指定'].includes(event.ticket_type.trim());
    const present=cost>0||event.ticket_quantity>0||!named&&(event.event_type||'performance')==='performance';
    return {cost,count:present?(event.ticket_quantity>0?event.ticket_quantity:1):0,free:cost===0,type:named?event.ticket_type.trim():cost>0?'付费':'免费'};
  }
  function ticketSummary(records) {
    let quantity=0,free=0,cost=0;const types=new Map();
    for(const event of records){const ticket=admission(event);if(!ticket.count)continue;quantity+=ticket.count;if(ticket.free)free+=ticket.count;cost+=ticket.cost;if(!types.has(ticket.type))types.set(ticket.type,{name:ticket.type,count:0,cost:0});types.get(ticket.type).count+=ticket.count;types.get(ticket.type).cost+=ticket.cost;}
    return {quantity,free,paid:quantity-free,cost,types:Array.from(types.values())};
  }
  function calendarSummary(state,month) {
    const days=new Map();
    function day(date){if(!days.has(date))days.set(date,{date,events:[],interactions:[],total:0,photos:0});return days.get(date);}
    for(const event of state.records){if(event.date.slice(0,7)===month){const target=day(event.date);target.events.push(event);target.total+=eventTotal(event);}}
    for(const row of interactionRows(state)){const date=row.date.slice(0,10);if(date.slice(0,7)!==month)continue;const target=day(date);target.interactions.push(row);if(isPhoto(row.item,state,row.event))target.photos+=count(row.item);}
    return Array.from(days.values()).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function annualSummary(state,year) {
    if(!/^\d{4}$/.test(String(year))||Number(year)<1)fail('请输入有效年份');
    const start=year+'-01-01',end=year+'-12-31',records=filterRecords(state.records,{start,end}),summary=stats(records),monthly=new Map();
    for(const event of records){const month=event.date.slice(0,7);monthly.set(month,(monthly.get(month)||0)+eventTotal(event));}
    const first=new Map();for(const row of interactionRows(state,{order:'oldest'}))for(const id of participantIds(row.item))if(!first.has(id))first.set(id,row.date.slice(0,10));
    return {year,stats:summary,tickets:ticketSummary(records),cities:summary.cities.length,days:new Set(records.map(event=>event.date)).size,members:memberMetrics(state,{start,end}).filter(member=>member.count>0||member.phone_count>0),newMembers:Array.from(first).filter(([,date])=>date>=start&&date<=end).map(([id])=>resolveMember(state,id)),months:Array.from(monthly,([name,cost])=>({name,cost})).sort((a,b)=>b.cost-a.cost||a.name.localeCompare(b.name))};
  }
  function eventOrganizers(event) {
    return names(event.organizers == null ? event.organizer : event.organizers);
  }
  function organizerCatalog(state) {
    const configured = Array.isArray(state.config && state.config.organizers) ? state.config.organizers : [];
    const profiled = ((state.config && state.config.organizer_profiles) || []).map(profile => profile.name);
    const affiliated = ((state.config && state.config.group_profiles) || []).flatMap(profile => profile.organizers || []);
    const recorded = (state.records || []).flatMap(e => [...eventOrganizers(e), ...(e.interactions || []).flatMap(it => names(it.merch_organizers))]);
    return names([...configured, ...profiled, ...affiliated, ...recorded]).sort((a, b) => a.localeCompare(b, 'zh'));
  }
  function organizerProfile(state, name) {
    const found = ((state.config && state.config.organizer_profiles) || []).find(profile => profile.name === name);
    return found ? clone(found) : { name: String(name || ''), avatar: '', note: '' };
  }
  function groupProfile(state, name) {
    const found = ((state.config && state.config.group_profiles) || []).find(profile => profile.name === name);
    return found ? clone(found) : { name: String(name || ''), avatar: '', note: '', organizers: [] };
  }
  function validEntityName(name, label) {
    const clean = String(name || '').trim();
    if (!clean) fail('请填写' + label + '名称');
    if (clean.length > 300) fail(label + '名称过长');
    if (/[,，、;；\n]/.test(clean)) fail(label + '名称不能包含逗号或分号分隔符');
    return clean;
  }
  function mergeProfileNote(targetNote, sourceNote) {
    if (!sourceNote || sourceNote === targetNote) return targetNote || '';
    return targetNote ? targetNote + '\n' + sourceNote : sourceNote;
  }
  function upsertEntityProfile(list, profile) {
    const next = list.filter(item => item.name !== profile.name);
    next.push(profile);
    return next;
  }
  function renameOrganizer(state, oldName, newName) {
    state = validateState(state);
    const oldKey = String(oldName || '').trim();
    const nextName = validEntityName(newName, '事务所');
    if (!oldKey) fail('请填写事务所名称');
    if (oldKey === nextName) fail('新名称与原名称相同');
    let updated = 0;
    for (const event of state.records) {
      let eventChanged = false;
      const current = eventOrganizers(event);
      if (current.includes(oldKey)) {
        const replaced = names(current.map(name => (name === oldKey ? nextName : name)));
        event.organizers = replaced;
        event.organizer = replaced.join('，');
        eventChanged = true;
      }
      for (const item of event.interactions || []) {
        const mOrgs = names(item.merch_organizers);
        if (mOrgs.includes(oldKey)) {
          item.merch_organizers = names(mOrgs.map(name => (name === oldKey ? nextName : name)));
          eventChanged = true;
        }
      }
      if (eventChanged) updated++;
    }
    if (Array.isArray(state.config.organizers)) {
      state.config.organizers = names(state.config.organizers.map(name => (name === oldKey ? nextName : name)));
    }
    const orgProfiles = state.config.organizer_profiles || [];
    const oldProfile = orgProfiles.find(profile => profile.name === oldKey);
    if (oldProfile) {
      const targetProfile = orgProfiles.find(profile => profile.name === nextName) || { name: nextName, avatar: '', note: '' };
      targetProfile.avatar = targetProfile.avatar || oldProfile.avatar || '';
      targetProfile.note = mergeProfileNote(targetProfile.note, oldProfile.note);
      state.config.organizer_profiles = upsertEntityProfile(orgProfiles.filter(profile => profile.name !== oldKey), targetProfile);
    }
    if (Array.isArray(state.config.group_profiles)) {
      for (const group of state.config.group_profiles) {
        if ((group.organizers || []).includes(oldKey)) {
          group.organizers = names(group.organizers.map(org => (org === oldKey ? nextName : org)));
        }
      }
    }
    return { state: validateState(state), updated };
  }
  function saveOrganizerProfile(state, originalName, updates) {
    let working = validateState(state);
    const nextName = validEntityName(updates.name, '事务所');
    const oldKey = String(originalName || '').trim();
    let updated = 0;
    if (oldKey && oldKey !== nextName) {
      const renamed = renameOrganizer(working, oldKey, nextName);
      working = renamed.state;
      updated = renamed.updated;
    } else {
      working.config.organizers = names([...(working.config.organizers || []), nextName]);
    }
    const existing = organizerProfile(working, nextName);
    const nextProfile = {
      name: nextName,
      avatar: updates.avatar != null ? updates.avatar : existing.avatar,
      note: updates.note != null ? String(updates.note) : existing.note,
    };
    working.config.organizer_profiles = upsertEntityProfile(working.config.organizer_profiles || [], nextProfile);
    return { state: validateState(working), name: nextName, updated };
  }
  function renameGroup(state, oldName, newName) {
    state = validateState(state);
    const oldKey = String(oldName || '').trim();
    const nextName = validEntityName(newName, '团体');
    if (!oldKey) fail('请填写团体名称');
    if (oldKey === nextName) fail('新名称与原名称相同');
    let updated = 0;
    for (const member of state.members) {
      if ((member.groups || []).includes(oldKey)) {
        member.groups = names(member.groups.map(group => (group === oldKey ? nextName : group)));
        updated++;
      }
    }
    for (const event of state.records) {
      let eventChanged = false;
      if (Array.isArray(event.performing_groups) && event.performing_groups.includes(oldKey)) {
        event.performing_groups = names(event.performing_groups.map(group => (group === oldKey ? nextName : group)));
        eventChanged = true;
      }
      for (const role of event.member_roles || []) {
        if (role.group === oldKey) { role.group = nextName; eventChanged = true; }
      }
      for (const item of event.interactions || []) {
        if (isGroupItem(item) && item.group_name === oldKey) { item.group_name = nextName; eventChanged = true; }
        const aff = names(item.affiliated_groups || item.affiliated_group);
        if (aff.includes(oldKey)) {
          const nextAff = names(aff.map(group => (group === oldKey ? nextName : group)));
          if (item.affiliated_groups != null) item.affiliated_groups = nextAff;
          if (item.affiliated_group != null) item.affiliated_group = nextAff.join('，');
          eventChanged = true;
        }
        for (const role of item.participant_groups || []) {
          if (role.group === oldKey) { role.group = nextName; eventChanged = true; }
        }
      }
      if (eventChanged) updated++;
    }
    for (const preset of state.config.price_presets || []) {
      if (preset.scope === 'group' && preset.target === oldKey) preset.target = nextName;
    }
    const groupProfiles = state.config.group_profiles || [];
    const oldProfile = groupProfiles.find(profile => profile.name === oldKey);
    if (oldProfile) {
      const targetProfile = groupProfiles.find(profile => profile.name === nextName) || { name: nextName, avatar: '', note: '', organizers: [] };
      targetProfile.avatar = targetProfile.avatar || oldProfile.avatar || '';
      targetProfile.organizers = names([...(targetProfile.organizers || []), ...(oldProfile.organizers || [])]);
      targetProfile.note = mergeProfileNote(targetProfile.note, oldProfile.note);
      state.config.group_profiles = upsertEntityProfile(groupProfiles.filter(profile => profile.name !== oldKey), targetProfile);
    }
    catalogCache.delete(state);
    return { state: validateState(state), updated };
  }
  function saveGroupProfile(state, originalName, updates) {
    let working = validateState(state);
    const nextName = validEntityName(updates.name, '团体');
    const oldKey = String(originalName || '').trim();
    let updated = 0;
    if (oldKey && oldKey !== nextName) {
      const renamed = renameGroup(working, oldKey, nextName);
      working = renamed.state;
      updated = renamed.updated;
    }
    const existing = groupProfile(working, nextName);
    const nextProfile = {
      name: nextName,
      avatar: updates.avatar != null ? updates.avatar : existing.avatar,
      note: updates.note != null ? String(updates.note) : existing.note,
      organizers: updates.organizers != null ? names(updates.organizers) : (existing.organizers || []),
    };
    working.config.group_profiles = upsertEntityProfile(working.config.group_profiles || [], nextProfile);
    return { state: validateState(working), name: nextName, updated };
  }
  function setOrganizerEvents(state, organizerName, selectedIds) {
    const cleanOrg = validEntityName(organizerName, '事务所');
    const working = validateState(state);
    const chosen = new Set(selectedIds || []);
    let updated = 0;
    for (const event of working.records) {
      const current = eventOrganizers(event);
      const hasOrg = current.includes(cleanOrg);
      const wantOrg = chosen.has(event.id);
      if (hasOrg === wantOrg) continue;
      const nextOrgs = wantOrg ? names([...current, cleanOrg]) : current.filter(name => name !== cleanOrg);
      event.organizers = nextOrgs;
      event.organizer = nextOrgs.join('，');
      updated++;
    }
    working.config.organizers = names([...(working.config.organizers || []), cleanOrg]);
    return { state: validateState(working), updated };
  }
  function setOrganizerGroups(state, organizerName, selectedGroups) {
    const cleanOrg = validEntityName(organizerName, '事务所');
    const working = validateState(state);
    const chosen = new Set(names(selectedGroups || []));
    const allGroups = names([...groupCatalog(working), ...chosen]);
    let profiles = working.config.group_profiles || [];
    let updated = 0;
    for (const groupName of allGroups) {
      const existing = profiles.find(profile => profile.name === groupName) || { name: groupName, avatar: '', note: '', organizers: [] };
      const currentOrgs = existing.organizers || [];
      const hasOrg = currentOrgs.includes(cleanOrg);
      const wantOrg = chosen.has(groupName);
      if (hasOrg === wantOrg) continue;
      existing.organizers = wantOrg ? names([...currentOrgs, cleanOrg]) : currentOrgs.filter(name => name !== cleanOrg);
      profiles = upsertEntityProfile(profiles, existing);
      updated++;
    }
    working.config.group_profiles = profiles;
    working.config.organizers = names([...(working.config.organizers || []), cleanOrg]);
    return { state: validateState(working), updated };
  }
  function normalizeRoles(input) {
    if (!Array.isArray(input)) fail('成员活动身份须为列表');
    const seen = new Set();
    return input.map(role => {
      if (!plain(role) || typeof role.member !== 'string' || typeof role.group !== 'string') fail('成员活动身份格式错误');
      const member = role.member.trim(), group = role.group.trim();
      if (!member || member.length > 300 || group.length > 300 || seen.has(role.member_id || member)) fail('成员活动身份重复或名称过长');
      seen.add(role.member_id || member);
      if(role.member_id!=null&&(typeof role.member_id!=='string'||!role.member_id||role.member_id.length>300))fail('身份成员编号无效');
      return Object.assign({member,group},role.member_id?{member_id:role.member_id}:{},role.override?{override:true}:{});
    });
  }
  function identityGroups(item,state,event,member) {
    const profile=resolveMember(state,member);
    const match=role=>roleMatches(role,profile.id)||!role.member_id&&role.member===profile.name;
    const recorded=(item.participant_groups||[]).find(match);
    if(recorded)return recorded.group?[recorded.group]:[];
    const activity=(event&&event.member_roles||[]).find(match);
    if(activity)return activity.group?[activity.group]:[];
    const explicit=names(item.affiliated_groups||item.affiliated_group);
    return explicit.length?explicit:profile.groups.slice(0,1);
  }
  function preferredIdentity(item,state,event,member) {
    const profile=resolveMember(state,member),match=role=>roleMatches(role,profile.id)||!role.member_id&&role.member===profile.name;
    const recorded=(item.participant_groups||[]).find(match),activity=(event.member_roles||[]).find(match);
    if(recorded)return recorded.group;
    if(activity)return activity.group;
    const groups=identityGroups(item,state,event,member);
    return groups[0]||memberGroups(state,member)[0]||'';
  }
  function interactionGroups(item, state, event) {
    if (isGroupItem(item)) return names(item.group_name);
    return names(participantIds(item).flatMap(member => identityGroups(item, state, event, member)));
  }
  function interactionRows(state, options) {
    options = options || {};
    const rows = [];
    state.records.forEach((event, eventIndex) => (event.interactions || []).forEach((item, itemIndex) => {
      if (kind(item) === 'merch') return;
      if (options.photosOnly && !isPhoto(item,state,event)) return;
      if (options.member && !participantIds(item).includes(resolveMember(state,options.member).id)) return;
      if (options.group && !(options.member ? identityGroups(item, state, event, options.member) : interactionGroups(item, state, event)).includes(options.group)) return;
      const date = item.shot_at || event.date;
      const periodDate = options.dateBasis === 'activity' ? event.date : date.slice(0, 10);
      if (options.start && periodDate < options.start || options.end && periodDate > options.end) return;
      if (options.query && !search({ event, item,profiles:participantIds(item).map(id=>resolveMember(state,id)) }, options.query, options.pinyin)) return;
      rows.push({ event, item, eventIndex, itemIndex, date, groups: interactionGroups(item, state, event) });
    }));
    const direction = options.order === 'oldest' ? 1 : -1;
    return rows.sort((a, b) => direction * (a.date.localeCompare(b.date) || String(a.item.created_at || '').localeCompare(String(b.item.created_at || '')) || b.eventIndex - a.eventIndex || a.itemIndex - b.itemIndex));
  }
  function form(item, eventType, event) {
    if(kind(item)==='phone')return 'phone';
    const saved = item.benefit_format;
    const legacyHomework = saved === 'homework' || !saved && (eventType === 'theme_homework' || item.type === 'theme_homework');
    const description = [event && event.event_name, item.note].filter(value => typeof value === 'string').join(' ');
    if (legacyHomework && /主题\s*(?:切|拍立得|cheki)/i.test(description)) return 'theme';
    return saved || (eventType === 'theme_homework' || item.type === 'theme_homework' ? 'homework' : eventType === 'online_cheki' ? 'online' : 'cheki');
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
  function validateAttachments(value) {
    if(value==null)return [];
    if(!Array.isArray(value)||value.length>20)fail('每条记录最多保存 20 个照片或视频');
    const ids=new Set();
    return value.map(photo=>{
      if(!plain(photo)||typeof photo.id!=='string'||!photo.id||photo.id.length>300||ids.has(photo.id)||typeof photo.data!=='string')fail('媒体格式无效或超过大小限制');
      const isLocalMedia=/^https:\/\/idol\.local\/photos\/[0-9a-f]{64}\.(?:jpg|png|webp|mp4|webm|mov|mkv|3gp|m4v)$/.test(photo.data);
      const isImageData=photo.data.length<=700000&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo.data);
      const isVideoData=photo.data.length<=15000000&&/^data:video\/(?:mp4|webm|quicktime|x-matroska|3gpp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo.data);
      if(!isLocalMedia&&!isImageData&&!isVideoData)fail('媒体格式无效或超过大小限制');
      if(photo.media_type!=null&&!['image','video'].includes(photo.media_type))fail('媒体类型无效');
      ids.add(photo.id);
      if(photo.caption!=null&&(typeof photo.caption!=='string'||photo.caption.length>500))fail('照片说明过长');
      return Object.assign({id:photo.id,data:photo.data,caption:photo.caption||''},photo.media_type?{media_type:photo.media_type}:{});
    });
  }
  function normalizeRecords(records) {
    if (!Array.isArray(records)) fail('记录文件必须是活动列表');
    const ids = new Set();
    const generated = new Map();
    const result = records.map((event, index) => {
      if (!plain(event)) fail('第 ' + (index + 1) + ' 条活动格式错误');
      validDate(event.date);
      if(event.attachments!=null)event.attachments=validateAttachments(event.attachments);
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
      if (event.organizer != null && (typeof event.organizer !== 'string' || event.organizer.length > 2000)) fail('主办事务所格式错误');
      if (event.organizers != null) { event.organizers = names(event.organizers); if (event.organizers.some(name => name.length > 300)) fail('主办事务所名称过长'); }
      if (event.member_roles != null) event.member_roles = normalizeRoles(event.member_roles);
      if (event.performing_groups != null) event.performing_groups = names(event.performing_groups);
      if (typeof event.event_type !== 'string') fail('活动类型无效');
      for (const key of ['ticket_fee', 'drink_fee']) event[key] = amount(cents(event[key] == null ? 0 : event[key]));
      if (event.interactions === undefined) event.interactions = [];
      if (!Array.isArray(event.interactions)) fail('消费明细必须为列表');
      const itemIds = new Set();
      for (const item of event.interactions) {
        if (!plain(item)) fail('消费明细格式错误');
        if(item.attachments!=null)item.attachments=validateAttachments(item.attachments);
        // Delivery tracking was removed in 1.1.0. Its legacy fields are opaque
        // compatibility data and remain unchanged in migrations and backups.
        if (item.id != null) {
          if (typeof item.id !== 'string' || !item.id || item.id.length > 512 || itemIds.has(item.id)) fail('消费明细 ID 无效或重复');
          itemIds.add(item.id);
        }
        if (kind(item) === 'multi') {
          item.members = Array.isArray(item.member_ids) ? item.members.map(String) : names(item.members);
          if (item.members.length < 2) fail('多人特典至少选择两位不同成员');
        }
        if (kind(item) === 'phone' && item.cheki_type === 'group' && item.group_name && item.member === '未知成员') {
          delete item.member;
          delete item.member_id;
          if (Array.isArray(item.participant_groups) && item.participant_groups.every(role => role && role.member === '未知成员')) {
            delete item.participant_groups;
          }
        }
        if (item.shot_at) {
          if (typeof item.shot_at !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(item.shot_at)) fail('拍摄时间格式错误');
          validDate(item.shot_at.slice(0, 10));
        }
        if (item.participant_groups != null) {
          item.participant_groups = normalizeRoles(item.participant_groups);
          if (item.participant_groups.some(role => !participants(item).includes(role.member))) fail('身份信息中的成员不在本条互动中');
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
    if (state.version != null && ![1, 2, 3, 4, 5, 6, SCHEMA_VERSION].includes(state.version)) fail('暂不支持此备份版本');
    const upgrading = !state.version || state.version < SCHEMA_VERSION;
    state.format = FORMAT;
    state.version = SCHEMA_VERSION;
    state.app_version = APP_VERSION;
    state.records = normalizeRecords(state.records);
    state.members = validateMembers(state.members);
    normalizeMemberLinks(state,upgrading);
    if (state.config == null) state.config = {};
    if (!plain(state.config)) fail('设置格式错误');
    if (state.config.monthly_budget != null) state.config.monthly_budget = amount(cents(state.config.monthly_budget));
    state.config.backup_reminder_days=0;
    validatePreferences(state.config);
    if (state.assets == null) state.assets = { images: {} };
    if (!plain(state.assets)) fail('附件格式错误');
    state.assets.images = {};
    stats(state.records);
    return state;
  }
  function createEmptyState() {
    return { format: FORMAT, version: SCHEMA_VERSION, app_version: APP_VERSION, records: [], members: [], config: { monthly_budget: 0, backup_reminder_days: 0 }, assets: { images: {} } };
  }
  function isVersionAtLeast120(versionText) {
    if (typeof versionText !== 'string') return false;
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(versionText.trim());
    if (!match) return false;
    const major = Number(match[1]), minor = Number(match[2]);
    return major > 1 || (major === 1 && minor >= 2);
  }
  function parseBackup(text, options) {
    if (typeof text !== 'string') fail('备份内容必须为文本');
    if (text.length > 50 * 1024 * 1024) fail('备份文件超过 50 MB 限制');
    let data;
    try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) { fail('备份不是有效的 JSON 文件'); }
    const allowLegacy = plain(options) && options.allowLegacy === true;
    if (Array.isArray(data)) {
      fail('已停止支持桌面记录列表，请导入 v1.2.0 及以上版本的手机完整备份');
    }
    if (!allowLegacy) {
      if (!plain(data) || data.format !== FORMAT || data.version !== SCHEMA_VERSION || (data.app_version != null && !isVersionAtLeast120(data.app_version))) {
        fail('仅支持导入 v1.2.0 及以上版本的手机完整备份');
      }
    }
    return validateState(data);
  }
  function stats(records) {
    const out = { total: 0, ticket: 0, drink: 0, benefit: 0, phone: 0, merch: 0, eventCount: records.length, interactionCount: 0, ticketCount: 0, phoneCount: 0, merchCount: 0, merchRanking: [], eventTypes: {}, ranking: [], venues: [], cities: [], forms: {} };
    const types = new Map(), ranks = new Map(), merchandise = new Map(), venues = new Map(), cities = new Map(), forms = new Map();
    for (const event of records) {
      out.ticket = safe(out.ticket + cents(event.ticket_fee == null ? 0 : event.ticket_fee));
      out.drink = safe(out.drink + cents(event.drink_fee == null ? 0 : event.drink_fee));
      const eventType = event.event_type || 'performance';
      types.set(eventType, (types.get(eventType) || 0) + 1);
      const city = String(event.city || '未知城市'), venue = String(event.venue || '未知场地');
      const venueKey = city + '\u0000' + venue;
      if (!cities.has(city)) cities.set(city, { name: city, cost: 0, count: 0, last_date: '' });
      if (!venues.has(venueKey)) venues.set(venueKey, { name: venue, city, cost: 0, count: 0, last_date: '' });
      for (const row of [cities.get(city), venues.get(venueKey)]) {
        row.cost = safe(row.cost + eventTotal(event));
        row.count++;
        if (event.date > row.last_date) row.last_date = event.date;
      }
      for (const item of event.interactions || []) {
        const k = kind(item), cost = itemTotal(item), n = count(item), phone = isPhone(item, event);
        out.interactionCount++;
        out[k === 'merch' ? 'merch' : phone ? 'phone' : 'benefit'] = safe(out[k === 'merch' ? 'merch' : phone ? 'phone' : 'benefit'] + cost);
        if (k === 'merch') {
          out.merchCount = safe(out.merchCount + n);
          const name = String(item.item_name || '未命名商品');
          if (!merchandise.has(name)) merchandise.set(name, { name, cost: 0, count: 0 });
          const product = merchandise.get(name);
          product.cost = safe(product.cost + cost);
          product.count = safe(product.count + n);
        }
        if (k !== 'merch') {
          if (phone) out.phoneCount = safe(out.phoneCount + n);
          else {
            out.ticketCount = safe(out.ticketCount + n);
            const format = String(form(item, eventType, event));
            if (!forms.has(format)) forms.set(format, { cost: 0, count: 0 });
            const formatRow = forms.get(format);
            formatRow.cost = safe(formatRow.cost + cost);
            formatRow.count = safe(formatRow.count + n);
          }
          const groupTarget = isGroupItem(item);
          const memberNames = groupTarget ? [String(item.group_name || '未知团体')] : participants(item);
          memberNames.forEach((name, index) => {
            const rankKind = groupTarget ? 'group' : 'individual';
            const memberId=rankKind==='individual'?participantIds(item)[index]:name;
            const key = rankKind + '\u0000' + memberId;
            if (!ranks.has(key)) ranks.set(key, { id:memberId,name, kind: rankKind, cost: 0, count: 0, last_date: '' });
            const row = ranks.get(key);
            // Split shared photo cost in integer cents while counting participation for every member.
            const share = Math.floor(cost / memberNames.length) + (index < cost % memberNames.length ? 1 : 0);
            row.cost = safe(row.cost + share);
            if(phone)row.phone_count=(row.phone_count||0)+n;else row.count = safe(row.count + n);
            const date = item.shot_at ? item.shot_at.slice(0, 10) : event.date;
            if (date > row.last_date) row.last_date = date;
          });
        }
      }
    }
    for (const [key, value] of types) Object.defineProperty(out.eventTypes, key, { value, enumerable: true, writable: true, configurable: true });
    for (const [key, value] of forms) Object.defineProperty(out.forms, key, { value, enumerable: true, writable: true, configurable: true });
    out.total = safe(out.ticket + out.drink + out.benefit + out.phone + out.merch);
    out.ranking = Array.from(ranks.values()).sort((a, b) => b.count - a.count || b.cost - a.cost || b.last_date.localeCompare(a.last_date) || a.name.localeCompare(b.name, 'zh'));
    out.merchRanking = Array.from(merchandise.values()).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'zh'));
    out.cities = Array.from(cities.values()).filter(row=>isPhysicalLocation(row.name)).sort((a, b) => b.cost - a.cost || b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    out.venues = Array.from(venues.values()).filter(row=>isPhysicalLocation(row.name)).sort((a, b) => b.cost - a.cost || b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return out;
  }
  function entitySpendingSummary(state, records) {
    const membersMap = new Map(), groupsMap = new Map(), orgsMap = new Map();
    const ensure = (map, id, name) => {
      if (!map.has(id)) map.set(id, { id, name, cost: 0, count: 0, chekiCount: 0, phoneCount: 0, merchCount: 0, eventCount: 0 });
      return map.get(id);
    };
    const splitAdd = (map, keys, totalCents, getName, updater) => {
      if (!keys.length) return;
      const n = keys.length;
      keys.forEach((key, idx) => {
        const share = Math.floor(totalCents / n) + (idx < totalCents % n ? 1 : 0);
        const row = ensure(map, key, getName(key));
        row.cost = safe(row.cost + share);
        if (updater) updater(row, share, idx === 0);
      });
    };
    for (const event of records || []) {
      const evOrgs = eventOrganizers(event);
      const seenEventOrgs = new Set();
      let baseEventCost = safe(cents(event.ticket_fee == null ? 0 : event.ticket_fee) + cents(event.drink_fee == null ? 0 : event.drink_fee));
      for (const item of event.interactions || []) {
        const k = kind(item), total = itemTotal(item), qty = count(item), phone = isPhone(item, event);
        if (k === 'merch') {
          const mIds = Array.isArray(item.merch_member_ids) && item.merch_member_ids.length
            ? item.merch_member_ids
            : names(item.merch_members).map(n => resolveMember(state, n).id);
          splitAdd(membersMap, mIds, total, id => memberLabel(resolveMember(state, id), state), r => { r.merchCount += qty; r.count += qty; });
          const mGroups = names(item.affiliated_groups || item.affiliated_group);
          splitAdd(groupsMap, mGroups, total, g => g, r => { r.merchCount += qty; r.count += qty; });
          const mOrgs = names(item.merch_organizers);
          if (mOrgs.length) {
            splitAdd(orgsMap, mOrgs, total, o => o, r => { r.merchCount += qty; r.count += qty; });
          } else {
            baseEventCost = safe(baseEventCost + total);
          }
          continue;
        }
        baseEventCost = safe(baseEventCost + total);
        if (isGroupItem(item)) {
          const gName = String(item.group_name || '未知团体');
          const gRow = ensure(groupsMap, gName, gName);
          gRow.cost = safe(gRow.cost + total);
          if (phone) gRow.phoneCount += qty; else gRow.chekiCount += qty;
          gRow.count += qty;
        } else {
          const ids = participantIds(item);
          ids.forEach((id, idx) => {
            const share = Math.floor(total / ids.length) + (idx < total % ids.length ? 1 : 0);
            const prof = resolveMember(state, id);
            const mRow = ensure(membersMap, id, memberLabel(prof, state));
            mRow.cost = safe(mRow.cost + share);
            if (phone) mRow.phoneCount += qty; else mRow.chekiCount += qty;
            mRow.count += qty;
            const gList = identityGroups(item, state, event, id);
            splitAdd(groupsMap, gList, share, g => g, gRow => {
              if (phone) gRow.phoneCount += qty; else gRow.chekiCount += qty;
              gRow.count += qty;
            });
          });
        }
      }
      if (evOrgs.length) {
        splitAdd(orgsMap, evOrgs, baseEventCost, o => o, r => {
          if (!seenEventOrgs.has(r.id)) { r.eventCount++; r.count++; seenEventOrgs.add(r.id); }
        });
      }
    }
    const sortRows = map => Array.from(map.values())
      .filter(r => r.cost > 0 || r.count > 0)
      .sort((a, b) => b.cost - a.cost || b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    return { members: sortRows(membersMap), groups: sortRows(groupsMap), organizers: sortRows(orgsMap) };
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
        values = (event.interactions || []).flatMap(item => field === 'member' ? participants(item).map(name => [name, count(item)]) : (expected === 'group' ? isGroupItem(item) : kind(item) === expected) ? [[item[field === 'group' ? 'group_name' : field], count(item)]] : []);
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
  function prices(records, name, expectedKind, expectedForm, eventType, limit, attributes) {
    const key = { individual: 'member', group: 'group_name', merch: 'item_name' }[expectedKind];
    const candidates = [];
    for (const event of records) {
      for (const item of event.interactions || []) {
        const targetMatches=expectedKind==='multi'?(canonical(participants(item).slice().sort())===canonical(names(name).sort())||canonical(participantIds(item).slice().sort())===canonical(names(name).sort())):expectedKind==='individual'?(participantIds(item)[0]===name||item.member===name):item[key]===name;
        if (kind(item) !== expectedKind || !targetMatches || expectedKind !== 'merch' && form(item, event.event_type || 'performance', event) !== expectedForm) continue;
        if(attributes){
          const format=form(item,event.event_type,event),signature=item.signature||(['signed','unsigned'].includes(format)?format:'');
          if(attributes.size&&item.photo_size!==attributes.size||attributes.signature&&signature!==attributes.signature||attributes.themed!=null&&Boolean(item.is_theme||format==='theme')!==attributes.themed)continue;
        }
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
      else if (plain(value)) for (const [key, item] of Object.entries(value)) if (!['id', 'image', 'avatar', 'attachments', 'created_at'].includes(key)) walk(item);
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
    const matchedProfiles=options.state&&options.query?new Set(memberCatalog(options.state).filter(profile=>search(profile,options.query,options.pinyin)).map(profile=>profile.id)):null;
    return records.filter(event => (!options.type || options.type === 'all' || (event.event_type || 'performance') === options.type) && (!options.venue || event.venue === options.venue) && (!options.organizer || eventOrganizers(event).includes(options.organizer) || (event.interactions || []).some(it => names(it.merch_organizers).includes(options.organizer))) && (!options.member || (event.interactions || []).some(item => participantIds(item).includes(options.member)||participants(item).includes(options.member)||(item.merch_member_ids||[]).includes(options.member)||names(item.merch_members).includes(options.member))) && predicate(event) && (search(event, options.query, options.pinyin)||matchedProfiles&&(event.interactions||[]).some(item=>participantIds(item).some(id=>matchedProfiles.has(id))||(item.merch_member_ids||[]).some(id=>matchedProfiles.has(id))))).sort((a, b) => b.date.localeCompare(a.date));
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
    const profiles = new Map(state.members.map(profile => [profile.id, profile]));
    let memberConflicts = 0, membersAdded = 0;
    for (const profile of imported.members) {
      if (!profiles.has(profile.id)) { state.members.push(profile); profiles.set(profile.id, profile); membersAdded++; }
      else if (canonical(profiles.get(profile.id)) !== canonical(profile)) memberConflicts++;
    }
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
    if (Array.isArray(imported.config.organizers)) state.config.organizers = names([...(state.config.organizers || []), ...imported.config.organizers]);
    if (Array.isArray(imported.config.organizer_profiles)) {
      const existingOrgNames = new Set((state.config.organizer_profiles || []).map(p => p.name));
      const addedOrgs = imported.config.organizer_profiles.filter(p => !existingOrgNames.has(p.name));
      if (addedOrgs.length) state.config.organizer_profiles = [...(state.config.organizer_profiles || []), ...addedOrgs];
    }
    if (Array.isArray(imported.config.group_profiles)) {
      const existingGroupNames = new Set((state.config.group_profiles || []).map(p => p.name));
      const addedGroups = imported.config.group_profiles.filter(p => !existingGroupNames.has(p.name));
      if (addedGroups.length) state.config.group_profiles = [...(state.config.group_profiles || []), ...addedGroups];
    }
    for (const [key, value] of Object.entries(imported)) if (!own(state, key)) state[key] = value;
    for (const [key, value] of Object.entries(imported.config)) if (!own(state.config, key)) state.config[key] = value;
    for (const [key, value] of Object.entries(imported.assets)) if (!own(state.assets, key)) state.assets[key] = value;
    return { state: validateState(state), added, conflicts, skipped, membersAdded, memberConflicts };
  }
  return { FORMAT, SCHEMA_VERSION, APP_VERSION, createEmptyState, budgetForMonth, entitySpendingSummary, admission, memberSummary, groupSummary, ticketSummary, calendarSummary, annualSummary, legacyMemberId, participantIds, resolveMember, memberLabel, memberGroups, renameMember, mergeMember, isPhysicalLocation, isGroupItem, isPhone, benefitTypes, benefitLabel, presetPrice, names, participants, itemName, memberCatalog, groupCatalog, organizerCatalog, organizerProfile, groupProfile, saveOrganizerProfile, saveGroupProfile, renameOrganizer, renameGroup, setOrganizerEvents, setOrganizerGroups, memberMetrics, eventOrganizers, identityGroups, preferredIdentity, interactionGroups, interactionRows, cents, amount, money, quantity, validDate, kind, form, count, itemTotal, eventTotal, stats, parseBackup, validateState, mergeStates, search, filterRecords, periodRange, frequent, prices, clone };
});
