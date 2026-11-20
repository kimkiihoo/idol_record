(function (root) {
  'use strict';
  const receivers = new Map();
  function isVideo(photoOrSrc) {
    if (!photoOrSrc) return false;
    if (typeof photoOrSrc === 'object') {
      if (photoOrSrc.media_type === 'video') return true;
      if (photoOrSrc.media_type === 'image') return false;
      photoOrSrc = photoOrSrc.data;
    }
    return typeof photoOrSrc === 'string' && (
      /\.(?:mp4|webm|mov|mkv|3gp|m4v)(?:$|\?)/i.test(photoOrSrc) ||
      /^data:video\//i.test(photoOrSrc)
    );
  }
  function videoPosterUrl(src) {
    if (typeof src === 'string' && root.AndroidBridge && src.startsWith('https://idol.local/photos/')) {
      return 'https://idol.local/thumbs/' + src.slice('https://idol.local/photos/'.length) + '.jpg';
    }
    return '';
  }
  function bindNativeVideoFallback(selector, src, title) {
    const el = document.querySelector(selector);
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('error', () => {
      if (!root.AndroidBridge || typeof root.AndroidBridge.playVideo !== 'function') return;
      const poster = videoPosterUrl(src);
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = 'outline';
      wrap.style.width = '100%';
      wrap.style.margin = '12px 0';
      wrap.innerHTML = (poster ? '<img class="photo-preview" src="' + poster.replace(/"/g, '&quot;') + '" alt="视频封面">' : '') +
        '<span>该编码需使用原生引擎播放 · 点击播放 ▶</span>';
      wrap.addEventListener('click', () => root.AndroidBridge.playVideo(src, title || ''));
      if (el.parentNode) el.parentNode.replaceChild(wrap, el);
    });
  }
  function thumbVisual(ctx, photo, altText) {
    if (isVideo(photo)) {
      const poster = videoPosterUrl(photo.data);
      if (poster) {
        return '<div class="video-thumb-wrap"><img class="media-thumb" loading="lazy" src="' +
          ctx.esc(poster) +
          '" alt="' +
          ctx.esc(photo.caption || '记录视频') +
          '"><span class="video-badge">▶ 视频</span></div>';
      }
      return '<div class="video-thumb-wrap"><video class="media-thumb" muted playsinline preload="metadata" src="' +
        ctx.esc(photo.data) +
        '#t=0.1"></video><span class="video-badge">▶ 视频</span></div>';
    }
    return '<img loading="lazy" src="' + ctx.esc(photo.data) + '" alt="' + ctx.esc(photo.caption || altText || '记录照片') + '">';
  }
  function thumbnails(ctx, photos, prefix, editable) {
    return (
      '<div class="photo-grid">' +
      photos
        .map(
          (photo, index) => {
            const video = isVideo(photo);
            return '<div><button type="button" class="photo-thumb" data-photo-view="' +
              prefix +
              '-' +
              index +
              '">' +
              thumbVisual(ctx, photo, '记录照片') +
              '</button>' +
              (editable
                ? ctx.field(
                    video ? '视频说明' : '照片说明',
                    prefix + '-caption-' + index,
                    photo.caption || '',
                    'text',
                    'maxlength="500"',
                  ) +
                  '<button type="button" class="text danger" data-photo-remove="' +
                  index +
                  '">' +
                  (video ? '删除视频' : '删除照片') +
                  '</button>'
                : photo.caption
                  ? '<small>' + ctx.esc(photo.caption) + '</small>'
                  : '') +
              '</div>';
          },
        )
        .join('') +
      '</div>'
    );
  }
  function editor(ctx, host, initial, options) {
    let photos = ctx.C.clone(initial || []);
    let allowVideo = !!(options && options.allowVideo);
    let pending = false;
    const token = ctx.uid();
    document.getElementById(host).dataset.photoToken = token;
    function paint() {
      const hasVideo = allowVideo || photos.some(isVideo);
      const countText = hasVideo ? photos.length + ' 项' : photos.length + ' 张';
      const heading = hasVideo ? '照片 / 视频 · ' + countText : '照片 · ' + countText;
      const btnText = allowVideo ? '＋ 添加照片/视频' : '＋ 添加照片';
      const helpText = allowVideo
        ? '支持一次选择多张照片或常见格式视频（MP4 / MOV / WebM / MKV / 3GP），完整备份包含全部媒体。每条记录最多 20 项。'
        : '支持一次选择多张照片，选后压缩保存，完整备份包含照片。每条记录最多 20 张。';
      document.getElementById(host).innerHTML =
        '<div class="row"><h3>' +
        heading +
        '</h3><button type="button" id="' +
        host +
        '-add" class="outline compact">' +
        btnText +
        '</button></div><p class="subtle">' +
        helpText +
        '</p>' +
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
        const item = photos[index];
        if (!item) return;
        document.getElementById(host + '-preview').innerHTML = isVideo(item)
          ? '<video class="photo-preview" controls playsinline preload="metadata" src="' + ctx.esc(item.data) + '"></video>'
          : '<img class="photo-preview" src="' + ctx.esc(item.data) + '" alt="照片预览">';
      });
    }
    function setPending(value) {
      pending = value;
      const hostElement = document.getElementById(host);
      if (!hostElement || hostElement.dataset.photoToken !== token) return;
      const button = document.getElementById(host + '-add');
      if (button) {
        button.disabled = value;
        button.textContent = value ? (allowVideo ? '正在处理媒体…' : '正在处理照片…') : (allowVideo ? '＋ 添加照片/视频' : '＋ 添加照片');
      }
    }
    function isValidPhoto(data) {
      if (typeof data !== 'string') return false;
      const validImage = data.length <= 700000 &&
        /^(?:data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}|https:\/\/idol\.local\/photos\/[0-9a-f]{64}\.(jpg|png|webp))$/.test(data);
      if (validImage) return true;
      if (!allowVideo) return false;
      return (data.length <= 15000000 && /^data:video\/(?:mp4|webm|quicktime|x-matroska|3gpp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) ||
        /^https:\/\/idol\.local\/photos\/[0-9a-f]{64}\.(?:mp4|webm|mov|mkv|3gp|m4v)$/.test(data);
    }
    function receive(list) {
      setPending(false);
      const items = Array.isArray(list) ? list : (list == null ? [] : [list]);
      if (!items.length) return;
      if (
        !document.getElementById(host) ||
        document.getElementById(host).dataset.photoToken !== token ||
        document.querySelector('#modal').classList.contains('hidden')
      )
        return;
      let added = 0, invalid = 0, overflow = 0;
      for (const data of items) {
        if (data == null) continue;
        if (!isValidPhoto(data)) { invalid++; continue; }
        if (photos.length >= 20) { overflow++; continue; }
        photos.push(Object.assign({ id: ctx.uid(), data, caption: '' }, isVideo(data) ? { media_type: 'video' } : {}));
        added++;
      }
      if (added) paint();
      if (overflow) ctx.notify('每条记录最多保存 20 项媒体，超出部分已跳过');
      else if (invalid) ctx.notify(added ? '部分文件格式无效或过大已跳过' : (allowVideo ? '媒体格式无效或过大' : '照片格式无效或过大'));
    }
    async function compressFile(file) {
      if (file.size > 50 * 1024 * 1024) throw new Error('请选择 50 MB 以内的图片');
      const picture = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 1280 / Math.max(picture.width, picture.height)),
          canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(picture.width * scale));
        canvas.height = Math.max(1, Math.round(picture.height * scale));
        const drawing = canvas.getContext('2d');
        drawing.fillStyle = '#ffffff';
        drawing.fillRect(0, 0, canvas.width, canvas.height);
        drawing.drawImage(picture, 0, 0, canvas.width, canvas.height);
        let quality = 0.85, data;
        do {
          data = canvas.toDataURL('image/jpeg', quality);
          quality -= 0.1;
        } while (data.length > 700000 && quality >= 0.35);
        return data;
      } finally {
        picture.close();
      }
    }
    function readVideoDataUrl(file) {
      if (file.size > 10 * 1024 * 1024) throw new Error('网页预览模式单个视频请勿超过 10 MB');
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取视频失败'));
        reader.readAsDataURL(file);
      });
    }
    async function pick() {
      if (pending) throw new Error('请等待当前媒体处理完成');
      const remaining = 20 - photos.length;
      if (remaining <= 0) throw new Error(allowVideo ? '每条记录最多保存 20 项媒体' : '每条记录最多保存 20 张照片');
      setPending(true);
      receivers.clear();
      receivers.set(token, receive);
      if (root.AndroidBridge) {
        try {
          if (typeof root.AndroidBridge.pickMedia === 'function') root.AndroidBridge.pickMedia(token, remaining, allowVideo);
          else if (typeof root.AndroidBridge.pickPhotos === 'function') root.AndroidBridge.pickPhotos(token, remaining);
          else root.AndroidBridge.pickPhoto(token);
        } catch (error) { setPending(false); throw error; }
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = allowVideo ? 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska,video/3gpp,.mp4,.mov,.webm,.mkv,.3gp,.m4v' : 'image/jpeg,image/png,image/webp';
      input.multiple = true;
      input.oncancel = () => setPending(false);
      input.onchange = async () => {
        try {
          const files = Array.from(input.files || []);
          if (!files.length) return;
          const batch = [];
          let failed = 0;
          for (const file of files.slice(0, remaining)) {
            try {
              const isVid = (file.type && file.type.startsWith('video/')) || /\.(?:mp4|mov|webm|mkv|3gp|m4v)$/i.test(file.name || '');
              if (isVid) {
                if (!allowVideo) { failed++; continue; }
                batch.push(await readVideoDataUrl(file));
              } else {
                batch.push(await compressFile(file));
              }
            }
            catch (_) { failed++; }
          }
          if (files.length > remaining) ctx.notify('最多还可添加 ' + remaining + ' 项，超出部分已跳过');
          if (batch.length) receive(batch);
          else if (failed) ctx.notify(allowVideo ? '读取照片或视频失败' : '读取照片失败');
        } catch (error) {
          ctx.notify(error.message || '读取媒体失败');
        } finally {
          setPending(false);
        }
      };
      input.click();
    }
    paint();
    return {
      get: () => { if (pending) throw new Error(allowVideo ? '媒体仍在处理，请稍后保存' : '照片仍在处理，请稍后保存'); return ctx.C.clone(photos); },
      setAllowVideo: (next) => { const flag = !!next; if (flag !== allowVideo) { allowVideo = flag; paint(); } },
    };
  }
  function gallery(ctx, photos, prefix) {
    if (!photos || !photos.length) return '';
    const hasVideo = photos.some(isVideo);
    return '<h3>' + (hasVideo ? '照片 / 视频 · ' + photos.length + ' 项' : '照片 · ' + photos.length + ' 张') + '</h3>' + thumbnails(ctx, photos, prefix, false);
  }
  function savePhoto(ctx, src) {
    if (!src) return;
    if (root.AndroidBridge && typeof root.AndroidBridge.savePhotoToGallery === 'function') {
      root.AndroidBridge.savePhotoToGallery(src);
      return;
    }
    if (typeof document.createElement === 'function') {
      const video = isVideo(src);
      const link = document.createElement('a');
      link.href = src;
      link.download = 'idol-recorder-' + Date.now() + (video ? '.mp4' : '.jpg');
      link.click();
      if (ctx && ctx.notify) ctx.notify(video ? '已开始下载视频' : '已开始下载照片');
    }
  }
  function closeLightbox() {
    const box = document.querySelector('#photo-lightbox');
    if (!box || box.classList.contains('hidden')) return false;
    const vid = box.querySelector('#lightbox-video');
    if (vid && typeof vid.pause === 'function') { try { vid.pause(); } catch (_) {} }
    box.classList.add('hidden');
    box.innerHTML = '';
    const modalOpen = document.querySelector('#modal') && !document.querySelector('#modal').classList.contains('hidden');
    document.body.style.overflow = modalOpen ? 'hidden' : '';
    return true;
  }
  function openLightbox(ctx, src, caption) {
    const box = document.querySelector('#photo-lightbox');
    if (!box || !src) return;
    if (isVideo(src)) {
      const hasNative = !!(root.AndroidBridge && typeof root.AndroidBridge.playVideo === 'function');
      const poster = videoPosterUrl(src);
      box.innerHTML =
        '<div class="lightbox-bar"><div class="lightbox-tools">' +
        (hasNative ? '<button type="button" id="lightbox-native-play">原生播放</button>' : '') +
        '<button type="button" id="lightbox-save" class="primary">保存到相册</button>' +
        '</div><button type="button" id="lightbox-close" class="icon" aria-label="关闭全屏">×</button></div>' +
        '<div id="lightbox-stage" class="lightbox-stage lightbox-stage-video"><video id="lightbox-video" class="lightbox-video" controls playsinline autoplay' +
        (poster ? ' poster="' + ctx.esc(poster) + '"' : '') +
        ' src="' +
        ctx.esc(src) +
        '"></video></div>' +
        (caption ? '<div class="lightbox-caption">' + ctx.esc(caption) + '</div>' : '');
      box.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      ctx.on('#lightbox-close', 'click', closeLightbox);
      ctx.on('#lightbox-save', 'click', () => savePhoto(ctx, src));
      if (hasNative) ctx.on('#lightbox-native-play', 'click', () => root.AndroidBridge.playVideo(src, caption || '视频播放'));
      bindNativeVideoFallback('#lightbox-video', src, caption || '视频播放');
      return;
    }
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
    if (!photos || !photos.length) return;
    ctx.allOn('[data-photo-view]', 'click', (button) => {
      if (!button.dataset.photoView.startsWith(prefix + '-')) return;
      const index = Number(button.dataset.photoView.slice(prefix.length + 1)),
        photo = photos[index];
      if (!photo) return;
      const video = isVideo(photo);
      const hasNative = !!(video && root.AndroidBridge && typeof root.AndroidBridge.playVideo === 'function');
      const poster = video ? videoPosterUrl(photo.data) : '';
      ctx.modal(
        video ? '视频预览' : '照片预览',
        (video
          ? '<video id="gallery-preview-video" class="photo-preview" controls playsinline preload="metadata"' + (poster ? ' poster="' + ctx.esc(poster) + '"' : '') + ' src="' + ctx.esc(photo.data) + '"></video>'
          : '<img id="gallery-preview-img" class="photo-preview clickable" src="' + ctx.esc(photo.data) + '" alt="' + ctx.esc(photo.caption || '照片') + '">') +
          (photo.caption ? '<p>' + ctx.esc(photo.caption) + '</p>' : '') +
          '<div class="actions"><button id="preview-fullscreen" class="outline">' + (video ? '全屏播放' : '全屏 / 放大') + '</button>' + (hasNative ? '<button id="preview-native-play" class="outline">原生播放</button>' : '') + '<button id="preview-save-photo" class="primary">保存到相册</button></div>' +
          '<button id="photo-back" class="outline" style="width:100%;margin-top:8px">返回记录</button>',
      );
      if (!video) ctx.on('#gallery-preview-img', 'click', () => openLightbox(ctx, photo.data, photo.caption || ''));
      else bindNativeVideoFallback('#gallery-preview-video', photo.data, photo.caption || '视频播放');
      if (hasNative) ctx.on('#preview-native-play', 'click', () => root.AndroidBridge.playVideo(photo.data, photo.caption || '视频播放'));
      ctx.on('#preview-fullscreen', 'click', () => openLightbox(ctx, photo.data, photo.caption || ''));
      ctx.on('#preview-save-photo', 'click', () => savePhoto(ctx, photo.data));
      ctx.on('#photo-back', 'click', back);
    });
  }
  const albumView={category:'all',query:'',limit:30};
  function albumRows(state){
    const rows=[];
    for(const event of state.records){
      for(const photo of event.attachments||[])rows.push({photo,event,item:null,category:event.standalone_phone?'phone':'event',date:String(event.date||'').slice(0,10),members:[],groups:root.IdolCore.names(event.performing_groups)});
      for(const item of (event.interactions||[]).filter(item=>root.IdolCore.kind(item)!=='merch')){
        const rawDate=(event.standalone_phone&&(event.interactions||[]).length===1)?(event.date||item.shot_at||''):(item.shot_at||event.date||'');
        for(const photo of item.attachments||[])rows.push({photo,event,item,category:root.IdolCore.kind(item)==='phone'?'phone':'cheki',date:String(rawDate).slice(0,10),members:root.IdolCore.participantIds(item),groups:root.IdolCore.interactionGroups(item,state,event)});
      }
    }
    return rows.sort((a,b)=>b.date.localeCompare(a.date)||String(b.photo.id).localeCompare(String(a.photo.id)));
  }
  function page(ctx){
    return '<div class="row"><h1>照片</h1><button id="add-phone-photo" class="primary compact">＋ 手机合影</button></div><div class="segmented">'+Object.entries({all:'全部',event:'演出合影',cheki:'拍立得合影',phone:'手机合影'}).map(([key,label])=>'<button data-album-category="'+key+'" class="'+(key===albumView.category?'active':'')+'">'+label+'</button>').join('')+'</div><input id="album-search" class="search" autocomplete="off" placeholder="搜索活动、成员、团体或照片/视频说明" value="'+ctx.esc(albumView.query)+'"><div id="album-results"></div>';
  }
  function bindPage(ctx){
    function results(){
      const rows=albumRows(ctx.state).filter(row=>(albumView.category==='all'||row.category===albumView.category)&&ctx.C.search({event:row.event.event_name,note:row.item&&row.item.note,caption:row.photo.caption,group:row.item&&row.item.group_name,groups:row.groups,members:row.members.map(id=>ctx.C.resolveMember(ctx.state,id))},albumView.query,root.IdolPinyin));
      const videoCount=rows.filter(row=>isVideo(row.photo)).length;
      document.querySelector('#album-results').innerHTML='<p class="subtle">'+(videoCount?rows.length+' 项媒体（含 '+videoCount+' 个视频）':rows.length+' 张照片')+' · 时间由近到远</p><div class="photo-grid">'+rows.slice(0,albumView.limit).map((row,index)=>'<button class="album-card" data-album-photo="'+index+'">'+thumbVisual(ctx,row.photo,'记录照片')+'<strong>'+ctx.esc(row.item?ctx.C.itemName(row.item):row.event.event_name)+'</strong><small>'+ctx.esc(row.date.slice(0,10))+'</small><small>'+ctx.esc(row.event.standalone_phone?'独立手机合影':row.item?row.event.event_name:'演出合影')+'</small></button>').join('')+'</div>'+(rows.length?'':ctx.empty('暂无匹配的媒体，可添加手机合影或在原记录中添加照片'))+(rows.length>albumView.limit?'<button id="album-more" class="outline" style="width:100%">再显示 30 项</button>':'');
      function openAlbumDetail(row){
        const liveCtx=ctx.fresh?ctx.fresh():ctx;
        const video=isVideo(row.photo);
        const hasNative=!!(video&&root.AndroidBridge&&typeof root.AndroidBridge.playVideo==='function');
        const poster=video?videoPosterUrl(row.photo.data):'';
        const hasAv=!!(root.IdolPeople&&typeof root.IdolPeople.avatar==='function');
        let targetLine='';
        if(row.members.length){
          targetLine='<div class="detail-line detail-line-chips"><span>成员</span><div class="chips event-org-chips">'+row.members.map(id=>{
            const prof=liveCtx.C.resolveMember(liveCtx.state,id);
            return '<button type="button" class="organizer-chip" data-album-member="'+liveCtx.esc(id)+'">'+(hasAv?root.IdolPeople.avatar(liveCtx,prof,'sm'):'')+'<span>'+liveCtx.esc(liveCtx.C.memberLabel(prof,liveCtx.state))+'</span></button>';
          }).join('')+'</div></div>';
        }else if(row.item&&liveCtx.C.isGroupItem(row.item)){
          const gName=row.item.group_name||'未知团体';
          targetLine='<div class="detail-line detail-line-chips"><span>团体</span><div class="chips event-org-chips"><button type="button" class="organizer-chip" data-album-group="'+liveCtx.esc(gName)+'">'+(hasAv?root.IdolPeople.avatar(liveCtx,liveCtx.C.groupProfile(liveCtx.state,gName),'sm'):'')+'<span>'+liveCtx.esc(gName)+'</span></button></div></div>';
        }else{
          targetLine=liveCtx.detailLine('成员','活动照片');
        }
        const eventLine=row.event.standalone_phone
          ?liveCtx.detailLine('所属活动','未绑定具体活动')
          :'<div class="detail-line"><span>所属活动</span><span class="detail-links"><button type="button" class="detail-link-btn" id="album-event-link">'+liveCtx.esc(row.event.event_name)+' ›</button></span></div>';
        const lightboxCaption=row.photo.caption||(row.item?liveCtx.C.itemName(row.item):row.event.event_name);
        liveCtx.modal(video?'视频详情':'照片详情',(video?'<video id="album-preview-video" class="photo-preview" controls playsinline preload="metadata"'+(poster?' poster="'+liveCtx.esc(poster)+'"':'')+' src="'+liveCtx.esc(row.photo.data)+'"></video>':'<img id="album-preview-img" class="photo-preview clickable" src="'+liveCtx.esc(row.photo.data)+'" alt="照片预览">')+liveCtx.detailLine('日期',row.date.slice(0,10))+targetLine+eventLine+(row.photo.caption?'<p>'+liveCtx.esc(row.photo.caption)+'</p>':'')+'<div class="actions"><button id="album-fullscreen" class="outline">'+(video?'全屏播放':'全屏 / 放大')+'</button>'+(hasNative?'<button id="album-native-play" class="outline">原生播放</button>':'')+'<button id="album-save-photo" class="primary">保存到相册</button></div><div class="actions"><button id="album-open-record" class="outline">查看原记录</button>'+(row.item&&liveCtx.C.kind(row.item)==='phone'?'<button id="album-edit-phone" class="primary">编辑手机合影</button>':'')+'</div>',false,{key:'album-photo:'+row.photo.id,restore:()=>openAlbumDetail(row)});
        if(!video)liveCtx.on('#album-preview-img','click',()=>openLightbox(liveCtx,row.photo.data,lightboxCaption));else bindNativeVideoFallback('#album-preview-video',row.photo.data,lightboxCaption);
        if(hasNative)liveCtx.on('#album-native-play','click',()=>root.AndroidBridge.playVideo(row.photo.data,lightboxCaption));
        liveCtx.on('#album-fullscreen','click',()=>openLightbox(liveCtx,row.photo.data,lightboxCaption));
        liveCtx.on('#album-save-photo','click',()=>savePhoto(liveCtx,row.photo.data));
        liveCtx.on('#album-open-record','click',()=>liveCtx.onEvent(row.event.id));
        liveCtx.on('#album-event-link','click',()=>liveCtx.onEvent(row.event.id));
        liveCtx.allOn('[data-album-member]','click',btn=>{if(liveCtx.onMember)liveCtx.onMember(btn.dataset.albumMember);});
        liveCtx.allOn('[data-album-group]','click',btn=>{if(liveCtx.onGroup)liveCtx.onGroup(btn.dataset.albumGroup);});
        liveCtx.on('#album-edit-phone','click',()=>liveCtx.onEditItem(row.event.id,row.event.interactions.indexOf(row.item),null,'phone'));
      }
      ctx.allOn('[data-album-photo]','click',button=>{const row=rows[Number(button.dataset.albumPhoto)];if(row)openAlbumDetail(row);});
      ctx.on('#album-more','click',()=>{albumView.limit+=30;results();});
    }
    ctx.on('#add-phone-photo','click',()=>ctx.onEditItem(null,null,null,'phone'));
    ctx.allOn('[data-album-category]','click',button=>{albumView.category=button.dataset.albumCategory;albumView.limit=30;document.querySelectorAll('[data-album-category]').forEach(control=>control.classList.toggle('active',control===button));results();});
    ctx.on('#album-search','input',event=>{if(event.isComposing)return;albumView.query=event.target.value;albumView.limit=30;results();});
    ctx.on('#album-search','compositionend',event=>{albumView.query=event.target.value;results();});results();
  }
  root.onNativePhotos = (token, list) => {
    const receive = receivers.get(token);
    receivers.delete(token);
    if (receive) receive(Array.isArray(list) ? list : (list == null ? [] : [list]));
  };
  root.onNativePhoto = (token, data) => {
    root.onNativePhotos(token, data == null ? [] : [data]);
  };
  root.IdolPhotos = { editor, gallery, bindGallery, page, bindPage, albumRows, openLightbox, closeLightbox, isVideo };
})(typeof globalThis !== 'undefined' ? globalThis : this);
