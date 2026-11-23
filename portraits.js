'use strict';
/* Rosequill pictures: paint a character (or a place, creature, artifact…) from its description, using
   Pollinations' free image AI. Only the description text shown in the window is sent, with names taken out,
   and she can edit it first. The free service allows one picture every 45 seconds, so a countdown waits for it.
   The chosen picture is saved on the page (a small JPEG), so it syncs and backs up with everything else. */
const Portraits = (() => {
  const API = 'https://image.pollinations.ai/prompt/';
  const STYLES = {
    dreamy: ['Dreamy watercolour', 'dreamy watercolour illustration, misty enchanted forest light'],
    storybook: ['Storybook', 'whimsical storybook illustration, gouache'],
    painting: ['Oil painting', 'classical fantasy oil painting, rich brushwork'],
    sketch: ['Pencil sketch', 'delicate pencil sketch, soft shading, warm paper'],
    anime: ['Anime', 'anime style illustration, soft cel shading'],
  };
  const PALETTE = 'soft pastel palette of lavender, periwinkle, aqua, cream, dusty rose and pink';
  const SIZES = { portrait: [512, 704], landscape: [768, 512] };
  let current = null, cand = null, seed = 0, busy = false, wait = 0, waitT = 0;

  /* ---------- turning a page into a description ---------- */
  const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'to', 'new']);
  function clean(s, title) {
    let t = String(s)
      .replace(/\[\[[^\]]*\]\]/g, '')                             // linked names
      .replace(/(^|\s)#[\p{L}][\p{L}\p{N}_-]*/gu, '$1')            // #tags
      .replace(/[*_`>#=~|]/g, '');
    for (const w of String(title || '').split(/\s+/)) if (w.length >= 3 && !STOP.has(w.toLowerCase())) t = t.replace(new RegExp('(?<![\\p{L}])' + reEsc(w) + '(?:\'s|’s)?(?![\\p{L}])', 'giu'), '');
    return t.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/([.,;:])\1+/g, '$1').replace(/^[\s.,;:]+/, '').trim();
  }
  // The "Appearance" (or "Description", "What it looks like") section, plus age/role-style facts from "At a glance".
  function describe(it) {
    const text = String(it.content || ''), out = []; let on = false;
    for (const l of text.split('\n')) {
      const m = l.match(/^#{1,6}\s+(.*)$/);
      if (m) { on = /appearance|look|description|features/i.test(m[1]); continue; }
      if (on && l.trim()) out.push(l.trim().replace(/^[-*]\s+/, ''));
    }
    const facts = (text.match(/^\s*[-*]\s*\*\*(Age|Species|Race|Role|Kind|Habitat|Realm|Power|Made by):\*\*[ \t]*(.+)$/gmi) || [])
      .map(s => s.replace(/^\s*[-*]\s*\*\*([^:*]+):\*\*\s*/, (x, k) => k + ': ')).filter(s => !/:\s*$/.test(s));
    let d = out.join('. ');
    if (!d.trim()) d = it.synopsis || '';
    return clean([d, ...facts].filter(Boolean).join('. '), it.title).slice(0, 600);
  }
  const isCharacter = it => /(^|\s)#character\b/i.test(it.content || '') || /^#{1,6}\s+appearance/im.test(it.content || '');

  /* ---------- the window ---------- */
  const val = id => { const b = $('#' + id + ' .on'); return b ? b.dataset.v : null; };
  function choose(id, onPick) {
    $('#' + id).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; $$('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b)); if (onPick) onPick(b.dataset.v); });
  }
  function status(msg, warn) { const s = $('#ptStatus'); if (s) { s.textContent = msg; s.classList.toggle('warn', !!warn); } }
  function buttons() { const p = $('#ptPaint'); if (p) p.disabled = busy || Date.now() < wait; }

  function open(id) {
    const it = I(id); if (!it || it.type !== 'doc') return;
    current = it; cand = null; seed = Math.floor(Math.random() * 1e9);
    const p = it.portrait, shape = (p && p.shape) || (isCharacter(it) ? 'portrait' : 'landscape'), style = (p && p.style) || 'dreamy';
    openModal(`<h3>🖼 Picture of “${esc(it.title)}”</h3>
      <div class="pt-grid">
        <div class="pt-frame ${shape}" id="ptFrame">${p ? `<img src="${p.src}" alt="Picture of ${esc(it.title)}">` : '<div class="pt-empty">✦<br>No picture yet</div>'}</div>
        <div>
          <label class="f" for="ptDesc">What the painter sees <span class="muted">(only this text is sent, so leave names out)</span></label>
          <textarea class="m-field pt-desc" id="ptDesc" rows="6" placeholder="e.g. A tall elf with silver braids, green eyes and a cloak made of moth wings">${esc((p && p.prompt) || describe(it))}</textarea>
          <label class="f">Style</label><div class="nm-choice" id="ptStyle">${Object.entries(STYLES).map(([k, [l]]) => `<button type="button" data-v="${k}" class="${k === style ? 'on' : ''}">${l}</button>`).join('')}</div>
          <label class="f">Shape</label><div class="nm-choice" id="ptShape"><button type="button" data-v="portrait" class="${shape === 'portrait' ? 'on' : ''}">Portrait</button><button type="button" data-v="landscape" class="${shape === 'landscape' ? 'on' : ''}">Landscape</button></div>
          <p class="pt-status" id="ptStatus" role="status" aria-live="polite"></p>
          <div class="pt-act"><button class="primary" id="ptPaint">✦ Paint</button><button class="primary" id="ptKeep" hidden>Use this picture</button>${p ? '<button class="ghost" id="ptSave">⇩ Save</button><button class="ghost danger" id="ptDel">Remove</button>' : ''}</div>
          <p class="pt-note">Painted by a free image AI. One picture every 45 seconds, about 10–30 seconds each.</p>
        </div>
      </div>
      <div class="m-act"><button class="ghost" data-x>Close</button></div>`, 'wide');
    choose('ptStyle'); choose('ptShape', v => { $('#ptFrame').className = 'pt-frame ' + v; });
    $('#ptPaint').onclick = paint;
    $('#ptKeep').onclick = keep;
    const sv = $('#ptSave'); if (sv) sv.onclick = () => saveFile(it.portrait, it.title);
    const dl = $('#ptDel'); if (dl) dl.onclick = async () => { if (!await confirmBox(`Remove the picture of “${esc(it.title)}”?`, 'Remove')) return open(it.id); delete it.portrait; it.modified = Date.now(); save(); refresh(); toast('Picture removed'); };
    if (Date.now() < wait) countdown(false); else buttons();
  }

  function countdown(auto) {
    clearInterval(waitT);
    const tickNow = () => {
      if (!$('#ptStatus')) { clearInterval(waitT); return; } // window closed
      const s = Math.ceil((wait - Date.now()) / 1000);
      if (s <= 0) { clearInterval(waitT); buttons(); if (auto) paint(); else status(''); return; }
      status(`The free painter allows one picture every 45 seconds. ${auto ? 'Painting' : 'Ready'} in ${s} s…`); buttons();
    };
    tickNow(); waitT = setInterval(tickNow, 1000);
  }

  async function paint() {
    if (busy || !current) return;
    const desc = clean($('#ptDesc').value, current.title);
    if (desc.length < 8) return status('Describe how they look first: a sentence or two is enough.', true);
    if (Date.now() < wait) return countdown(true);
    const style = val('ptStyle') || 'dreamy', shape = val('ptShape') || 'portrait', [w, h] = SIZES[shape];
    const prompt = `${desc}. ${shape === 'portrait' ? 'Fantasy character portrait, upper body' : 'Fantasy scene'}, ${STYLES[style][1]}, ${PALETTE}, highly detailed, beautiful, no text, no words, no watermark`;
    busy = true; buttons(); status('✦ Painting… this takes about 10–30 seconds');
    const frame = $('#ptFrame'); frame.classList.add('painting');
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 90000);
    let limited = false; // the service asked us to wait: its countdown will paint by itself, so don't replace it
    try {
      const r = await fetch(API + encodeURIComponent(prompt.slice(0, 900)) + `?width=${w}&height=${h}&seed=${seed}&nologo=true&safe=true`, { signal: ctrl.signal });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) {
        let msg = ''; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch { }
        if (r.status === 402 || r.status === 429 || /limit/i.test(String(msg))) {
          // "…1 image every 45 seconds… Retry after 41s": wait exactly as long as it says (the retry number, not the 45).
          const m = String(msg).match(/retry after\s*(\d+)/i) || [0, r.headers.get('retry-after')];
          const secs = +m[1] > 0 ? +m[1] : 45;
          wait = Date.now() + (secs + 1) * 1000; busy = false; frame.classList.remove('painting'); limited = true; return countdown(true);
        }
        throw Object.assign(new Error(String(msg || 'HTTP ' + r.status)), { status: r.status });
      }
      const src = await shrink(await r.blob(), w, h);
      cand = { src, prompt: $('#ptDesc').value.trim(), style, shape, seed, at: Date.now() };
      if ($('#ptFrame')) {
        $('#ptFrame').innerHTML = `<img src="${src}" alt="New picture of ${esc(current.title)}">`;
        $('#ptKeep').hidden = false; $('#ptPaint').textContent = '🎲 Paint another';
        status('Like it? Press “Use this picture”, or paint another.');
      }
      seed = Math.floor(Math.random() * 1e9);
      wait = Date.now() + 46000; // the free painter's pace
    } catch (e) {
      status(e.name === 'AbortError' ? 'The painter took too long. Try again in a moment.'
        : !navigator.onLine ? 'Painting needs the internet. Everything else still works offline.'
        : e.status === 403 ? 'The free painter refused this request. Please try again later.'
        : 'The painter couldn’t paint just now. Try again in a minute.', true);
    } finally {
      clearTimeout(to); busy = false; const f = $('#ptFrame'); if (f) f.classList.remove('painting');
      if (limited) return;
      if (Date.now() < wait && $('#ptStatus') && !cand) countdown(false); else buttons();
    }
  }
  // Keep pictures small: a JPEG at the painted size (about 50–90 KB) is plenty for the page and the backups.
  async function shrink(blob, w, h) {
    const bmp = await createImageBitmap(blob), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), k = Math.max(w / bmp.width, h / bmp.height), dw = bmp.width * k, dh = bmp.height * k;
    ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return cv.toDataURL('image/jpeg', 0.86);
  }
  function keep() {
    if (!cand || !current) return;
    current.portrait = cand; current.modified = Date.now(); save(); refresh();
    toast(`✦ Picture saved to “${current.title}”`);
  }
  function refresh() { closeModal(); renderMain(); if (S.side === 'inspect') renderInspector(); renderBinder(); }
  function saveFile(p, title) {
    if (!p) return; const bin = atob(p.src.split(',')[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    download(safeName(title) + '.jpg', new Blob([u], { type: 'image/jpeg' }), 'image/jpeg');
  }
  // Data repair: only keep a well-formed, reasonably small picture.
  function normalize(it) {
    const p = it.portrait;
    if (!p || typeof p !== 'object' || typeof p.src !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(p.src) || p.src.length > 3e6) { delete it.portrait; return; }
    it.portrait = { src: p.src, prompt: String(p.prompt || ''), style: STYLES[p.style] ? p.style : 'dreamy', shape: SIZES[p.shape] ? p.shape : 'portrait', seed: +p.seed || 0, at: +p.at || Date.now() };
  }
  const blobOf = p => { const bin = atob(p.src.split(',')[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'image/jpeg' }); };
  return { open, describe, normalize, blobOf, _clean: clean };
})();
