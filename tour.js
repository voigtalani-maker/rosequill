'use strict';
/* Rosequill guided tour. A spotlight walks through the main parts of the app with a short card for each.
   It starts by itself the first time Rosequill opens on a device; replay it from ▾ → Take the tour.
   On phones it opens the binder and side drawers as needed. Steps whose part isn't on screen are skipped. */
const Tour = (() => {
  const KEY = 'rq_tour_done';
  const small = () => innerWidth <= 960;
  let i = 0, steps = [], root = null, before = null;

  function drawer(which) {
    document.body.classList.toggle('show-binder', small() && which === 'binder');
    document.body.classList.toggle('show-side', small() && which === 'side');
  }
  // Make sure a page is open in Write mode so the editor steps have something to point at.
  function ensureDoc() {
    const p = P(); let it = I(p.current);
    if (!it || it.type !== 'doc' || inTrash(it.id)) {
      const find = id => { const x = p.items[id]; if (!x) return null; if (x.type === 'doc') return x; for (const c of x.children) { const f = find(c); if (f) return f; } return null; };
      const d = find(p.roots.manuscript) || find(p.roots.lore) || find(p.roots.research);
      if (d) p.current = d.id;
    }
    if (p.view !== 'write' || MODE !== 'write' || !$('#ed')) { p.view = 'write'; MODE = 'write'; render(); }
  }
  const side = tab => () => { if (S.side !== tab) { S.side = tab; renderSide(); } };

  const STEPS = [
    { title: 'Welcome to Rosequill ✦', text: 'Here is a one-minute tour of your writing studio. Press <b>Next</b>, or use the arrow keys.' },
    { el: '#tree', drawer: 'binder', title: 'The binder', text: 'Every page lives here. <b>Manuscript</b> is your story, <b>Lore &amp; Notes</b> holds characters, places and magic, and <b>Research</b> keeps everything else. Drag pages to reorder them, and press <b>⋯</b> on a page for more.' },
    { el: '.b-actions', drawer: 'binder', title: 'New pages and folders', text: '<b>+ Page</b> adds a page after the one you are on, <b>+ Folder</b> makes a chapter, and <b>+ Lore</b> gives ready-made templates for characters, places, creatures, spells and more.' },
    { el: '#ed', prep: ensureDoc, title: 'Write', text: 'Just type. Everything saves by itself as you write, so there is no Save button.' },
    { el: '#edTools', prep: ensureDoc, title: 'The toolbar', text: 'Bold, italic, headings, lists and a ✦ scene break. <b>Read</b> shows the page beautifully formatted. <b>◷</b> saves a snapshot before a big rewrite, and <b>◎</b> is focus mode.' },
    { el: '#edTools [data-fmt="link"]', prep: ensureDoc, title: 'Link your world', text: 'Type <b>[[</b> and pick a name to link to another page, like <b>[[Elowen Thorne]]</b>. A name that doesn’t exist yet becomes a new Lore page. <b>Ctrl + click</b> a link to jump there.' },
    { el: '#side', drawer: 'side', prep: side('oracle'), title: 'The Word Oracle', text: 'Double-click any word you have written (on a phone, select it and tap ✧). You get synonyms, opposites, meanings, rhymes and translations. Click one to swap it straight into your writing.' },
    { el: '.side-tabs [data-side="inspect"]', drawer: 'side', prep: side('inspect'), title: 'The Inspector', text: 'Shows this page’s index card, status and word target, every page that links here, and its snapshots.' },
    { el: '#views', prep: () => drawer(null), title: 'Five ways to see your book', text: '<b>Write</b> one page, plan scenes as index cards on the <b>Corkboard</b>, see everything at once in the <b>Outline</b>, and watch linked pages glow as stars in the <b>Constellation</b>.' },
    { el: '#views [data-view="maps"]', prep: () => drawer(null), title: 'Maps of your world', text: 'Rosequill can dream up a whole land for you, with coasts, mountains, forests, rivers and named towns. Reshape it, add castles and roads, and link places to your lore pages.' },
    { el: '#btnGoals', title: 'Word goals', text: 'Today’s words and your whole book’s progress. Click here to set your own goals.' },
    { el: '#btnTimer', title: 'Focus timer', text: 'Tap <b>⏱</b> to set a writing sprint (25 minutes, or any length you like), then start, pause or stop it. It quietly counts down here and tells you how many words you wrote.' },
    { el: '#btnProj', title: 'Your grimoires', text: 'Each book is a grimoire. Open this menu to start a new one, switch between them, or <b>Compile</b> a finished book into Word or PDF.' },
    { el: '#btnBackup', title: 'Backups', text: 'A <b>green dot</b> means your writing is safely backed up online. Open it to restore any of the last 30 days or download a <b>Word document</b>. On a computer you can also keep copies, Word file included, in a folder; pick one in Google Drive and it opens in Google Docs.' },
    { title: 'You’re ready ✦', text: 'Practise on <b>The Thornwood Chronicles</b>, then start your own book from the <b>▾</b> menu. <b>Ctrl + K</b> jumps to any page. You can replay this tour from <b>▾ → Take the tour</b>.' },
  ];

  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  async function prepare(s) {
    drawer(s.drawer || null);
    if (s.prep) s.prep();
    if (s.drawer && small()) await new Promise(r => setTimeout(r, 300)); // let the drawer slide in
    const el = s.el ? $(s.el) : null;
    if (el && !visible(el) && el.scrollIntoView) { el.scrollIntoView({ block: 'nearest' }); await new Promise(r => setTimeout(r, 60)); }
    return el;
  }

  function place() {
    if (!root) return;
    const s = steps[i], el = s.el ? $(s.el) : null, hole = $('.tour-hole', root), card = $('.tour-card', root);
    const pad = 6, M = 12;
    if (el && visible(el)) {
      const r = el.getBoundingClientRect();
      const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
      const w = Math.min(innerWidth - 4, r.right + pad) - x, h = Math.min(innerHeight - 4, r.bottom + pad) - y;
      hole.classList.remove('none');
      Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      const cw = card.offsetWidth, ch = card.offsetHeight;
      const spots = [
        [x + w / 2 - cw / 2, y + h + M],          // below
        [x + w / 2 - cw / 2, y - ch - M],         // above
        [x + w + M, y + h / 2 - ch / 2],          // right
        [x - cw - M, y + h / 2 - ch / 2],         // left
      ];
      const fits = ([l, t]) => l >= 8 && t >= 8 && l + cw <= innerWidth - 8 && t + ch <= innerHeight - 8;
      let [l, t] = spots.find(fits) || [innerWidth / 2 - cw / 2, innerHeight - ch - 16]; // big targets: card at the bottom
      l = Math.max(8, Math.min(l, innerWidth - cw - 8)); t = Math.max(8, Math.min(t, innerHeight - ch - 8));
      Object.assign(card.style, { left: l + 'px', top: t + 'px' });
    } else {
      hole.classList.add('none'); // nothing to point at: just dim the whole screen
      Object.assign(hole.style, { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', width: '0px', height: '0px' });
      Object.assign(card.style, { left: (innerWidth - card.offsetWidth) / 2 + 'px', top: Math.max(8, (innerHeight - card.offsetHeight) / 2) + 'px' });
    }
  }

  let token = 0;
  async function show(n, dir = 1) {
    const my = ++token; // a newer click wins; a slower step that finishes later is ignored
    i = n;
    const s = steps[i];
    const el = await prepare(s);
    if (my !== token || !root) return;
    if (s.el && !visible(el)) { // its part isn't on this screen (e.g. goals on a narrow window): skip it
      const next = n + dir;
      if (next >= 0 && next < steps.length) return show(next, dir);
    }
    const card = $('.tour-card', root);
    $('.tour-count', card).textContent = `${i + 1} of ${steps.length}`;
    $('#tourT', card).innerHTML = s.title;
    $('.tour-text', card).innerHTML = s.text;
    $('[data-t="back"]', card).hidden = i === 0;
    $('[data-t="next"]', card).textContent = i === steps.length - 1 ? 'Start writing ✦' : i === 0 ? 'Show me' : 'Next';
    $('[data-t="skip"]', card).hidden = i === steps.length - 1;
    $('.tour-dots', card).innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    place();
    $('[data-t="next"]', card).focus();
  }

  function start() {
    if (root) return;
    hideMenu(); if (!$('#modal').hidden) closeModal();
    document.body.classList.remove('focus');
    before = { side: S.side };
    steps = STEPS;
    root = document.createElement('div');
    root.className = 'tour'; root.id = 'tour';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'tourT');
    root.innerHTML = `<div class="tour-hole"></div><div class="tour-card" aria-live="polite">
      <div class="tour-count"></div><h3 id="tourT"></h3><p class="tour-text"></p><div class="tour-dots"></div>
      <div class="tour-act"><button class="tour-skip" data-t="skip">Skip tour</button><span class="spacer"></span><button class="ghost" data-t="back">Back</button><button class="primary" data-t="next">Next</button></div></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'next') { if (i < steps.length - 1) show(i + 1); else end(); }
      if (b.dataset.t === 'back' && i > 0) show(i - 1, -1);
      if (b.dataset.t === 'skip') end();
    });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    show(0);
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (i < steps.length - 1) show(i + 1); else end(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (i > 0) show(i - 1, -1); }
  }
  function end() {
    if (!root) return;
    root.remove(); root = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    drawer(null);
    if (before && S.side !== before.side) { S.side = before.side; renderSide(); }
    try { localStorage.setItem(KEY, '1'); } catch { }
    save();
  }
  function init() {
    let done = false; try { done = !!localStorage.getItem(KEY); } catch { }
    if (!done) setTimeout(() => { if ($('#modal').hidden) start(); }, 700);
  }
  return { init, start, end };
})();
