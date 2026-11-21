'use strict';
/* Rosequill focus timer: a small, quiet countdown in the top bar.
   Tap ⏱ to set minutes, start, pause or stop. While running the button shows only the time left.
   It counts the words written during the session and ends with an optional soft chime.
   State lives in localStorage (rq_timer), keyed on an end time, so a reload keeps it going. */
const Timer = (() => {
  const KEY = 'rq_timer', PRESETS = [10, 15, 25, 45, 60];
  const load = () => { try { return Object.assign({ mins: 25, endsAt: null, left: null, sound: true, startWords: 0 }, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { return { mins: 25, endsAt: null, left: null, sound: true, startWords: 0 }; } };
  let t = load(), tick = 0, endT = 0, pop = null, audio = null;
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { } };

  const running = () => !!t.endsAt, paused = () => !t.endsAt && t.left != null;
  const msLeft = () => running() ? Math.max(0, t.endsAt - Date.now()) : paused() ? t.left : t.mins * 60000;
  const fmt = ms => { const s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };
  // Words across every page that isn't in the Trash, so lore and notes count as writing too.
  const words = () => { try { return docs().filter(d => !inTrash(d.id)).reduce((n, d) => n + wordsIn(d.content), 0); } catch { return 0; } };
  const written = () => Math.max(0, words() - (t.startWords || 0));

  function paint() {
    const b = $('#btnTimer'); if (!b) return;
    const active = running() || paused();
    b.classList.toggle('on', active); b.classList.toggle('paused', paused());
    b.textContent = active ? (paused() ? '❚❚ ' : '') + fmt(msLeft()) : '⏱';
    b.title = active ? `Focus timer: ${fmt(msLeft())} left${paused() ? ' (paused)' : ''}` : 'Focus timer';
    b.setAttribute('aria-label', b.title);
    const fb = $('#focusTimer'); if (fb) fb.textContent = active ? '⏱ ' + fmt(msLeft()) : '';
    if (pop) drawPop();
  }
  function loop() {
    clearInterval(tick); clearTimeout(endT);
    if (running()) {
      tick = setInterval(paint, 1000);
      endT = setTimeout(finish, msLeft() + 50);
    }
    paint();
  }

  function chime() {
    if (!t.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const now = audio.currentTime;
      [[660, 0], [880, 0.28], [1320, 0.56]].forEach(([f, at]) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, now + at); g.gain.linearRampToValueAtTime(0.12, now + at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.1);
        o.connect(g).connect(audio.destination); o.start(now + at); o.stop(now + at + 1.2);
      });
    } catch { }
  }

  function start() {
    // Creating the sound now, inside the tap, lets the chime play later without being blocked.
    if (t.sound && !audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { } }
    if (paused()) { t.endsAt = Date.now() + t.left; t.left = null; }
    else { t.endsAt = Date.now() + t.mins * 60000; t.left = null; t.startWords = words(); }
    keep(); loop();
  }
  function pause() { if (!running()) return; t.left = msLeft(); t.endsAt = null; keep(); loop(); }
  function stop() { t.endsAt = null; t.left = null; keep(); loop(); }
  function finish() {
    if (!running()) return;
    const n = written();
    t.endsAt = null; t.left = null; keep(); loop();
    chime();
    const b = $('#btnTimer'); if (b) { b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 12000); }
    toast(`✦ Focus time is up${n ? `: ${fmtN(n)} words` : ''}. Time for a little break.`, 7000);
  }
  function setMins(m) { t.mins = Math.max(1, Math.min(180, Math.round(+m || 25))); keep(); paint(); }

  /* ---------- the small panel ---------- */
  function drawPop() {
    const active = running() || paused();
    pop.innerHTML = `<div class="tm-head">Focus timer</div>
      ${active ? `<div class="tm-big">${fmt(msLeft())}</div><div class="tm-sub">${paused() ? 'Paused' : 'Focusing'} · ${fmtN(written())} words so far</div>`
        : `<div class="tm-set"><button class="tm-step" data-tm="minus" aria-label="One minute less">−</button>
            <label class="tm-min"><input id="tmMins" type="number" min="1" max="180" value="${t.mins}" aria-label="Minutes"> min</label>
            <button class="tm-step" data-tm="plus" aria-label="One minute more">+</button></div>
          <div class="tm-presets">${PRESETS.map(m => `<button data-tm="set" data-m="${m}" class="${m === t.mins ? 'on' : ''}">${m}</button>`).join('')}</div>`}
      <div class="tm-act">${running() ? '<button class="primary" data-tm="pause">Pause</button>' : `<button class="primary" data-tm="start">${paused() ? 'Resume' : 'Start'}</button>`}
        ${active ? '<button class="ghost" data-tm="stop">Stop</button>' : ''}</div>
      <label class="tm-sound"><input type="checkbox" data-tm="sound" ${t.sound ? 'checked' : ''}> Soft chime when it ends</label>`;
  }
  function openPop() {
    if (pop) return closePop();
    const b = $('#btnTimer'), r = b.getBoundingClientRect();
    pop = document.createElement('div'); pop.className = 'timer-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Focus timer');
    document.body.appendChild(pop); drawPop();
    const w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    pop.addEventListener('click', onPop);
    pop.addEventListener('change', e => { if (e.target.id === 'tmMins') setMins(e.target.value); if (e.target.dataset.tm === 'sound') { t.sound = e.target.checked; keep(); } });
    pop.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'tmMins') { setMins(e.target.value); start(); } });
    setTimeout(() => { const f = pop && (pop.querySelector('[data-tm="start"],[data-tm="pause"]')); f && f.focus(); }, 0);
  }
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function onPop(e) {
    const b = e.target.closest('[data-tm]'); if (!b || b.dataset.tm === 'sound') return;
    const a = b.dataset.tm, inp = $('#tmMins');
    if (inp && a !== 'set') setMins(inp.value);
    if (a === 'minus') setMins(t.mins - 1);
    if (a === 'plus') setMins(t.mins + 1);
    if (a === 'set') setMins(b.dataset.m);
    if (a === 'start') { start(); closePop(); }
    if (a === 'pause') pause();
    if (a === 'stop') stop();
  }

  function init() {
    const b = $('#btnTimer'); if (!b || b.dataset.ready) return;
    b.dataset.ready = '1'; // set up once, even if init is called again
    b.addEventListener('click', e => { e.stopPropagation(); openPop(); });
    document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && e.target !== b) closePop(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) { e.stopPropagation(); closePop(); b.focus(); } }, true);
    window.addEventListener('resize', closePop);
    // A timer that ran out while the page was closed finishes quietly (no sound without a tap).
    if (running() && msLeft() <= 0) { const n = written(); t.endsAt = null; t.left = null; keep(); toast(`✦ Your focus timer ended while Rosequill was closed${n ? ` (${fmtN(n)} words)` : ''}.`, 6000); }
    loop();
  }
  return { init, start, pause, stop, open: openPop, _state: () => t };
})();
