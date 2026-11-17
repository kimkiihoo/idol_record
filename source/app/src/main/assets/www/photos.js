(function (root) {
  'use strict';
  const receivers = new Map();
  function thumbnails(ctx, photos, prefix, editable) {
    return (
      '<div class="photo-grid">' +
      photos
        .map(
          (photo, index) =>
            '<div><button type="button" class="photo-thumb" data-photo-view="' +
            prefix +
            '-' +
            index +
            '"><img loading="lazy" src="' +
            ctx.esc(photo.data) +
            '" alt="' +
            ctx.esc(photo.caption || '记录照片') +
            '"></button>' +
            (editable
              ? ctx.field(
                  '照片说明',
                  prefix + '-caption-' + index,
                  photo.caption || '',
                  'text',
                  'maxlength="500"',
                ) +
                '<button type="button" class="text danger" data-photo-remove="' +
                index +
                '">删除照片</button>'
              : photo.caption
                ? '<small>' + ctx.esc(photo.caption) + '</small>'
                : '') +
            '</div>',
        )
        .join('') +
      '</div>'
    );
  }
  function editor(ctx, host, initial) {
    let photos = ctx.C.clone(initial || []);
    let pending = false;
    const token = ctx.uid();
    document.getElementById(host).dataset.photoToken = token;
    function paint() {
      document.getElementById(host).innerHTML =
        '<div class="row"><h3>照片 · ' +
        photos.length +
        ' 张</h3><button type="button" id="' +
        host +
        '-add" class="outline compact">＋ 添加照片</button></div><p class="subtle">选择后压缩保存，完整备份包含照片。每条记录最多 20 张。</p>' +
        thumbnails(ctx, photos, host, true) +
        '<div id="' +
        host +
        '-preview"></div>';
      ctx.on('#' + host + '-add', 'click', pick);
      ctx.allOn('#' + host + ' [data-photo-remove]', 'click', (button) => {
        photos.splice(Number(button.dataset.photoRemove), 1);
        paint();
      });
      photos.forEach((photo, index) =>
        ctx.on('#' + host + '-caption-' + index, 'input', () => {
          photo.caption = ctx.read(host + '-caption-' + index);
        }),
      );
      ctx.allOn('#' + host + ' [data-photo-view]', 'click', (button) => {
        const index = Number(button.dataset.photoView.slice(host.length + 1));
        document.getElementById(host + '-preview').innerHTML =
          '<img class="photo-preview" src="' +
          ctx.esc(photos[index].data) +
          '" alt="照片预览">';
      });
    }
    function setPending(value) {
      pending = value;
      const hostElement = document.getElementById(host);
      if (!hostElement || hostElement.dataset.photoToken !== token) return;
      const button = document.getElementById(host + '-add');
      if (button) { button.disabled = value; button.textContent = value ? '正在处理照片…' : '＋ 添加照片'; }
    }
    function receive(data) {
      setPending(false);
      if (data == null) return;
      if (
        !document.getElementById(host) ||
        document.getElementById(host).dataset.photoToken !== token ||
        document.querySelector('#modal').classList.contains('hidden')
      )
        return;
      if (
        !/^(?:data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}|https:\/\/idol\.local\/photos\/[0-9a-f]{64}\.(jpg|png|webp))$/.test(
          data,
        ) ||
        data.length > 700000
      ) {
        ctx.notify('照片格式无效或过大');
        return;
      }
      if (photos.length >= 20) {
        ctx.notify('每条记录最多保存 20 张照片');
        return;
      }
      photos.push({ id: ctx.uid(), data, caption: '' });
      paint();
    }
    async function pick() {
      if (pending) throw new Error('请等待当前照片处理完成');
      if (photos.length >= 20) throw new Error('每条记录最多保存 20 张照片');
      setPending(true);
      receivers.clear();
      receivers.set(token, receive);
      if (root.AndroidBridge) {
        try { root.AndroidBridge.pickPhoto(token); } catch (error) { setPending(false); throw error; }
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.oncancel = () => setPending(false);
      input.onchange = async () => {
        try {
          const file = input.files[0];
          if (!file) return;
          if (file.size > 50 * 1024 * 1024)
            throw new Error('请选择 50 MB 以内的图片');
          const picture = await createImageBitmap(file);
          try {
            const scale = Math.min(
                1,
                1280 / Math.max(picture.width, picture.height),
              ),
              canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(picture.width * scale));
            canvas.height = Math.max(1, Math.round(picture.height * scale));
            const drawing = canvas.getContext('2d');
            drawing.fillStyle = '#ffffff';
            drawing.fillRect(0, 0, canvas.width, canvas.height);
            drawing.drawImage(picture, 0, 0, canvas.width, canvas.height);
            let quality = 0.85,
              data;
            do {
              data = canvas.toDataURL('image/jpeg', quality);
              quality -= 0.1;
            } while (data.length > 700000 && quality >= 0.35);
            receive(data);
          } finally {
            picture.close();
          }
        } catch (error) {
          ctx.notify(error.message || '读取照片失败');
        } finally {
          setPending(false);
        }
      };
      input.click();
    }
    paint();
    return { get: () => { if (pending) throw new Error('照片仍在处理，请稍后保存'); return ctx.C.clone(photos); } };
  }
  function gallery(ctx, photos, prefix) {
    return photos && photos.length
      ? '<h3>照片 · ' +
          photos.length +
          ' 张</h3>' +
          thumbnails(ctx, photos, prefix, false)
      : '';
  }
  function savePhoto(ctx, src) {
    if (!src) return;
    if (root.AndroidBridge && typeof root.AndroidBridge.savePhotoToGallery === 'function') {
      root.AndroidBridge.savePhotoToGallery(src);
      return;
    }
    if (typeof document.createElement === 'function') {
      const link = document.createElement('a');
      link.href = src;
      link.download = 'idol-recorder-' + Date.now() + '.jpg';
      link.click();
      if (ctx && ctx.notify) ctx.notify('已开始下载照片');
    }
  }
  function closeLightbox() {
    const box = document.querySelector('#photo-lightbox');
    if (!box || box.classList.contains('hidden')) return false;
    box.classList.add('hidden');
    box.innerHTML = '';
    const modalOpen = document.querySelector('#modal') && !document.querySelector('#modal').classList.contains('hidden');
    document.body.style.overflow = modalOpen ? 'hidden' : '';
    return true;
  }
  function openLightbox(ctx, src, caption) {
    const box = document.querySelector('#photo-lightbox');
    if (!box || !src) return;
    box.innerHTML =
      '<div class="lightbox-bar"><div class="lightbox-tools">' +
      '<button type="button" id="lightbox-zoom-out" aria-label="缩小">－</button>' +
      '<button type="button" id="lightbox-zoom-reset" aria-label="还原缩放">100%</button>' +
      '<button type="button" id="lightbox-zoom-in" aria-label="放大">＋</button>' +
      '<button type="button" id="lightbox-save" class="primary">保存到相册</button>' +
      '</div><button type="button" id="lightbox-close" class="icon" aria-label="关闭全屏">×</button></div>' +
      '<div id="lightbox-stage" class="lightbox-stage"><img id="lightbox-img" class="lightbox-img" src="' +
      ctx.esc(src) +
      '" alt="' +
      ctx.esc(caption || '照片全屏预览') +
      '"></div>' +
      (caption ? '<div class="lightbox-caption">' + ctx.esc(caption) + '</div>' : '');
    box.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const stage = document.querySelector('#lightbox-stage');
    const img = document.querySelector('#lightbox-img');
    const outBtn = document.querySelector('#lightbox-zoom-out');
    const resetBtn = document.querySelector('#lightbox-zoom-reset');
    const inBtn = document.querySelector('#lightbox-zoom-in');
    let scale = 1, tx = 0, ty = 0;
    const clampScale = v => Math.min(5, Math.max(1, v));
    function apply() {
      if (scale <= 1) {
        scale = 1;
        tx = 0;
        ty = 0;
      } else if (stage && stage.clientWidth) {
        const maxX = Math.max(120, (stage.clientWidth * (scale - 1)) / 2 + 80);
        const maxY = Math.max(120, (stage.clientHeight * (scale - 1)) / 2 + 80);
        tx = Math.max(-maxX, Math.min(maxX, tx));
        ty = Math.max(-maxY, Math.min(maxY, ty));
      }
      if (img && img.style) img.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + scale + ')';
      if (resetBtn) resetBtn.textContent = Math.round(scale * 100) + '%';
      if (outBtn) outBtn.disabled = scale <= 1;
      if (inBtn) inBtn.disabled = scale >= 5;
    }
    ctx.on('#lightbox-close', 'click', closeLightbox);
    ctx.on('#lightbox-zoom-in', 'click', () => { scale = clampScale(scale + 0.5); apply(); });
    ctx.on('#lightbox-zoom-out', 'click', () => { scale = clampScale(scale - 0.5); apply(); });
    ctx.on('#lightbox-zoom-reset', 'click', () => { scale = 1; tx = 0; ty = 0; apply(); });
    ctx.on('#lightbox-save', 'click', () => savePhoto(ctx, src));
    if (stage && typeof stage.addEventListener === 'function') {
      let mode = 'none', startX = 0, startY = 0, startTx = 0, startTy = 0, pinchDist = 0, pinchScale = 1, lastTap = 0, moved = false;
      const dist = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      stage.addEventListener('touchstart', event => {
        if (!event.touches) return;
        if (event.touches.length === 2) {
          event.preventDefault();
          mode = 'pinch';
          moved = true;
          pinchDist = dist(event.touches);
          pinchScale = scale;
        } else if (event.touches.length === 1) {
          moved = false;
          startX = event.touches[0].clientX;
          startY = event.touches[0].clientY;
          if (scale > 1) {
            mode = 'pan';
            startTx = tx;
            startTy = ty;
          } else {
            mode = 'none';
          }
        }
      }, { passive: false });
      stage.addEventListener('touchmove', event => {
        if (!event.touches) return;
        if (mode === 'pinch' && event.touches.length === 2) {
          event.preventDefault();
          moved = true;
          if (pinchDist > 0) {
            scale = clampScale(pinchScale * (dist(event.touches) / pinchDist));
            apply();
          }
        } else if (mode === 'pan' && event.touches.length === 1) {
          event.preventDefault();
          const dx = event.touches[0].clientX - startX;
          const dy = event.touches[0].clientY - startY;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
          tx = startTx + dx;
          ty = startTy + dy;
          apply();
        }
      }, { passive: false });
      stage.addEventListener('touchend', event => {
        const remaining = event.touches ? event.touches.length : 0;
        if (remaining === 1 && mode === 'pinch') {
          mode = scale > 1 ? 'pan' : 'none';
          startX = event.touches[0].clientX;
          startY = event.touches[0].clientY;
          startTx = tx;
          startTy = ty;
        } else if (remaining === 0) {
          if (!moved) {
            const now = Date.now();
            if (now - lastTap < 280) {
              scale = scale > 1 ? 1 : 2.2;
              if (scale === 1) { tx = 0; ty = 0; }
              apply();
              lastTap = 0;
            } else {
              lastTap = now;
            }
          }
          mode = 'none';
        }
      });
      stage.addEventListener('wheel', event => {
        event.preventDefault();
        scale = clampScale(scale + (event.deltaY < 0 ? 0.25 : -0.25));
        apply();
      }, { passive: false });
    }
    if (img && typeof img.addEventListener === 'function') {
      img.addEventListener('dblclick', () => {
        scale = scale > 1 ? 1 : 2.2;
        if (scale === 1) { tx = 0; ty = 0; }
        apply();
      });
    }
    apply();
  }
  function bindGallery(ctx, photos, prefix, back) {
    ctx.allOn('[data-photo-view]', 'click', (button) => {
      if (!button.dataset.photoView.startsWith(prefix + '-')) return;
      const index = Number(button.dataset.photoView.slice(prefix.length + 1)),
        photo = photos[index];
      if (!photo) return;
      ctx.modal(
        '照片预览',
        '<img id="gallery-preview-img" class="photo-preview clickable" src="' +
          ctx.esc(photo.data) +
          '" alt="' +
          ctx.esc(photo.caption || '照片') +
          '">' +
          (photo.caption ? '<p>' + ctx.esc(photo.caption) + '</p>' : '') +
          '<div class="actions"><button id="preview-fullscreen" class="outline">全屏 / 放大</button><button id="preview-save-photo" class="primary">保存到相册</button></div>' +
          '<button id="photo-back" class="outline" style="width:100%;margin-top:8px">返回记录</button>',
      );
      ctx.on('#gallery-preview-img', 'click', () => openLightbox(ctx, photo.data, photo.caption || ''));
      ctx.on('#preview-fullscreen', 'click', () => openLightbox(ctx, photo.data, photo.caption || ''));
      ctx.on('#preview-save-photo', 'click', () => savePhoto(ctx, photo.data));
      ctx.on('#photo-back', 'click', back);
    });
  }
  const albumView={category:'all',query:'',limit:30};
  function albumRows(state){
    const rows=[];
    for(const event of state.records){
      for(const photo of event.attachments||[])rows.push({photo,event,item:null,category:event.standalone_phone?'phone':'event',date:event.date,members:[],groups:root.IdolCore.names(event.performing_groups)});
      for(const item of (event.interactions||[]).filter(item=>root.IdolCore.kind(item)!=='merch'))for(const photo of item.attachments||[])rows.push({photo,event,item,category:root.IdolCore.kind(item)==='phone'?'phone':'cheki',date:item.shot_at||event.date,members:root.IdolCore.participantIds(item),groups:root.IdolCore.interactionGroups(item,state,event)});
    }
    return rows.sort((a,b)=>b.date.localeCompare(a.date)||String(b.photo.id).localeCompare(String(a.photo.id)));
  }
  function page(ctx){
    return '<div class="row"><h1>照片</h1><button id="add-phone-photo" class="primary compact">＋ 手机合影</button></div><div class="segmented">'+Object.entries({all:'全部',event:'演出合影',cheki:'拍立得合影',phone:'手机合影'}).map(([key,label])=>'<button data-album-category="'+key+'" class="'+(key===albumView.category?'active':'')+'">'+label+'</button>').join('')+'</div><input id="album-search" class="search" autocomplete="off" placeholder="搜索活动、成员、团体或照片说明" value="'+ctx.esc(albumView.query)+'"><div id="album-results"></div>';
  }
  function bindPage(ctx){
    function results(){
      const rows=albumRows(ctx.state).filter(row=>(albumView.category==='all'||row.category===albumView.category)&&ctx.C.search({event:row.event.event_name,note:row.item&&row.item.note,caption:row.photo.caption,group:row.item&&row.item.group_name,groups:row.groups,members:row.members.map(id=>ctx.C.resolveMember(ctx.state,id))},albumView.query,root.IdolPinyin));
      document.querySelector('#album-results').innerHTML='<p class="subtle">'+rows.length+' 张照片 · 时间由近到远</p><div class="photo-grid">'+rows.slice(0,albumView.limit).map((row,index)=>'<button class="album-card" data-album-photo="'+index+'"><img loading="lazy" src="'+ctx.esc(row.photo.data)+'" alt="'+ctx.esc(row.photo.caption||'记录照片')+'"><strong>'+ctx.esc(row.item?ctx.C.itemName(row.item):row.event.event_name)+'</strong><small>'+ctx.esc(row.date.replace('T',' '))+'</small><small>'+ctx.esc(row.event.standalone_phone?'独立手机合影':row.event.event_name)+'</small></button>').join('')+'</div>'+(rows.length?'':ctx.empty('暂无匹配的照片，可添加手机合影或在原记录中添加照片'))+(rows.length>albumView.limit?'<button id="album-more" class="outline" style="width:100%">再显示 30 张</button>':'');
      ctx.allOn('[data-album-photo]','click',button=>{const row=rows[Number(button.dataset.albumPhoto)];const targetLine=row.members.length?ctx.detailLine('成员',row.members.map(id=>ctx.C.memberLabel(ctx.C.resolveMember(ctx.state,id),ctx.state)).join(' / ')):row.item&&ctx.C.isGroupItem(row.item)?ctx.detailLine('团体',row.item.group_name||'未知团体'):ctx.detailLine('成员','活动照片');const lightboxCaption=row.photo.caption||(row.item?ctx.C.itemName(row.item):row.event.event_name);ctx.modal('照片详情','<img id="album-preview-img" class="photo-preview clickable" src="'+ctx.esc(row.photo.data)+'" alt="照片预览">'+ctx.detailLine('日期',row.date.replace('T',' '))+targetLine+ctx.detailLine('所属活动',row.event.standalone_phone?'未绑定具体活动':row.event.event_name)+(row.photo.caption?'<p>'+ctx.esc(row.photo.caption)+'</p>':'')+'<div class="actions"><button id="album-fullscreen" class="outline">全屏 / 放大</button><button id="album-save-photo" class="primary">保存到相册</button></div><div class="actions"><button id="album-open-record" class="outline">查看原记录</button>'+(row.item&&ctx.C.kind(row.item)==='phone'?'<button id="album-edit-phone" class="primary">编辑手机合影</button>':'')+'</div>');ctx.on('#album-preview-img','click',()=>openLightbox(ctx,row.photo.data,lightboxCaption));ctx.on('#album-fullscreen','click',()=>openLightbox(ctx,row.photo.data,lightboxCaption));ctx.on('#album-save-photo','click',()=>savePhoto(ctx,row.photo.data));ctx.on('#album-open-record','click',()=>ctx.onEvent(row.event.id));ctx.on('#album-edit-phone','click',()=>ctx.onEditItem(row.event.id,row.event.interactions.indexOf(row.item),null,'phone'));});
      ctx.on('#album-more','click',()=>{albumView.limit+=30;results();});
    }
    ctx.on('#add-phone-photo','click',()=>ctx.onEditItem(null,null,null,'phone'));
    ctx.allOn('[data-album-category]','click',button=>{albumView.category=button.dataset.albumCategory;albumView.limit=30;document.querySelectorAll('[data-album-category]').forEach(control=>control.classList.toggle('active',control===button));results();});
    ctx.on('#album-search','input',event=>{if(event.isComposing)return;albumView.query=event.target.value;albumView.limit=30;results();});
    ctx.on('#album-search','compositionend',event=>{albumView.query=event.target.value;results();});results();
  }
  root.onNativePhoto = (token, data) => {
    const receive = receivers.get(token);
    receivers.delete(token);
    if (receive) receive(data);
  };
  root.IdolPhotos = { editor, gallery, bindGallery, page, bindPage, albumRows, openLightbox, closeLightbox };
})(typeof globalThis !== 'undefined' ? globalThis : this);
