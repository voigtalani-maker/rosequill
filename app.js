'use strict';
/* Rosequill — a writing studio (binder, corkboard, outline, compile),
   linked notes (wikilinks, backlinks, tags, constellation graph) and a word oracle
   (synonyms, meanings, rhymes, translations). Local-first: everything lives in IndexedDB. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const enc = encodeURIComponent;
const wordsIn = t => (String(t).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
const fmtN = n => n.toLocaleString('en-ZA').replace(/ /g, ' ');
const fmtK = n => {
  if (n < 1000) return String(n);
  if (n < 999500) { const v = n / 1000; return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + 'k'; }
  return Math.round(n / 1e5) / 10 + 'M';
};
const mdEsc = t => String(t).replace(/([\\`*_[\]#~=|>])/g, '\\$1'); // literal text inside generated markdown
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = t => new Date(t).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const ICON = {
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h4"/></svg>',
  manuscript: '<svg viewBox="0 0 24 24"><path d="M20 3C13 4 8 9 6.5 16L5 21"/><path d="M20 3c0 6-4 10-10 11"/><path d="M9 11l3 3"/></svg>',
  lore: '<svg viewBox="0 0 24 24"><path d="M12 3l2.1 6.2L20.5 12l-6.4 2.8L12 21l-2.1-6.2L3.5 12l6.4-2.8z"/></svg>',
  research: '<svg viewBox="0 0 24 24"><path d="M3.5 5.5C6 4 9.5 4 12 6c2.5-2 6-2 8.5-.5V19c-2.5-1.5-6-1.5-8.5.5-2.5-2-6-2-8.5-.5z"/><path d="M12 6v13.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};
const ROOTS = [['manuscript', 'Manuscript'], ['lore', 'Lore & Notes'], ['research', 'Research'], ['trash', 'Trash']];
const STATUSES = ['', 'Idea', 'To do', 'First draft', 'Revised', 'Final'];
const LABELS = ['', 'rose', 'lilac', 'gold', 'mint', 'sky'];
const TEMPLATES = {
  Character: '## At a glance\n- **Role:** \n- **Age:** \n- **Home:** \n\n## Appearance\n\n## Personality\n\n## Wants & fears\n\n## Connections\n- \n\n#character',
  Place: '## At a glance\n- **Realm:** \n- **Ruled by:** \n\n## What it looks like\n\n## History\n\n## Secrets\n\n#place',
  Creature: '## At a glance\n- **Habitat:** \n- **Danger:** \n\n## Description\n\n## Behaviour\n\n## Legends\n\n#creature',
  Artifact: '## At a glance\n- **Made by:** \n- **Power:** \n\n## Appearance\n\n## History\n\n## The cost of using it\n\n#artifact',
  Spell: '## At a glance\n- **School:** \n- **Words:** \n\n## Effect\n\n## Price & limits\n\n#spell',
  Faction: '## At a glance\n- **Leader:** \n- **Seat:** \n\n## Goals\n\n## Allies & enemies\n\n#faction',
};

/* ================= storage ================= */
const Store = {
  db: null,
  mode: 'idb', // 'idb' | 'local' (this browser has no IndexedDB) | 'failed' (IndexedDB exists but would not open)
  async init() {
    if (!window.indexedDB) { this.mode = 'local'; return; }
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('rosequill', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      // Let another tab upgrade or delete the database instead of being blocked forever by this one.
      this.db.onversionchange = () => {
        this.db.close(); this.db = null; this.mode = 'failed';
        setSaved('⚠ Reload to save', true);
        toast('Rosequill changed in another tab. Reload this page before writing more.', 10000);
      };
    } catch (e) {
      // Never fall back to a different store here: the real library may be in IndexedDB, and an
      // empty fallback would look like everything had vanished. Boot shows an error instead.
      this.db = null; this.mode = 'failed'; this.error = e;
    }
  },
  // Resolves undefined when nothing is stored, and REJECTS when the read itself fails,
  // so a failed read is never mistaken for an empty library.
  get(k) {
    if (this.mode === 'failed') return Promise.reject(this.error || new Error('storage unavailable'));
    if (!this.db) { try { const v = localStorage.getItem('rq_' + k); return Promise.resolve(v == null ? undefined : JSON.parse(v)); } catch (e) { return Promise.reject(e); } }
    return new Promise((res, rej) => {
      try { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error || new Error('read failed')); }
      catch (e) { rej(e); }
    });
  },
  // Rejects on any failure (quota, aborted transaction) so the caller can warn instead of claiming "Saved".
  set(k, v) {
    if (this.mode === 'failed') return Promise.reject(this.error || new Error('storage unavailable'));
    if (!this.db) { try { localStorage.setItem('rq_' + k, JSON.stringify(v)); return Promise.resolve(); } catch (e) { return Promise.reject(e); } }
    return new Promise((res, rej) => {
      try {
        const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error || new Error('write failed')); tx.onabort = () => rej(tx.error || new Error('write aborted'));
      } catch (e) { rej(e); }
    });
  },
  // Read, change and write in ONE transaction. IndexedDB runs read-write transactions on a store one at a
  // time, so two tabs can never both read revision N and both write N+1. fn runs synchronously inside it.
  update(k, fn) {
    if (this.mode === 'failed') return Promise.reject(this.error || new Error('storage unavailable'));
    if (!this.db) {
      try { const raw = localStorage.getItem('rq_' + k), v = fn(raw == null ? undefined : JSON.parse(raw)); localStorage.setItem('rq_' + k, JSON.stringify(v)); return Promise.resolve(v); }
      catch (e) { return Promise.reject(e); }
    }
    return new Promise((res, rej) => {
      try {
        const tx = this.db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'); let out;
        const q = st.get(k);
        q.onsuccess = () => { try { out = fn(q.result); st.put(out, k); } catch (e) { try { tx.abort(); } catch { } rej(e); } };
        tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error || new Error('write failed')); tx.onabort = () => rej(tx.error || new Error('write aborted'));
      } catch (e) { rej(e); }
    });
  },
};

let S = null;          // whole app state
let MODE = 'write';    // editor: write | read
let saveT = 0, dirty = false, flushing = null, saveFailed = false, retryT = 0, retryMs = 5000;
let baseState = null;  // a copy of S as last read or written: the common ancestor for merging tabs
const TAB = uid();     // identifies this tab when several are open
const snapshotBase = () => { try { baseState = structuredClone(S); } catch { baseState = JSON.parse(JSON.stringify(S)); } };

/* Several tabs can be open at once. Each save bumps S.rev and tells the other tabs;
   an idle tab reloads the newer state, and a tab with unsaved edits merges before writing. */
let bc = null;
try { bc = new BroadcastChannel('rosequill'); bc.onmessage = e => { if (e.data && e.data.type === 'saved' && e.data.tab !== TAB) remoteChanged(); }; } catch { }

function save() {
  dirty = true; clearTimeout(saveT); setSaved('Saving…');
  saveT = setTimeout(flush, 450);
}
async function flush() {
  clearTimeout(saveT); saveT = 0;
  while (flushing) await flushing;
  if (!dirty || !S) return;
  flushing = writeState();
  try { await flushing; } finally { flushing = null; }
}
async function writeState() {
  dirty = false;
  try {
    let merged = false;
    await Store.update('state', stored => {
      if (stored && stored.projects && (stored.rev || 0) > (S.rev || 0) && stored.writer !== TAB) { S = mergeRemote(stored); merged = true; }
      S.rev = Math.max(S.rev || 0, (stored && stored.rev) || 0) + 1; S.writer = TAB;
      return S;
    });
    snapshotBase();
    if (merged) { rerenderKeepCaret(); toast('✦ Merged with changes saved in another tab'); }
    try { localStorage.removeItem('rq_pending'); } catch { }
    clearTimeout(retryT); retryMs = 5000;
    if (saveFailed) toast('✦ Saving works again');
    saveFailed = false; setSaved(dirty ? 'Saving…' : 'Saved ✦');
    if (bc) bc.postMessage({ type: 'saved', tab: TAB, rev: S.rev });
    if (typeof Backup !== 'undefined') Backup.changed(); // folder copy + cloud backup follow a few seconds later
  } catch (e) {
    dirty = true; setSaved('⚠ Not saved', true);
    if (!saveFailed) toast('⚠ Rosequill could not save. Your device may be full. Use the grimoire menu ▾ → Export backup to keep a copy. It will keep trying.', 9000);
    saveFailed = true;
    // Try again by itself, waiting a little longer each time (5 s, 10 s, … up to a minute).
    clearTimeout(retryT); retryT = setTimeout(() => { if (dirty) flush(); }, retryMs); retryMs = Math.min(retryMs * 2, 60000);
  }
}
// The page is closing or being hidden: IndexedDB writes can't be awaited here, so keep a
// synchronous emergency copy in localStorage that boot() picks up if the real save didn't land.
function emergencySave() {
  if (!S || (!dirty && !flushing && !saveT)) return;
  let ok = false;
  try { localStorage.setItem('rq_pending', JSON.stringify(S)); ok = true; } catch { }
  if (!ok) { // too big for localStorage (maps make libraries large): keep at least the open grimoire
    try { localStorage.setItem('rq_pending', JSON.stringify({ partial: true, rev: S.rev, writer: TAB, project: P() })); ok = true; } catch { }
  }
  if (!ok) { try { localStorage.removeItem('rq_pending'); } catch { } }
  flush();
}
/* Three-way merge: what this tab changed since its base copy wins; everything else comes from the other tab.
   Works item by item (pages, folders, maps), so edits to different pages in two tabs both survive. */
function mergeRemote(R) {
  normalizeState(R);
  const B = baseState || { projects: {} }, J = x => JSON.stringify(x);
  for (const [pid, lp] of Object.entries(S.projects)) {
    const bp = B.projects && B.projects[pid], rp = R.projects[pid];
    if (!rp) { if (!bp || J(lp) !== J(bp)) { R.projects[pid] = lp; if (!R.order.includes(pid)) R.order.push(pid); } continue; } // new here, or changed here after the other tab deleted it
    for (const k of ['name', 'author', 'target', 'sessionTarget']) if (!bp || J(lp[k]) !== J(bp[k])) rp[k] = lp[k];
    const bi = (bp && bp.items) || {};
    for (const [id, it] of Object.entries(lp.items)) if (!bi[id] || J(it) !== J(bi[id])) rp.items[id] = it; // added or changed here
    for (const id of Object.keys(bi)) if (!lp.items[id]) delete rp.items[id];                              // deleted here
    const bm = (bp && bp.maps) || {}; rp.maps = rp.maps || {};
    for (const [id, m] of Object.entries(lp.maps || {})) if (!bm[id] || J(m) !== J(bm[id])) rp.maps[id] = m;
    for (const id of Object.keys(bm)) if (!(lp.maps || {})[id]) delete rp.maps[id];
    // Every page must sit in its folder's list; children lists taken from either side may miss the other's additions.
    for (const it of Object.values(rp.items)) if (it.parent && rp.items[it.parent] && rp.items[it.parent].type === 'folder' && !rp.items[it.parent].children.includes(it.id)) rp.items[it.parent].children.push(it.id);
    for (const f of Object.values(rp.items)) if (f.type === 'folder') f.children = f.children.filter(c => rp.items[c] && rp.items[c].parent === f.id);
    rp.current = rp.items[lp.current] ? lp.current : rp.current; rp.view = lp.view; rp.open = lp.open; rp.currentMap = lp.currentMap; rp.dayStart = lp.dayStart;
  }
  for (const pid of Object.keys((B && B.projects) || {})) if (!S.projects[pid] && R.projects[pid] && J(R.projects[pid]) === J(B.projects[pid])) { delete R.projects[pid]; R.order = R.order.filter(x => x !== pid); } // deleted here
  normalizeState(R);
  R.current = R.projects[S.current] ? S.current : R.order[0];
  R.theme = S.theme; R.side = S.side; R.lang = S.lang; R.gOrph = S.gOrph;
  return R;
}
async function remoteChanged() {
  if (dirty || flushing || saveT || !S) return; // our own next save will merge instead
  let R; try { R = await Store.get('state'); } catch { return; }
  if (!R || !R.projects || (R.rev || 0) <= (S.rev || 0) || dirty || flushing) return;
  normalizeState(R);
  const cur = S.current, p = P(), page = p && p.current, view = p && p.view;
  R.theme = S.theme; R.side = S.side; R.lang = S.lang; R.gOrph = S.gOrph;
  if (R.projects[cur]) { R.current = cur; const rp = R.projects[cur]; if (rp.items[page]) rp.current = page; if (view) rp.view = view; }
  S = R; snapshotBase(); rerenderKeepCaret();
}
function rerenderKeepCaret() {
  const ed = $('#ed'), focused = ed && document.activeElement === ed, s = ed ? ed.selectionStart : 0, e = ed ? ed.selectionEnd : 0, sc = $('#edScroll'), top = sc ? sc.scrollTop : null;
  render();
  const ed2 = $('#ed');
  if (ed2) { autosize(ed2); if (focused) { ed2.focus(); ed2.setSelectionRange(Math.min(s, ed2.value.length), Math.min(e, ed2.value.length)); } }
  const sc2 = $('#edScroll'); if (sc2 && top != null) sc2.scrollTop = top;
}
function setSaved(t, warn) { const el = $('#saved'); if (el) { el.textContent = t; el.classList.toggle('warn', !!warn); } }

/* ================= model helpers ================= */
const P = () => S.projects[S.current];
const I = id => P().items[id];
const docs = (p = P()) => Object.values(p.items).filter(i => i.type === 'doc');
function rootOf(id, p = P()) { let it = p.items[id]; while (it && it.parent) it = p.items[it.parent]; return it ? it.root : null; }
const inTrash = id => rootOf(id) === 'trash';
function isAncestor(a, b) { let it = I(b); while (it) { if (it.id === a) return true; it = it.parent ? I(it.parent) : null; } return false; }
function itemWords(it, p = P()) { return it.type === 'doc' ? wordsIn(it.content) : it.children.reduce((s, c) => s + itemWords(p.items[c], p), 0); }
function manuscriptWords(p = P()) { return itemWords(p.items[p.roots.manuscript], p); }
function linksIn(text) { const out = []; const re = /\[\[([^\][|\n]+)(?:\|[^\][\n]*)?\]\]/g; let m; while ((m = re.exec(text))) out.push(m[1].trim()); return out; }
// Tags are #word preceded by start/whitespace. Headings ("# Title") never match because a letter must follow
// the #; code spans are blanked first so `#notatag` inside backticks is ignored.
function tagsIn(text) { const out = new Set(); const re = /(^|\s)#([\p{L}][\p{L}\p{N}_-]*)/gu; const t = String(text).replace(/`[^`\n]*`/g, ' '); let m; while ((m = re.exec(t))) out.add(m[2].toLowerCase()); return [...out]; }
function findByTitle(t) { t = String(t).trim().toLowerCase(); if (!t) return null; return docs().find(d => d.title.trim().toLowerCase() === t && !inTrash(d.id)) || null; }
// Page titles are unique (case-insensitive, Trash included) so a [[link]] always means exactly one page.
function uniqueTitle(t, exceptId) {
  t = String(t).trim() || 'Untitled';
  const taken = new Set(docs().filter(d => d.id !== exceptId).map(d => d.title.trim().toLowerCase()));
  if (!taken.has(t.toLowerCase())) return t;
  let n = 2; while (taken.has((t + ' ' + n).toLowerCase())) n++;
  return t + ' ' + n;
}

/* Repairs a project loaded from storage or a backup file so every field the app reads exists. */
function normalizeProject(p) {
  const num = (v, d) => Number.isFinite(+v) && +v >= 0 ? +v : d;
  p.items = p.items && typeof p.items === 'object' ? p.items : {};
  p.roots = p.roots && typeof p.roots === 'object' ? p.roots : {};
  p.open = p.open && typeof p.open === 'object' ? p.open : {};
  p.dayStart = p.dayStart && typeof p.dayStart === 'object' ? p.dayStart : {};
  p.name = String(p.name || 'Untitled tale'); p.author = String(p.author || '');
  p.target = num(p.target, 50000); p.sessionTarget = num(p.sessionTarget, 500);
  if (!['write', 'cork', 'outline', 'graph', 'maps'].includes(p.view)) p.view = 'write';
  for (const [k, it] of Object.entries(p.items)) {
    if (!it || typeof it !== 'object') { delete p.items[k]; continue; }
    it.id = k; it.type = it.type === 'folder' ? 'folder' : 'doc';
    for (const f of ['title', 'content', 'synopsis', 'status', 'label']) it[f] = typeof it[f] === 'string' ? it[f] : '';
    if (!STATUSES.includes(it.status)) it.status = '';
    if (!LABELS.includes(it.label)) it.label = '';
    it.target = num(it.target, 0);
    it.snapshots = Array.isArray(it.snapshots) ? it.snapshots.filter(s => s && typeof s.content === 'string').map(s => ({ t: +s.t || Date.now(), name: String(s.name || 'Snapshot'), content: s.content })) : [];
    it.created = +it.created || Date.now(); it.modified = +it.modified || it.created;
    if (it.type === 'folder') it.children = Array.isArray(it.children) ? it.children.filter(c => typeof c === 'string') : [];
    else delete it.children;
  }
  for (const [k, t] of ROOTS) {
    let r = p.items[p.roots[k]];
    if (!r || r.type !== 'folder') { r = Object.values(p.items).find(i => i.root === k && i.type === 'folder') || mkItem(p, 'folder', t, null, { root: k }); p.roots[k] = r.id; }
    r.root = k; r.parent = null;
  }
  const rootIds = new Set(Object.values(p.roots)), seen = new Set(rootIds);
  for (const it of Object.values(p.items)) if (!rootIds.has(it.id)) delete it.root;
  const walk = f => {
    f.children = f.children.filter(c => p.items[c] && !seen.has(c) && seen.add(c));
    f.children.forEach(c => { p.items[c].parent = f.id; if (p.items[c].type === 'folder') walk(p.items[c]); });
  };
  ROOTS.forEach(([k]) => walk(p.items[p.roots[k]]));
  const research = p.items[p.roots.research]; // anything unreachable lands in Research rather than vanishing
  for (const it of Object.values(p.items)) if (!seen.has(it.id)) { seen.add(it.id); research.children.push(it.id); it.parent = research.id; if (it.type === 'folder') walk(it); }
  if (!p.items[p.current]) p.current = p.roots.manuscript;
  if (typeof Maps !== 'undefined') Maps.normalize(p); else { p.maps = p.maps || {}; p.mapOrder = p.mapOrder || []; }
  return p;
}
function normalizeState(st) {
  st.projects = st.projects && typeof st.projects === 'object' ? st.projects : {};
  for (const [id, p] of Object.entries(st.projects)) { if (!p || typeof p !== 'object') { delete st.projects[id]; continue; } p.id = id; normalizeProject(p); }
  st.order = (Array.isArray(st.order) ? st.order : []).filter((id, i, a) => st.projects[id] && a.indexOf(id) === i);
  Object.keys(st.projects).forEach(id => { if (!st.order.includes(id)) st.order.push(id); });
  if (!st.projects[st.current]) st.current = st.order[0];
  if (!['auto', 'light', 'dark'].includes(st.theme)) st.theme = 'auto';
  if (!['oracle', 'inspect'].includes(st.side)) st.side = 'oracle';
  st.lang = typeof st.lang === 'string' ? st.lang : 'af';
  return st;
}

function mkItem(p, type, title, parentId, extra = {}, index) {
  const it = { id: uid(), type, title, parent: parentId || null, content: '', synopsis: '', status: '', label: '', target: 0, created: Date.now(), modified: Date.now(), snapshots: [], ...extra };
  if (type === 'folder') it.children = [];
  p.items[it.id] = it;
  if (parentId) { const ch = p.items[parentId].children; index == null ? ch.push(it.id) : ch.splice(index, 0, it.id); }
  return it;
}

function newProject(name, sample) {
  const p = { id: uid(), name, created: Date.now(), target: 50000, sessionTarget: 500, author: '', dayStart: {}, items: {}, roots: {}, open: {}, current: null, view: 'write' };
  for (const [k, t] of ROOTS) { const r = mkItem(p, 'folder', t, null, { root: k }); p.roots[k] = r.id; p.open[r.id] = k !== 'trash'; }
  if (sample) { seedSample(p); p.sample = true; } else p.current = mkItem(p, 'doc', 'Chapter One', p.roots.manuscript).id;
  S.projects[p.id] = p; S.order.push(p.id); S.current = p.id;
  return p;
}

function seedSample(p) {
  const M = p.roots.manuscript, L = p.roots.lore, R = p.roots.research;
  const ch1 = mkItem(p, 'folder', 'Chapter One', M, { synopsis: 'Elowen finds the gate.' }); p.open[ch1.id] = true;
  mkItem(p, 'doc', 'The Rose Gate', ch1.id, { status: 'First draft', label: 'rose', synopsis: 'Elowen follows the singing thorns to a gate that should not exist.', content:
`The thorns began to sing on the night of the pink moon.

[[Elowen Thorne]] heard them first, a hum like bees in honey, threading through the shutters of her grandmother's cottage. She followed the sound past the well, past the last lantern, until the hedges of [[The Thornwood]] parted like a curtain.

There, where no gate had ever stood, rose an arch of living roses — every bloom turned towards her, every petal trembling.

"You're late," said the gate.

✦ ✦ ✦

She did not run. That, she would later think, was her first mistake.` });
  mkItem(p, 'doc', 'A Moonlit Bargain', ch1.id, { status: 'To do', label: 'lilac', synopsis: 'The gate offers a bargain: a memory for a key. Uses the [[Moonpetal Charm]].', content: 'Elowen bargains with the gate. Remember: the price is always a memory.\n\nShe offers the [[Moonpetal Charm]] instead.' });
  const ch2 = mkItem(p, 'folder', 'Chapter Two', M, { synopsis: 'Into the woods.' });
  mkItem(p, 'doc', 'Into the Thornwood', ch2.id, { status: 'Idea', synopsis: 'First night in the forest. Something follows her.', content: '' });

  mkItem(p, 'doc', 'Elowen Thorne', L, { label: 'rose', synopsis: 'Our heroine. Hears what plants say.', content:
`## At a glance
- **Role:** heroine
- **Age:** 17
- **Home:** a cottage at the edge of [[The Thornwood]]

## Appearance
Freckles, rose-gold hair always tangled with leaves.

## Wants & fears
Wants to know where her mother went. Fears forgetting her face.

#character` });
  mkItem(p, 'doc', 'The Thornwood', L, { label: 'mint', synopsis: 'A forest of singing roses.', content: '## What it looks like\nRoses as tall as towers. The thorns hum at night.\n\n## Secrets\nThe forest remembers everyone who has ever bled on its thorns. [[Elowen Thorne]]\'s mother walked in and never came out.\n\n#place' });
  mkItem(p, 'doc', 'Moonpetal Charm', L, { label: 'gold', synopsis: 'Pressed petal that holds one memory.', content: '## Effect\nA pressed moonpetal can hold a single memory, safe from any bargain.\n\n## Price & limits\nOnly works under a full moon. Belonged to [[Elowen Thorne]]\'s mother.\n\n#spell #artifact' });

  const w = mkItem(p, 'doc', '✦ Welcome to Rosequill', R, { label: 'gold', synopsis: 'How everything works.', content:
`Rosequill brings three tools together in one place: a **writing studio**, **linked notes** and a **word oracle**.

## ✦ The studio (like Scrivener)
- The **binder** on the left holds your Manuscript, Lore & Notes, Research and Trash. Drag pages to reorder them, or drop one on a folder to move it inside.
- Press **⋯** or right-click a page for more options.
- **Corkboard** shows each page as an index card. Write a synopsis on the card and drag cards to reorder scenes.
- **Outline** lists everything with status, word counts and targets.
- **Compile** joins your whole manuscript into one book: Word, HTML, Markdown, plain text or PDF.
- **Snapshots** save a copy of a page before you rewrite it.
- **Focus** hides everything except your words.

## ✦ Linked notes (like Obsidian)
- Type \`[[\` to link to another page, like [[Elowen Thorne]]. If the page doesn't exist yet, the link makes it.
- **Ctrl + click** a link while writing, or switch to **Read** mode, to follow it.
- The **Inspector** shows backlinks: every page that mentions this one.
- Add tags anywhere by typing # in front of a word, like #guide. Click a tag to find every page that has it.
- **Constellation** draws all your pages as stars joined by their links.
- **Ctrl + K** opens the quick switcher.

## ✦ The word oracle (like WordHippo)
- Double-click any word while writing, or select it and press **✧ Oracle**.
- Find synonyms, opposites, meanings, rhymes, describing words, related words, words that sound alike, and translations.
- Click a word to swap it into your writing. Click **›** to look that word up next.

Everything saves automatically. Tap **☁** to turn on backups (including a Word copy), and replay the guided tour any time from **▾ → Take the tour**.

#guide` });
  p.current = w.id;
}

/* ================= boot ================= */
(async function boot() {
  // Wait until every script on the page (docx, backup, maps, timer, tour) has loaded before starting.
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  // Opening storage can wait on another tab; say so instead of showing a blank page.
  const slow = setTimeout(() => { $('#main').innerHTML = '<div class="empty-main">Opening your saved work…<br>If this takes long, close other Rosequill tabs and reload this one.</div>'; }, 2500);
  await Store.init();
  clearTimeout(slow);
  // A failed read must never look like an empty library: stop here, write nothing, and say so.
  let stored;
  try { stored = await Store.get('state'); }
  catch (e) { return bootFailed('Rosequill couldn’t open the writing saved in this browser.'); }
  if (stored !== undefined && stored !== null && (typeof stored !== 'object' || !stored.projects || typeof stored.projects !== 'object')) return bootFailed('The writing saved in this browser looks damaged, so Rosequill hasn’t touched it.', stored);
  S = stored || null;
  // An emergency copy written while the page was closing wins if the real save never landed.
  let pend = null; try { pend = JSON.parse(localStorage.getItem('rq_pending')); } catch { }
  if (pend && !pend.partial && pend.projects && Object.keys(pend.projects).length && (!S || (pend.rev || 0) >= (S.rev || 0))) { S = pend; dirty = true; }
  else if (pend && pend.partial && pend.project && pend.project.id && S && (pend.rev || 0) >= (S.rev || 0)) { S.projects[pend.project.id] = pend.project; if (!S.order.includes(pend.project.id)) S.order.push(pend.project.id); dirty = true; }
  if (!S || !Object.keys(S.projects).length) { // truly nothing stored yet: a first visit
    S = { v: 1, rev: 0, projects: {}, order: [], current: null, theme: 'auto', side: 'oracle', lang: 'af', gOrph: true };
    newProject('The Thornwood Chronicles', true);
    MODE = 'read'; // show the welcome guide nicely formatted on first launch
    dirty = true;
  }
  normalizeState(S);
  snapshotBase();
  applyTheme();
  bindGlobal();
  ensureDay();
  render();
  if (dirty) flush(); else setSaved('Saved ✦');
  if (Store.mode === 'local') setTimeout(() => toast('This browser can’t use its main storage, so Rosequill is saving in a smaller space. Turn on ☁ backups to be safe.', 9000), 1500);
  if (typeof Backup !== 'undefined') Backup.init();
  if (typeof Timer !== 'undefined') Timer.init();
  if (typeof Tour !== 'undefined') Tour.init(); // first launch on this device: show the guided tour
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();

// Start-up could not read the library. Nothing is written; the writer can retry or save what is there.
function bootFailed(msg, raw) {
  $('#main').innerHTML = `<div class="empty-main" style="max-width:520px;margin:0 auto">
    <h2 style="font-family:var(--f-head);color:var(--rose2);font-style:normal">Your writing is safe, but…</h2>
    <p style="font-style:normal">${esc(msg)} Nothing has been changed or saved over.</p>
    <p style="font-style:normal">Close other Rosequill tabs and try again. If it keeps happening, restart the browser. Your ☁ cloud backup and any backup folder still have your work.</p>
    <div><button class="primary" id="bfRetry">Try again</button> ${raw ? '<button class="ghost" id="bfSave">⇩ Save what is stored</button>' : ''}</div></div>`;
  $('#bfRetry').onclick = () => location.reload();
  const sv = $('#bfSave'); if (sv) sv.onclick = () => { const b = new Blob([JSON.stringify(raw)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'rosequill-stored-' + today() + '.json'; a.click(); };
  setSaved('⚠ Not opened', true);
}
function ensureDay() {
  const p = P(), d = today();
  if (p.dayStart[d] == null) {
    p.dayStart[d] = manuscriptWords(p);
    const keys = Object.keys(p.dayStart).sort(); while (keys.length > 60) delete p.dayStart[keys.shift()];
    save();
  }
}
async function onVisible() { await remoteChanged(); ensureDay(); }

/* ================= rendering ================= */
function render() { renderHeader(); renderBinder(); renderMain(); renderSide(); }

function renderHeader() {
  const p = P();
  $('#projName').textContent = p.name;
  $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === p.view));
  updateGoals();
  const th = S.theme;
  $('#btnTheme').textContent = th === 'dark' ? '☀' : th === 'light' ? '☾' : '◐';
  $('#btnTheme').title = 'Theme: ' + (th === 'auto' ? 'follows your device' : th);
}
const updateGoals = debounce(() => {
  const p = P(); if (!p) return;
  const total = manuscriptWords(p), start = p.dayStart[today()] ?? total, todayW = Math.max(0, total - start);
  $('#gToday').style.width = Math.min(100, p.sessionTarget ? todayW / p.sessionTarget * 100 : 0) + '%';
  $('#gTotal').style.width = Math.min(100, p.target ? total / p.target * 100 : 0) + '%';
  $('#gTodayN').textContent = fmtN(todayW) + ' / ' + fmtK(p.sessionTarget);
  $('#gTotalN').textContent = fmtK(total) + ' / ' + fmtK(p.target);
  const fw = $('#focusWc'); if (fw) fw.textContent = fmtN(todayW) + ' words today';
}, 250);

/* ---------- binder ---------- */
function renderBinder() {
  const p = P(), q = $('#search').value.trim().toLowerCase(), tree = $('#tree');
  if (q) {
    const tag = q.startsWith('#') ? q.slice(1) : null; // "#" alone lists every tagged page
    const res = docs(p).filter(d => !inTrash(d.id) && (tag !== null ? (tag ? tagsIn(d.content).some(t => t.startsWith(tag)) : tagsIn(d.content).length > 0) : (d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q) || d.synopsis.toLowerCase().includes(q))));
    tree.innerHTML = res.length ? res.map(d => row(d, 0, q)).join('') : '<p class="empty">No pages found…</p>';
  } else {
    tree.innerHTML = ROOTS.map(([k]) => branch(p.items[p.roots[k]], 0)).join('');
  }
  const counts = {};
  docs(p).forEach(d => { if (!inTrash(d.id)) tagsIn(d.content).forEach(t => counts[t] = (counts[t] || 0) + 1); });
  $('#tags').innerHTML = Object.keys(counts).sort().map(t => `<button class="tagb" data-tag="${esc(t)}">#${esc(t)} <small>${counts[t]}</small></button>`).join('');
}
function branch(it, depth) {
  let h = row(it, depth);
  if (it.type === 'folder' && P().open[it.id]) h += it.children.map(c => branch(I(c), depth + 1)).join('');
  return h;
}
function row(it, depth, q) {
  const p = P(), k = rootOf(it.id), isF = it.type === 'folder';
  const icon = it.root ? ICON[it.root] : isF ? ICON.folder : (k === 'lore' ? ICON.lore : ICON.doc);
  const caret = isF ? `<span class="caret ${p.open[it.id] ? 'open' : ''}" data-caret>▶</span>` : '<span class="caret none"></span>';
  const wc = it.root === 'trash' ? (it.children.length || '') : fmtK(itemWords(it));
  let snip = '';
  if (q && !q.startsWith('#')) { const i = it.content.toLowerCase().indexOf(q); if (i >= 0) snip = `<span class="snip">…${esc(it.content.slice(Math.max(0, i - 20), i + 40).replace(/\n/g, ' '))}…</span>`; }
  return `<div class="row k-${k} ${it.root ? 'root' : ''} ${p.current === it.id ? 'sel' : ''}" data-id="${it.id}" draggable="${!it.root}" style="--d:${depth}">
    ${caret}<span class="ico">${icon}</span>
    ${it.label ? `<span class="dot" style="background:var(--${it.label})"></span>` : ''}
    <span class="ttl">${esc(it.title) || '<i class="muted">Untitled</i>'}${snip}</span><span class="wc">${wc || ''}</span>
    <button class="more" data-more aria-label="More options">⋯</button></div>`;
}
const binderSoon = debounce(() => renderBinder(), 900);

/* ---------- main area ---------- */
let G = null; // graph state
let DRAG_ID = null; // page being dragged, shared by binder rows and corkboard cards
function renderMain() {
  const p = P(), main = $('#main');
  if (G && G.raf) { cancelAnimationFrame(G.raf); G.raf = 0; }
  hideAC();
  const it = I(p.current);
  if (p.view === 'graph') return renderGraph(main);
  if (p.view === 'maps') return typeof Maps !== 'undefined' ? Maps.render(main) : (main.innerHTML = '<div class="empty-main">Maps are loading…</div>');
  if (p.view === 'outline') return renderOutline(main, folderFor(it));
  if (p.view === 'cork' || (it && it.type === 'folder')) return renderCork(main, folderFor(it));
  if (!it) { main.innerHTML = '<div class="empty-main">Choose a page from the binder.</div>'; return; }
  renderEditor(main, it);
}
function folderFor(it) { if (!it) return I(P().roots.manuscript); return it.type === 'folder' ? it : I(it.parent); }
function crumbs(it, self) {
  const parts = []; let x = self ? it : (it.parent ? I(it.parent) : null);
  while (x) { parts.unshift(x.title); x = x.parent ? I(x.parent) : null; }
  return parts.map(t => `<span>${esc(t)}</span>`).join('');
}

/* ---------- editor ---------- */
function renderEditor(main, it) {
  const trash = inTrash(it.id);
  main.innerHTML = `<div class="ed-scroll" id="edScroll"><div class="page">
    <div class="crumbs">${crumbs(it)}</div>
    <input class="doc-title" id="docTitle" value="${esc(it.title)}" placeholder="Untitled" aria-label="Page title" ${trash ? 'disabled' : ''}>
    <div class="ed-tools" id="edTools">
      <div class="seg"><button data-mode="write" class="${MODE === 'write' ? 'on' : ''}">Write</button><button data-mode="read" class="${MODE === 'read' ? 'on' : ''}">Read</button></div>
      <span class="tsep"></span>
      <button data-fmt="bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button data-fmt="italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button data-fmt="heading" title="Heading">H</button>
      <button data-fmt="quote" title="Quote">❝</button>
      <button data-fmt="list" title="Bulleted list">•≡</button>
      <button data-fmt="link" title="Link to another page">[[ ]]</button>
      <button data-fmt="scene" title="Scene break">✦</button>
      <span class="tsep"></span>
      <button data-act="oracle" title="Look up the selected word (Ctrl+Shift+O)">✧<span class="tl"> Oracle</span></button>
      <button data-act="snap" title="Save a snapshot of this page">◷<span class="tl"> Snapshot</span></button>
      <button data-act="focus" title="Focus mode">◎<span class="tl"> Focus</span></button>
      <span class="spacer"></span><span class="doc-wc" id="docWc"></span>
    </div>
    ${it.target ? '<div class="tbar"><i id="docBar"></i></div>' : ''}
    ${trash ? '<div class="trash-note">This page is in the Trash. <button id="restoreBtn">Restore it</button></div>' : ''}
    <textarea id="ed" class="ed" spellcheck="true" placeholder="Once upon a time…" aria-label="Page text" ${MODE === 'read' ? 'hidden' : ''}></textarea>
    <div id="reader" class="reader md" ${MODE === 'write' ? 'hidden' : ''}></div>
  </div></div>`;
  const ed = $('#ed');
  ed.value = it.content;
  if (MODE === 'read') renderReader(it);
  updateDocWc(it);
  bindEditor(ed, it);
  requestAnimationFrame(() => autosize(ed));
}
function renderReader(it) { $('#reader').innerHTML = md(it.content) || '<p class="muted"><i>Nothing written yet.</i></p>'; }
function autosize(ed) {
  if (!ed || ed.hidden) return;
  const sc = $('#edScroll'), top = sc ? sc.scrollTop : 0;
  ed.style.height = 'auto'; ed.style.height = Math.max(ed.scrollHeight, window.innerHeight * .55) + 'px';
  if (sc) sc.scrollTop = top;
}
function updateDocWc(it) {
  const n = wordsIn(it.content), el = $('#docWc');
  if (el) el.textContent = fmtN(n) + (it.target ? ' / ' + fmtN(it.target) : '') + ' words';
  const b = $('#docBar'); if (b) b.style.width = Math.min(100, n / it.target * 100) + '%';
}
function insertText(ta, s, e, text) {
  ta.focus(); ta.setSelectionRange(s, e);
  let ok = false; try { ok = document.execCommand('insertText', false, text); } catch { }
  if (!ok || ta.value.slice(s, s + text.length) !== text) { ta.setRangeText(text, s, e, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
}
function wordAt(ta, pos) {
  const v = ta.value; let s = pos, e = pos;
  while (s > 0 && /[\p{L}'’-]/u.test(v[s - 1])) s--;
  while (e < v.length && /[\p{L}'’-]/u.test(v[e])) e++;
  return { s, e, w: v.slice(s, e).replace(/^['’-]+|['’-]+$/g, '') };
}
const sideSoon = debounce(() => { if (S.side === 'inspect' && !$('#sideBody').contains(document.activeElement)) renderInspector(); }, 700);

function bindEditor(ed, it) {
  const title = $('#docTitle');
  title.addEventListener('input', () => { it.title = title.value; binderSoon(); save(); });
  title.addEventListener('change', () => { renameItem(it.id, title.value, it.titleBefore); it.titleBefore = undefined; title.value = it.title; renderBinder(); renderSide(); });
  title.addEventListener('focus', () => { it.titleBefore = it.title; });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });

  ed.addEventListener('input', () => {
    it.content = ed.value; it.modified = Date.now();
    autosize(ed); updateDocWc(it); updateGoals(); save(); sideSoon(); binderSoon(); checkAC();
  });
  ed.addEventListener('keydown', e => {
    if (!$('#ac').hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); AC.idx = (AC.idx + (e.key === 'ArrowDown' ? 1 : -1) + AC.items.length) % AC.items.length; drawAC(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickAC(AC.idx); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideAC(); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); fmt('bold'); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); fmt('italic'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); oracleFromEditor(); }
  });
  ed.addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey) { const t = linkAt(ed.value, ed.selectionStart); if (t) { e.preventDefault(); openLink(t); return; } }
    checkAC();
  });
  // Remember the selected word (trimmed) and its text, so a later swap can check it is still there.
  const markSel = () => {
    const v = ed.value; let s = ed.selectionStart, e = ed.selectionEnd;
    while (s < e && /\s/.test(v[s])) s++; while (e > s && /\s/.test(v[e - 1])) e--;
    if (e > s) OR.sel = { id: it.id, s, e, w: v.slice(s, e) };
    return e > s ? v.slice(s, e) : '';
  };
  ed.addEventListener('dblclick', () => setTimeout(() => {
    const w = markSel();
    if (w && /^[\p{L}'’-]{2,30}$/u.test(w) && S.side === 'oracle' && innerWidth > 960) lookup(w);
  }, 10));
  ed.addEventListener('mouseup', markSel); ed.addEventListener('keyup', markSel);
  ed.addEventListener('blur', () => setTimeout(hideAC, 150));

  $('#edTools').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { MODE = b.dataset.mode; renderEditor($('#main'), it); return; }
    if (b.dataset.fmt) { if (MODE === 'read') { MODE = 'write'; renderEditor($('#main'), it); } fmt(b.dataset.fmt); return; }
    if (b.dataset.act === 'oracle') oracleFromEditor();
    if (b.dataset.act === 'snap') takeSnapshot(it);
    if (b.dataset.act === 'focus') setFocus(true);
  });
  $('#reader').addEventListener('click', readerClick);
  const rb = $('#restoreBtn'); if (rb) rb.onclick = () => restoreItem(it.id);
}
function readerClick(e) {
  const l = e.target.closest('.wl'); if (l) { e.preventDefault(); openLink(unesc(l.dataset.link)); return; }
  const t = e.target.closest('.tag'); if (t) { searchTag(t.dataset.tag); }
}
function linkAt(v, pos) {
  const s = v.lastIndexOf('[[', pos); if (s < 0) return null;
  const close = v.indexOf(']]', s); if (close < 0 || close + 2 < pos) return null;
  const inner = v.slice(s + 2, close); if (inner.includes('\n')) return null;
  return inner.split('|')[0].trim() || null;
}
function fmt(kind) {
  const ta = $('#ed'); if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
  const wrap = (a, b, ph) => { const t = sel || ph; insertText(ta, s, e, a + t + b); ta.setSelectionRange(s + a.length, s + a.length + t.length); };
  const prefix = p => {
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    if (v.startsWith(p, ls)) insertText(ta, ls, ls + p.length, '');
    else { const strip = v.slice(ls).match(/^(#{1,6} |> |- )/); insertText(ta, ls, ls + (strip ? strip[0].length : 0), p); }
  };
  if (kind === 'bold') wrap('**', '**', 'bold words');
  if (kind === 'italic') wrap('*', '*', 'italic words');
  if (kind === 'heading') prefix('## ');
  if (kind === 'quote') prefix('> ');
  if (kind === 'list') prefix('- ');
  if (kind === 'link') { if (sel) wrap('[[', ']]', ''); else { insertText(ta, s, e, '[[]]'); ta.setSelectionRange(s + 2, s + 2); checkAC(); } }
  if (kind === 'scene') insertText(ta, s, e, (s && v[s - 1] !== '\n' ? '\n' : '') + '\n✦ ✦ ✦\n\n');
}

/* ---------- [[ autocomplete ---------- */
const AC = { items: [], idx: 0, start: 0, q: '' };
function checkAC() {
  const ta = $('#ed'); if (!ta || ta.selectionStart !== ta.selectionEnd) return hideAC();
  const pos = ta.selectionStart, m = ta.value.slice(Math.max(0, pos - 80), pos).match(/\[\[([^\][\n|]*)$/);
  if (!m) return hideAC();
  const q = m[1], ql = q.toLowerCase().trim(), cur = P().current;
  let items = docs().filter(d => d.id !== cur && !inTrash(d.id) && d.title.toLowerCase().includes(ql))
    .sort((a, b) => (b.title.toLowerCase().startsWith(ql) - a.title.toLowerCase().startsWith(ql)) || a.title.localeCompare(b.title))
    .slice(0, 8).map(d => ({ title: d.title, id: d.id, root: rootOf(d.id) }));
  // Offer "Create" only when no page at all has this title: not this page, and not one in the Trash.
  if (ql && !docs().some(d => d.title.trim().toLowerCase() === ql)) items.push({ title: q.trim(), create: true });
  if (!items.length) return hideAC();
  Object.assign(AC, { items, idx: 0, start: pos - q.length, q });
  drawAC();
  const xy = caretXY(ta), box = $('#ac');
  box.style.left = Math.min(xy.x, innerWidth - 300) + 'px';
  box.style.top = (xy.y + 260 > innerHeight ? xy.y - 270 - 24 : xy.y + 4) + 'px';
}
function drawAC() {
  const box = $('#ac'); box.hidden = false;
  box.innerHTML = AC.items.map((it, i) => `<button data-i="${i}" class="${i === AC.idx ? 'on' : ''}">${it.create ? '✦ Link to <b>' + esc(it.title) + '</b>' : esc(it.title)}<span class="k">${it.create ? 'new page' : it.root}</span></button>`).join('');
}
function pickAC(i) {
  const ta = $('#ed'), item = AC.items[i]; if (!ta || !item) return;
  const pos = ta.selectionStart, close = ta.value.slice(pos, pos + 2) === ']]';
  insertText(ta, AC.start, pos, item.title + (close ? '' : ']]'));
  const end = AC.start + item.title.length + 2; ta.setSelectionRange(end, end);
  hideAC();
  // A link to a page that doesn't exist yet is just a link: the page is made only if she opens it.
  if (item.create) toast(`Linked to “${item.title}”. Ctrl + click it (or open it in Read mode) to create that page`, 5000);
}
function hideAC() { const b = $('#ac'); if (b) b.hidden = true; }
function caretXY(ta) {
  const cs = getComputedStyle(ta), div = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'boxSizing', 'tabSize']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', width: ta.clientWidth + 'px', left: '-9999px', top: '0' });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement('span'); span.textContent = '​'; div.appendChild(span);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect(), x = r.left + span.offsetLeft, y = r.top + span.offsetTop + (parseFloat(cs.lineHeight) || 28);
  div.remove();
  return { x, y };
}

/* ---------- markdown renderer ---------- */
function md(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let html = '', para = [], list = null, quote = [];
  const fP = () => { if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  const fL = () => { if (list) { html += `<${list.t}>` + list.items.map(x => '<li>' + x + '</li>').join('') + `</${list.t}>`; list = null; } };
  const fQ = () => { if (quote.length) { html += '<blockquote>' + md(quote.join('\n')) + '</blockquote>'; quote = []; } };
  const all = () => { fP(); fL(); fQ(); };
  for (const line of lines) {
    let m;
    if (/^\s*$/.test(line)) { all(); continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { all(); const n = Math.min(m[1].length, 4); html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if (/^\s*(\*\s*\*\s*\*|-{3,}|_{3,}|(✦\s*){1,5}|❦|#)\s*$/.test(line)) { all(); html += '<hr class="scene">'; continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { fP(); fL(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/))) {
      fP(); fQ(); if (!list || list.t !== 'ul') { fL(); list = { t: 'ul', items: [] }; }
      list.items.push((m[1] ? `<span class="chk">${m[1] === ' ' ? '☐' : '☑'}</span>` : '') + inline(m[2])); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { fP(); fQ(); if (!list || list.t !== 'ol') { fL(); list = { t: 'ol', items: [] }; } list.items.push(inline(m[1])); continue; }
    fL(); fQ(); para.push(line);
  }
  all();
  return html;
}
function inline(s) {
  // Backslash escapes (\* \# …) become literal characters; code spans are set aside so nothing
  // inside them is turned into bold, links or tags.
  const lit = [], codes = [], links = [];
  s = String(s).replace(/\\([\\`*_[\]#~=|>!()-])/g, (m, c) => { lit.push(c); return '\u0002' + (lit.length - 1) + '\u0002'; });
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0003' + (codes.length - 1) + '\u0003'; });
  s = s.replace(/\[\[([^\][|\n]+)(?:\|([^\][\n]+))?\]\]/g, (m, t, a) => { links.push([t.trim(), a]); return '\u0000' + (links.length - 1) + '\u0000'; });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)#([\p{L}][\p{L}\p{N}_-]*)/gu, '$1<span class="tag" data-tag="$2">#$2</span>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => {
    const [t, a] = links[i], ok = S && S.current ? findByTitle(unesc(t)) : true;
    return `<a class="wl${ok ? '' : ' missing'}" data-link="${t}" title="${ok ? 'Open' : 'Create'} “${t}”">${a || t}</a>`;
  });
  return s.replace(/\u0003(\d+)\u0003/g, (m, i) => `<code>${codes[i]}</code>`).replace(/\u0002(\d+)\u0002/g, (m, i) => esc(lit[i]));
}

/* ---------- corkboard ---------- */
function renderCork(main, f) {
  const p = P(), kids = f.children.map(id => p.items[id]);
  const card = k => `<article class="card lbl-${k.label || 'none'} ${k.id === p.current ? 'cur' : ''}" draggable="true" data-id="${k.id}">
      <header><span class="ico">${k.type === 'folder' ? ICON.folder : ICON.doc}</span><button class="c-title" data-open="${k.id}">${esc(k.title) || 'Untitled'}</button></header>
      <textarea class="c-syn" data-id="${k.id}" placeholder="Write a synopsis…" aria-label="Synopsis">${esc(k.synopsis)}</textarea>
      <footer><span>${esc(k.status) || (k.type === 'folder' ? k.children.length + ' inside' : '')}</span><span>${fmtN(itemWords(k))} words</span></footer></article>`;
  main.innerHTML = `<div class="cork-scroll" id="corkWrap">
    <div class="cork-head"><div><div class="crumbs">${crumbs(f)}</div><h2>${esc(f.title)}</h2></div><span class="spacer"></span>
    ${f.root === 'trash' ? (kids.length ? '<button class="ghost danger" id="cEmpty">Empty the Trash</button>' : '') : '<button class="primary" id="cNew">+ New card</button>'}</div>
    ${kids.length ? `<div class="cork" id="cork">${kids.map(card).join('')}</div>` : `<div class="empty-main">${f.root === 'trash' ? 'The Trash is empty.' : 'No cards here yet.'}</div>`}
  </div>`;
  const w = $('#corkWrap');
  const nb = $('#cNew'); if (nb) nb.onclick = () => { const d = createDoc(f.id, 'New scene'); P().view = 'cork'; P().current = d.id; save(); render(); setTimeout(() => { const t = $(`.c-syn[data-id="${d.id}"]`); t && t.focus(); }, 50); };
  const eb = $('#cEmpty'); if (eb) eb.onclick = emptyTrash;
  w.addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) openItem(o.dataset.open, true); });
  w.addEventListener('input', e => { if (e.target.classList.contains('c-syn')) { const it = I(e.target.dataset.id); it.synopsis = e.target.value; it.modified = Date.now(); save(); } });
  w.addEventListener('dragstart', e => { const c = e.target.closest('.card'); if (!c) return; DRAG_ID = c.dataset.id; e.dataTransfer.setData('text/plain', DRAG_ID); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
  w.addEventListener('dragend', () => { $$('.card', w).forEach(c => c.classList.remove('dragging', 'drop-l', 'drop-r')); DRAG_ID = null; });
  w.addEventListener('dragover', e => {
    const c = e.target.closest('.card'); if (!c || !DRAG_ID || c.dataset.id === DRAG_ID) return;
    e.preventDefault(); const r = c.getBoundingClientRect(), left = e.clientX < r.left + r.width / 2;
    $$('.card', w).forEach(x => x.classList.remove('drop-l', 'drop-r')); c.classList.add(left ? 'drop-l' : 'drop-r');
  });
  w.addEventListener('drop', e => {
    const c = e.target.closest('.card'); if (!c || !DRAG_ID) return; e.preventDefault();
    const r = c.getBoundingClientRect(); moveItem(DRAG_ID, c.dataset.id, e.clientX < r.left + r.width / 2 ? 'before' : 'after');
    save(); renderMain(); renderBinder();
  });
}

/* ---------- outline ---------- */
function renderOutline(main, f) {
  const p = P(), rows = [];
  const walk = (id, d) => { const it = p.items[id]; rows.push([it, d]); if (it.type === 'folder') it.children.forEach(c => walk(c, d + 1)); };
  f.children.forEach(c => walk(c, 0));
  const tr = ([it, d]) => {
    const wc = itemWords(it);
    return `<tr class="${it.type === 'folder' ? 'fold' : ''}"><td><div class="t" style="padding-left:${d * 1.1}rem"><span class="ico">${it.type === 'folder' ? ICON.folder : ICON.doc}</span><button class="ol-open" data-open="${it.id}">${esc(it.title) || 'Untitled'}</button></div></td>
      <td><input class="ol-syn" data-id="${it.id}" value="${esc(it.synopsis)}" placeholder="—" aria-label="Synopsis"></td>
      <td><select class="ol-st" data-id="${it.id}" aria-label="Status">${STATUSES.map(s => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}</select></td>
      <td class="num">${fmtN(wc)}</td>
      <td class="num">${it.type === 'doc' && it.target ? fmtN(it.target) + `<span class="mini-bar"><i style="width:${Math.min(100, wc / it.target * 100)}%"></i></span>` : '—'}</td></tr>`;
  };
  main.innerHTML = `<div class="ol-scroll" id="olWrap"><div class="cork-head"><div><div class="crumbs">${crumbs(f)}</div><h2>${esc(f.title)}</h2></div><span class="spacer"></span><span class="muted">${fmtN(itemWords(f))} words</span></div>
    ${rows.length ? `<div class="ol-wrap"><table class="outline"><thead><tr><th>Title</th><th>Synopsis</th><th>Status</th><th class="num">Words</th><th class="num">Target</th></tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>` : '<div class="empty-main">Nothing in this folder yet.</div>'}</div>`;
  const w = $('#olWrap');
  w.addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) openItem(o.dataset.open, true); });
  w.addEventListener('input', e => { if (e.target.classList.contains('ol-syn')) { I(e.target.dataset.id).synopsis = e.target.value; save(); } });
  w.addEventListener('change', e => { if (e.target.classList.contains('ol-st')) { I(e.target.dataset.id).status = e.target.value; save(); } });
}

/* ---------- constellation graph ---------- */
function renderGraph(main) {
  main.innerHTML = `<div class="graph-wrap" id="gw"><canvas id="gc" aria-label="Map of linked pages"></canvas>
    <div class="g-legend"><span><i style="background:var(--rose)"></i>Manuscript</span><span><i style="background:var(--lilac)"></i>Lore</span><span><i style="background:var(--gold)"></i>Research</span></div>
    <div class="g-tools"><label><input type="checkbox" id="gOrph" ${S.gOrph !== false ? 'checked' : ''}> Unlinked pages</label><button id="gFit">Re-centre</button></div>
    <p class="g-hint">Drag stars to move them · scroll or pinch to zoom · tap a star to open its page</p></div>`;
  const p = P(), same = G && G.pid === p.id, pos = same ? G.pos : new Map();
  let list = docs(p).filter(d => !inTrash(d.id));
  const byT = new Map(list.map(d => [d.title.trim().toLowerCase(), d]));
  const seen = new Set(), raw = [];
  list.forEach(d => linksIn(d.content).forEach(t => { const o = byT.get(t.toLowerCase()); if (o && o !== d) { const k = [d.id, o.id].sort().join('|'); if (!seen.has(k)) { seen.add(k); raw.push([d.id, o.id]); } } }));
  const deg = {}; raw.forEach(([a, b]) => { deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; });
  if (S.gOrph === false) list = list.filter(d => deg[d.id]);
  const nodes = list.map((d, i) => { const o = pos.get(d.id), a = i * 2.399, r = 34 * Math.sqrt(i + 1); return { id: d.id, title: d.title, root: rootOf(d.id), deg: deg[d.id] || 0, x: o ? o.x : Math.cos(a) * r, y: o ? o.y : Math.sin(a) * r, vx: 0, vy: 0 }; });
  const idx = new Map(nodes.map(n => [n.id, n]));
  G = { pid: p.id, nodes, idx, pos, edges: raw.filter(([a, b]) => idx.has(a) && idx.has(b)).map(([a, b]) => [idx.get(a), idx.get(b)]),
    scale: same ? G.scale : 1, ox: same ? G.ox : 0, oy: same ? G.oy : 0, alpha: same ? .3 : 1, hover: null, drag: null, down: null, dirty: true, raf: 0, ptrs: new Map() };
  const cv = $('#gc'), ctx = cv.getContext('2d'), wrap = $('#gw');
  const cs = getComputedStyle(document.documentElement), col = v => cs.getPropertyValue(v).trim();
  const C = { manuscript: col('--rose'), lore: col('--lilac'), research: col('--gold'), line: col('--line2'), ink: col('--ink'), panel: col('--panel'), sel: col('--rose2') };
  const size = () => { const r = wrap.getBoundingClientRect(), d = devicePixelRatio || 1; cv.width = r.width * d; cv.height = r.height * d; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; ctx.setTransform(d, 0, 0, d, 0, 0); G.w = r.width; G.h = r.height; G.dirty = true; };
  size(); const ro = new ResizeObserver(size); ro.observe(wrap);
  const sx = n => G.w / 2 + G.ox + n.x * G.scale, sy = n => G.h / 2 + G.oy + n.y * G.scale;
  const rad = n => 4.5 + Math.min(n.deg, 10) * 1.3;
  function tick() {
    const N = G.nodes, a = G.alpha;
    for (let i = 0; i < N.length; i++) { const n = N[i]; for (let j = i + 1; j < N.length; j++) { const m = N[j]; let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy || .01; if (d2 > 160000) continue; const d = Math.sqrt(d2), f = Math.min(8, 1600 / d2) * a; dx /= d; dy /= d; n.vx += dx * f; n.vy += dy * f; m.vx -= dx * f; m.vy -= dy * f; } }
    for (const [s, t] of G.edges) { let dx = t.x - s.x, dy = t.y - s.y; const d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 85) * .03 * a; dx /= d; dy /= d; s.vx += dx * f; s.vy += dy * f; t.vx -= dx * f; t.vy -= dy * f; }
    for (const n of N) { n.vx -= n.x * .005 * a; n.vy -= n.y * .005 * a; if (n === G.drag) { n.vx = n.vy = 0; } else { n.vx *= .82; n.vy *= .82; n.x += n.vx; n.y += n.vy; } G.pos.set(n.id, { x: n.x, y: n.y }); }
    G.alpha *= .985;
  }
  function draw() {
    ctx.clearRect(0, 0, G.w, G.h);
    const hv = G.hover, nb = new Set();
    if (hv) { nb.add(hv); G.edges.forEach(([a, b]) => { if (a === hv) nb.add(b); if (b === hv) nb.add(a); }); }
    ctx.lineWidth = 1.2; ctx.strokeStyle = C.line;
    for (const [a, b] of G.edges) { ctx.globalAlpha = hv ? ((a === hv || b === hv) ? .95 : .12) : .65; ctx.beginPath(); ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b), sy(b)); ctx.stroke(); }
    ctx.font = '12px Lora, Georgia, serif'; ctx.textAlign = 'center';
    for (const n of G.nodes) {
      const x = sx(n), y = sy(n), r = rad(n), c = C[n.root] || C.manuscript;
      ctx.globalAlpha = hv && !nb.has(n) ? .25 : 1;
      ctx.shadowColor = c; ctx.shadowBlur = n === hv ? 22 : 12; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = C.panel; ctx.beginPath(); ctx.arc(x - r * .3, y - r * .3, r * .3, 0, Math.PI * 2); ctx.globalAlpha *= .6; ctx.fill(); ctx.globalAlpha = hv && !nb.has(n) ? .25 : 1;
      if (n.id === P().current) { ctx.strokeStyle = C.sel; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1.2; ctx.strokeStyle = C.line; }
      if (G.scale > .75 || n.deg > 1 || nb.has(n)) { ctx.fillStyle = C.ink; ctx.fillText(n.title.length > 28 ? n.title.slice(0, 26) + '…' : n.title, x, y + r + 14); }
    }
    ctx.globalAlpha = 1;
  }
  const loop = () => { if (!cv.isConnected) { ro.disconnect(); return; } if (G.alpha > .02) { tick(); G.dirty = true; } if (G.dirty) { draw(); G.dirty = false; } G.raf = requestAnimationFrame(loop); };
  loop();
  const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const hit = pt => { let best = null, bd = 1e9; for (const n of G.nodes) { const d = Math.hypot(sx(n) - pt.x, sy(n) - pt.y); if (d < rad(n) + 8 && d < bd) { bd = d; best = n; } } return best; };
  const zoomAt = (pt, k) => { const wx = (pt.x - G.w / 2 - G.ox) / G.scale, wy = (pt.y - G.h / 2 - G.oy) / G.scale; G.scale = Math.max(.2, Math.min(4, G.scale * k)); G.ox = pt.x - G.w / 2 - wx * G.scale; G.oy = pt.y - G.h / 2 - wy * G.scale; G.dirty = true; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const pt = local(e); G.ptrs.set(e.pointerId, pt);
    if (G.ptrs.size === 2) { const [a, b] = [...G.ptrs.values()]; G.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; G.drag = null; G.down = null; return; }
    const n = hit(pt); G.down = { x: pt.x, y: pt.y, n, ox: G.ox, oy: G.oy, moved: 0 }; G.drag = n; cv.classList.add('grabbing');
  });
  cv.addEventListener('pointermove', e => {
    const pt = local(e);
    if (G.ptrs.has(e.pointerId)) G.ptrs.set(e.pointerId, pt);
    if (G.pinch && G.ptrs.size === 2) { const [a, b] = [...G.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d / G.pinch.d); G.pinch.d = d; return; }
    if (G.down) {
      const dx = pt.x - G.down.x, dy = pt.y - G.down.y; G.down.moved = Math.max(G.down.moved, Math.hypot(dx, dy));
      if (G.drag) { G.drag.x = (pt.x - G.w / 2 - G.ox) / G.scale; G.drag.y = (pt.y - G.h / 2 - G.oy) / G.scale; G.alpha = Math.max(G.alpha, .25); }
      else { G.ox = G.down.ox + dx; G.oy = G.down.oy + dy; }
      G.dirty = true;
    } else { const h = hit(pt); if (h !== G.hover) { G.hover = h; G.dirty = true; cv.style.cursor = h ? 'pointer' : ''; } }
  });
  const up = e => {
    G.ptrs.delete(e.pointerId); if (G.ptrs.size < 2) G.pinch = null;
    if (G.down && G.down.moved < 5 && G.down.n) openItem(G.down.n.id, true);
    G.down = null; G.drag = null; cv.classList.remove('grabbing');
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { if (!G.down && G.hover) { G.hover = null; G.dirty = true; } });
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(local(e), Math.exp(-e.deltaY * .0015)); }, { passive: false });
  $('#gOrph').onchange = e => { S.gOrph = e.target.checked; save(); renderGraph(main); };
  $('#gFit').onclick = () => {
    if (!G.nodes.length) return; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    G.nodes.forEach(n => { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); });
    G.scale = Math.max(.25, Math.min(2, Math.min((G.w - 120) / ((x1 - x0) || 1), (G.h - 140) / ((y1 - y0) || 1))));
    G.ox = -((x0 + x1) / 2) * G.scale; G.oy = -((y0 + y1) / 2) * G.scale; G.dirty = true;
  };
  if (!nodes.length) wrap.insertAdjacentHTML('beforeend', '<div class="empty-main" style="position:absolute;inset:0">No pages to map yet. Link pages with [[ ]] to draw your constellation.</div>');
}

/* ================= side panel ================= */
function renderSide() {
  $$('.side-tabs button').forEach(b => b.classList.toggle('on', b.dataset.side === S.side));
  if (S.side === 'oracle') renderOracle(); else renderInspector();
}

/* ---------- inspector ---------- */
function renderInspector() {
  const it = I(P().current), b = $('#sideBody');
  if (!it) { b.innerHTML = '<p class="muted">Nothing selected.</p>'; return; }
  const isDoc = it.type === 'doc';
  let extra = '';
  if (isDoc) {
    const out = [...new Set(linksIn(it.content))];
    const bl = backlinks(it), um = unlinkedMentions(it);
    extra += `<label class="lbl">Links from this page · ${out.length}</label><div class="lk">${out.length ? out.map(t => { const d = findByTitle(t); return `<button class="l ${d ? '' : 'missing'}" data-link="${esc(t)}">${d ? '' : '✦ '}${esc(t)}${d ? '' : ' <small>(not written yet, click to create)</small>'}</button>`; }).join('') : '<p class="help">Type [[ in your text to link another page.</p>'}</div>`;
    extra += `<label class="lbl">Backlinks · ${bl.length}</label><div class="lk">${bl.length ? bl.map(d => `<button class="l" data-open="${d.id}">${esc(d.title)}<span class="snip">${snippet(d.content, it.title)}</span></button>`).join('') : '<p class="help">No other page links here yet.</p>'}</div>`;
    if (um.length) extra += `<label class="lbl">Unlinked mentions · ${um.length}</label><div class="lk">${um.map(d => `<div class="row2"><button class="l" data-open="${d.id}">${esc(d.title)}<span class="snip">${snippet(d.content, it.title, true)}</span></button><button class="mini" data-linkall="${d.id}">Link</button></div>`).join('')}</div>`;
    const onMaps = typeof Maps !== 'undefined' ? Maps.pinsLinkedTo(it.title) : [];
    if (onMaps.length) extra += `<label class="lbl">On your maps · ${onMaps.length}</label><div class="lk">${onMaps.map(({ map, pin }) => `<button class="l" data-mappin="${map.id}|${pin.id}">🗺 ${esc(pin.name)}<span class="snip">on “${esc(map.name)}”</span></button>`).join('')}</div>`;
    extra += `<label class="lbl">Snapshots · ${it.snapshots.length}</label><button class="ghost" id="iSnap" style="width:100%">◷ Take a snapshot now</button>
      <div>${it.snapshots.map((s, i) => `<div class="snap"><span class="when">${esc(s.name || 'Snapshot')}<small>${fmtDate(s.t)} · ${fmtN(wordsIn(s.content))} words</small></span><button data-snapv="${i}">View</button><button data-snapr="${i}">Restore</button><button data-snapd="${i}" aria-label="Delete snapshot">✕</button></div>`).join('')}</div>`;
  } else {
    const all = []; const walk = id => { const x = I(id); if (x.type === 'doc') all.push(x); else x.children.forEach(walk); }; walk(it.id);
    extra = `<label class="lbl">Inside</label><div class="stat-grid"><div class="stat"><b>${fmtN(all.length)}</b><span>pages</span></div><div class="stat"><b>${fmtN(itemWords(it))}</b><span>words</span></div>
      <div class="stat"><b>${all.filter(d => d.status === 'Final').length}</b><span>marked Final</span></div><div class="stat"><b>${Math.round(itemWords(it) / 250) || 0}</b><span>pages printed (approx.)</span></div></div>`;
  }
  b.innerHTML = `<div class="insp">
    <label class="lbl">Index card</label>
    <div class="card-mini lbl-${it.label || 'none'}"><textarea id="iSyn" rows="4" placeholder="A short summary for the corkboard…" aria-label="Synopsis">${esc(it.synopsis)}</textarea></div>
    <div class="two"><div><label class="lbl">Status</label><select id="iStatus">${STATUSES.map(s => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}</select></div>
    ${isDoc ? `<div><label class="lbl">Word target</label><input id="iTarget" type="number" min="0" step="50" value="${it.target || ''}" placeholder="none"></div>` : '<div></div>'}</div>
    <label class="lbl">Label</label><div class="swatches">${LABELS.map(l => `<button data-label="${l}" class="sw lbl-${l || 'none'} ${it.label === l ? 'on' : ''}" title="${l || 'No label'}" aria-label="${l || 'No'} label"></button>`).join('')}</div>
    ${extra}
    <p class="meta">Created ${fmtDate(it.created)} · Edited ${fmtDate(it.modified)}</p></div>`;
}
function backlinks(it) { const t = it.title.trim().toLowerCase(); if (!t) return []; return docs().filter(d => d !== it && !inTrash(d.id) && linksIn(d.content).some(x => x.toLowerCase() === t)); }
function mentionRe(title) { return new RegExp('(?<![\\p{L}\\[|])' + reEsc(title.trim()) + '(?![\\p{L}\\]|])', 'giu'); }
function unlinkedMentions(it) {
  const t = it.title.trim(); if (t.length < 3) return [];
  return docs().filter(d => d !== it && !inTrash(d.id) && mentionRe(t).test(d.content.replace(/\[\[[^\]]*\]\]/g, m => ' '.repeat(m.length))));
}
function snippet(text, title, plain) {
  const low = text.toLowerCase(), t = title.trim().toLowerCase();
  let i = plain ? low.replace(/\[\[[^\]]*\]\]/g, m => ' '.repeat(m.length)).indexOf(t) : low.indexOf('[[' + t);
  if (i < 0) i = low.indexOf(t); if (i < 0) return '';
  const s = Math.max(0, i - 45), e = Math.min(text.length, i + t.length + (plain ? 0 : 4) + 45);
  const piece = text.slice(s, e).replace(/\n+/g, ' ');
  return (s ? '…' : '') + esc(piece).replace(new RegExp(reEsc(esc(title.trim())), 'i'), m => `<b>${m}</b>`) + (e < text.length ? '…' : '');
}

/* ---------- word oracle ---------- */
const OR = { word: '', tab: 'syn', hist: [], sel: null, cache: new Map(), html: '', tok: 0 };
const OR_TABS = [['syn', 'Synonyms'], ['ant', 'Opposites'], ['mean', 'Meaning'], ['rhyme', 'Rhymes'], ['desc', 'Describe'], ['rel', 'Related'], ['sound', 'Sounds like'], ['tr', 'Translate']];
const LANGS = [['af', 'Afrikaans'], ['zu', 'isiZulu'], ['xh', 'isiXhosa'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['nl', 'Dutch'], ['pt', 'Portuguese'], ['la', 'Latin'], ['el', 'Greek'], ['ga', 'Irish'], ['cy', 'Welsh'], ['ja', 'Japanese']];
const DM = 'https://api.datamuse.com/words?';

function renderOracle() {
  $('#sideBody').innerHTML = `<form class="or-form" id="orForm"><input id="orQ" type="search" placeholder="Seek a word…" value="${esc(OR.word)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Word to look up"><button aria-label="Look up">✦</button></form>
    <div class="or-tabs" id="orTabs">${OR_TABS.map(([k, l]) => `<button type="button" data-t="${k}" class="${OR.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="or-out" id="orOut">${OR.html || oracleIntro()}</div>`;
}
function oracleIntro() {
  return `<div class="or-intro"><p>✧ Double-click a word in your writing, or type one above, to ask the oracle.</p>
    <p>Click a word to swap it into your text. Click <b>›</b> to look that word up next.</p>
    ${OR.hist.length ? `<div class="or-hist">Recent: ${OR.hist.map(w => `<button data-look="${esc(w)}">${esc(w)}</button>`).join('')}</div>` : ''}</div>`;
}
function setOut(h) { OR.html = h; const o = $('#orOut'); if (o) o.innerHTML = h; }
async function getJSON(url) {
  if (OR.cache.has(url)) return OR.cache.get(url);
  const r = await fetch(url); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const j = await r.json(); OR.cache.set(url, j); return j;
}
const chip = (w, s) => `<span class="chip ${s ? 's' : ''}"><button class="use" data-use="${esc(w)}" title="Swap “${esc(w)}” into your writing">${esc(w)}</button><button class="look" data-look="${esc(w)}" title="Look up “${esc(w)}”" aria-label="Look up ${esc(w)}">›</button></span>`;
const chips = (arr, s) => arr.length ? `<div class="chips">${arr.map(w => chip(w, s)).join('')}</div>` : '';
const POS = { adj: 'adjectives', n: 'nouns', v: 'verbs', adv: 'adverbs' };
function byPos(list) { const g = {}; list.forEach(x => { const p = (x.tags || []).find(t => POS[t]) || 'other'; (g[p] = g[p] || []).push(x.word); }); return g; }
async function didYouMean(w) {
  const s = await getJSON(DM + 'sp=' + enc(w) + '&max=8').catch(() => []);
  const sug = s.map(x => x.word).filter(x => x !== w);
  return `<p class="muted">The oracle found nothing for “${esc(w)}”.</p>` + (sug.length ? `<h4>Did you mean</h4><div class="chips">${sug.map(x => `<span class="chip"><button class="use" data-look="${esc(x)}">${esc(x)}</button></span>`).join('')}</div>` : '');
}
const ORACLE = {
  async syn(w) {
    const [a, b] = await Promise.all([getJSON(DM + 'rel_syn=' + enc(w) + '&max=60&md=p'), getJSON(DM + 'ml=' + enc(w) + '&max=120&md=pf')]);
    let h = a.length ? '<h4>Synonyms</h4>' + chips(a.map(x => x.word)) : '';
    // keep "similar" words that are reasonably common (Datamuse frequency per million) to drop rare oddities
    const freq = x => { const t = (x.tags || []).find(t => t.startsWith('f:')); return t ? +t.slice(2) : 0; };
    const have = new Set(a.map(x => x.word)), g = byPos(b.filter(x => !have.has(x.word) && x.word !== w && !x.word.includes(' ' + w) && freq(x) >= 0.4 && !(x.tags || []).includes('prop')));
    for (const k of ['adj', 'n', 'v', 'adv', 'other']) if (g[k]) h += `<h4>Similar ${POS[k] || 'words'}</h4>` + chips(g[k].slice(0, 30));
    return h || didYouMean(w);
  },
  async ant(w) {
    const a = await getJSON(DM + 'rel_ant=' + enc(w) + '&max=60');
    if (a.length) return '<h4>Opposites</h4>' + chips(a.map(x => x.word));
    const syn = await getJSON(DM + 'rel_syn=' + enc(w) + '&max=6');
    const more = (await Promise.all(syn.map(s => getJSON(DM + 'rel_ant=' + enc(s.word) + '&max=10').catch(() => [])))).flat().map(x => x.word);
    const uniq = [...new Set(more)].filter(x => x !== w);
    return uniq.length ? '<h4>Opposites of similar words</h4>' + chips(uniq) : '<p class="muted">No opposites found for this word.</p>';
  },
  async mean(w) {
    try {
      const data = await getJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + enc(w));
      const e = data[0], ph = (data.flatMap(x => x.phonetics || []).find(p => p.text) || {}).text || e.phonetic || '';
      const audio = (data.flatMap(x => x.phonetics || []).find(p => p.audio) || {}).audio;
      let h = `<p>${ph ? `<span class="muted">${esc(ph)}</span> ` : ''}${audio ? `<button class="audio" data-audio="${esc(audio)}" title="Hear it" aria-label="Play pronunciation">🔊</button>` : ''}</p>`;
      const meanings = data.flatMap(x => x.meanings || []);
      for (const m of meanings) {
        h += `<span class="pos">${esc(m.partOfSpeech)}</span><ol class="or-def">${m.definitions.slice(0, 6).map(d => `<li>${esc(d.definition)}${d.example ? `<span class="ex">“${esc(d.example)}”</span>` : ''}</li>`).join('')}</ol>`;
        const syn = [...new Set([...(m.synonyms || []), ...m.definitions.flatMap(d => d.synonyms || [])])].slice(0, 14);
        if (syn.length) h += chips(syn, true);
      }
      return h + '<p class="or-src">Definitions: Free Dictionary API (Wiktionary)</p>';
    } catch (err) {
      const d = await getJSON(DM + 'sp=' + enc(w) + '&md=d&max=1');
      if (d[0] && d[0].word === w && d[0].defs) return `<ol class="or-def">${d[0].defs.map(x => { const [p, t] = x.split('\t'); return `<li><span class="pos" style="margin:0 .3rem 0 0">${esc(POS[p] ? POS[p].replace(/s$/, '') : p)}</span>${esc(t)}</li>`; }).join('')}</ol><p class="or-src">Definitions: WordNet via Datamuse</p>`;
      return didYouMean(w);
    }
  },
  async rhyme(w) {
    const [a, b] = await Promise.all([getJSON(DM + 'rel_rhy=' + enc(w) + '&max=120&md=s'), getJSON(DM + 'rel_nry=' + enc(w) + '&max=40')]);
    let h = ''; const g = {};
    a.forEach(x => { const n = x.numSyllables || 1; (g[n] = g[n] || []).push(x.word); });
    Object.keys(g).sort((x, y) => x - y).forEach(n => { h += `<h4>${n} syllable${n > 1 ? 's' : ''}</h4>` + chips(g[n]); });
    if (b.length) h += '<h4>Near rhymes</h4>' + chips(b.map(x => x.word));
    return h || '<p class="muted">Nothing rhymes with this one. Try a near rhyme in Sounds like.</p>';
  },
  async desc(w) {
    const [a, b] = await Promise.all([getJSON(DM + 'rel_jjb=' + enc(w) + '&max=60'), getJSON(DM + 'rel_jja=' + enc(w) + '&max=40')]);
    let h = '';
    if (a.length) h += `<h4>Words to describe “${esc(w)}”</h4>` + chips(a.map(x => x.word));
    if (b.length) h += `<h4>Things often called “${esc(w)}”</h4>` + chips(b.map(x => x.word));
    return h || '<p class="muted">No describing words found. This works best with nouns (like “forest”) and adjectives (like “ancient”).</p>';
  },
  async rel(w) {
    const [a, b] = await Promise.all([getJSON(DM + 'rel_trg=' + enc(w) + '&max=50'), getJSON(DM + 'rel_spc=' + enc(w) + '&max=20')]);
    const c = await getJSON(DM + 'rel_gen=' + enc(w) + '&max=30').catch(() => []);
    let h = '';
    if (a.length) h += '<h4>Often found with</h4>' + chips(a.map(x => x.word));
    if (b.length) h += `<h4>“${esc(w)}” is a kind of</h4>` + chips(b.map(x => x.word));
    if (c.length) h += `<h4>Kinds of “${esc(w)}”</h4>` + chips(c.map(x => x.word));
    return h || '<p class="muted">No related words found.</p>';
  },
  async sound(w) {
    const [a, b] = await Promise.all([getJSON(DM + 'sl=' + enc(w) + '&max=40'), getJSON(DM + 'sp=' + enc(w) + '&max=30')]);
    let h = '';
    const sl = a.map(x => x.word).filter(x => x !== w), sp = b.map(x => x.word).filter(x => x !== w);
    if (sl.length) h += '<h4>Sounds like</h4>' + chips(sl);
    if (sp.length) h += '<h4>Spelled like</h4>' + chips(sp);
    return h || '<p class="muted">Nothing found.</p>';
  },
  async tr(w) {
    const lang = S.lang || 'af';
    const sel = `<select class="sel-lang" id="orLang" aria-label="Language">${LANGS.map(([k, l]) => `<option value="${k}" ${k === lang ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const j = await getJSON('https://api.mymemory.translated.net/get?q=' + enc(w) + '&langpair=en|' + lang);
    // MyMemory reports quota and errors as "translations", so check the status and the text before showing it.
    const bad = t => /MYMEMORY WARNING|QUOTA|LIMIT|INVALID|NO QUERY|PLEASE SELECT|IS AN INVALID/i.test(t);
    const status = +j.responseStatus;
    let main = (j.responseData && j.responseData.translatedText || '').trim();
    if ((status && status !== 200) || bad(main)) {
      if (status === 429 || /QUOTA|LIMIT|WARNING/i.test(main)) return `<h4>English → ${sel}</h4><p class="or-err">The free translation service has reached its daily limit. Try again tomorrow; every other oracle tab still works.</p>`;
      return `<h4>English → ${sel}</h4><p class="or-err">The translation service couldn't translate this word into that language.</p>`;
    }
    const alts = [...new Set((j.matches || []).map(m => String(m.translation || '').trim()).filter(t => t && !bad(t) && t.toLowerCase() !== main.toLowerCase() && t.toLowerCase() !== w && t.length < 40 && t.split(/\s+/).length <= 3))].slice(0, 10);
    return `<h4>English → ${sel}</h4>${main ? `<div class="tr-big">${esc(main)}</div>${chips([main])}` : '<p class="muted">No translation found.</p>'}
      ${alts.length ? '<h4>Other translations</h4>' + chips(alts) : ''}<p class="or-src">Translations: MyMemory. Check important ones, as free translation can slip.</p>`;
  },
};
async function lookup(word, tab) {
  word = String(word || '').trim().toLowerCase().replace(/[^\p{L}\p{N}'’ -]/gu, '');
  if (!word) return;
  OR.word = word; if (tab) OR.tab = tab;
  OR.hist = [word, ...OR.hist.filter(w => w !== word)].slice(0, 12);
  if (S.side !== 'oracle') { S.side = 'oracle'; save(); }
  renderSide();
  if (innerWidth <= 960) document.body.classList.add('show-side');
  setOut('<div class="or-load">✦ Consulting the oracle…</div>');
  const tok = ++OR.tok;
  try {
    const html = await ORACLE[OR.tab](word);
    if (tok !== OR.tok) return;
    const label = OR_TABS.find(t => t[0] === OR.tab)[1];
    setOut(`<h3>${esc(word)} <span class="ph">· ${label.toLowerCase()}</span></h3>` + html);
  } catch (e) {
    if (tok !== OR.tok) return;
    setOut(`<div class="or-err">The oracle is silent. ${navigator.onLine ? 'Try again in a moment.' : 'You seem to be offline. Word lookups need the internet; everything else still works.'}</div>`);
  }
}
function oracleFromEditor() {
  const ta = $('#ed');
  if (ta && !ta.hidden) {
    const v = ta.value; let s = ta.selectionStart, e = ta.selectionEnd;
    while (s < e && /\s/.test(v[s])) s++; while (e > s && /\s/.test(v[e - 1])) e--;
    if (e === s) { const r = wordAt(ta, s); s = r.s; e = r.e; while (s < e && /['’-]/.test(v[s])) s++; while (e > s && /['’-]/.test(v[e - 1])) e--; }
    const w = v.slice(s, e);
    if (w) { OR.sel = { id: P().current, s, e, w }; lookup(w); return; }
  }
  S.side = 'oracle'; renderSide(); document.body.classList.add('show-side'); setTimeout(() => { const q = $('#orQ'); q && q.focus(); }, 50);
}
function useWord(w) {
  const ta = $('#ed'), it = I(P().current);
  if (!ta || ta.hidden || !it || it.type !== 'doc') { navigator.clipboard && navigator.clipboard.writeText(w).catch(() => { }); toast(`Copied “${w}”`); return; }
  // The remembered word may have moved if text was typed before it: only trust the stored offsets
  // when the same word is still there, otherwise use the nearest copy of that word, else the cursor.
  let s = ta.selectionStart, e = ta.selectionEnd, sel = OR.sel && OR.sel.id === it.id ? OR.sel : null;
  if (sel && ta.value.slice(sel.s, sel.e) !== sel.w) {
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + reEsc(sel.w) + '(?![\\p{L}\\p{N}])', 'gu'); let m, best = -1;
    while ((m = re.exec(ta.value))) if (best < 0 || Math.abs(m.index - sel.s) < Math.abs(best - sel.s)) best = m.index;
    sel = best < 0 ? null : { ...sel, s: best, e: best + sel.w.length };
  }
  if (sel) ({ s, e } = sel);
  const orig = ta.value.slice(s, e);
  if (orig.length > 1 && orig === orig.toUpperCase() && /\p{Lu}/u.test(orig)) w = w.toUpperCase();
  else if (/^\p{Lu}/u.test(orig)) w = w[0].toUpperCase() + w.slice(1);
  const needSpace = !orig && s > 0 && /[\p{L}\p{N}]/u.test(ta.value[s - 1]);
  const text = (needSpace ? ' ' : '') + w;
  insertText(ta, s, e, text);
  OR.sel = { id: it.id, s: s + (needSpace ? 1 : 0), e: s + text.length, w };
  ta.setSelectionRange(OR.sel.s, OR.sel.e);
  if (innerWidth <= 960) document.body.classList.remove('show-side');
  toast(orig ? `Swapped “${orig}” for “${w}”` : `Added “${w}”`);
}

/* ================= actions ================= */
function openItem(id, write) {
  const p = P(), it = p.items[id]; if (!it) return;
  p.current = id;
  if (write && it.type === 'doc') p.view = 'write';
  else if (write && it.type === 'folder' && (p.view === 'graph' || p.view === 'write')) p.view = 'cork';
  let x = it.parent ? I(it.parent) : null; while (x) { p.open[x.id] = true; x = x.parent ? I(x.parent) : null; }
  OR.sel = null; save(); render();
  document.body.classList.remove('show-binder');
}
function select(id) {
  const p = P(); p.current = id;
  if (p.view === 'graph' || p.view === 'maps') p.view = 'write';
  OR.sel = null; save(); render();
  document.body.classList.remove('show-binder');
}
function openLink(title) {
  const d = findByTitle(title);
  if (d) return openItem(d.id, true);
  const low = String(title).trim().toLowerCase(), trashed = docs().find(x => inTrash(x.id) && x.title.trim().toLowerCase() === low);
  if (trashed) { openItem(trashed.id, true); toast(`“${trashed.title}” is in the Trash. Press “Restore it” to bring it back`); return; }
  const n = createDoc(P().roots.lore, title.trim(), '', null, true);
  toast(`✦ “${n.title}” didn't exist yet, so it was created in Lore`);
  openItem(n.id, true);
}
function createDoc(parentId, title, content = '', index, quiet) {
  const p = P(); const d = mkItem(p, 'doc', uniqueTitle(title || 'Untitled'), parentId, { content }, index);
  p.open[parentId] = true; save();
  if (!quiet) { p.current = d.id; p.view = 'write'; MODE = 'write'; render(); setTimeout(() => { const t = $('#docTitle'); if (t) { t.focus(); t.select(); } }, 30); }
  return d;
}
function placeNew() {
  const p = P(), cur = I(p.current);
  if (!cur || inTrash(cur.id)) return { parent: p.roots.manuscript };
  if (cur.type === 'folder') return { parent: cur.id };
  const par = I(cur.parent); return { parent: par.id, index: par.children.indexOf(cur.id) + 1 };
}
function newDocHere() { const { parent, index } = placeNew(); createDoc(parent, 'Untitled', '', index); }
async function newFolderHere() {
  const name = await ask('New folder', 'New folder', 'Create'); if (name == null) return;
  const p = P(), { parent, index } = placeNew();
  const f = mkItem(p, 'folder', name.trim() || 'New folder', parent, {}, index); p.open[f.id] = true; p.open[parent] = true;
  p.current = f.id; save(); render();
}
function newLore(kind, anchor) {
  const p = P(), cur = I(p.current);
  let parent = p.roots.lore;
  if (cur && rootOf(cur.id) === 'lore') parent = cur.type === 'folder' ? cur.id : cur.parent;
  createDoc(parent, kind ? 'New ' + kind.toLowerCase() : 'Untitled note', kind ? TEMPLATES[kind] : '');
}
function loreMenu(x, y) {
  showMenu(x, y, [{ h: 'New lore note' }, { label: '✦ Blank note', act: () => newLore() }, ...Object.keys(TEMPLATES).map(k => ({ label: '❧ ' + k, act: () => newLore(k) }))]);
}
function moveItem(id, targetId, pos) {
  const p = P(), it = p.items[id], tgt = p.items[targetId];
  if (!it || !tgt || it.root || id === targetId || isAncestor(id, targetId)) return false;
  let np, index;
  if (pos === 'inside' || tgt.root) { np = tgt; index = tgt.children.length; }
  else { np = p.items[tgt.parent]; index = np.children.indexOf(targetId) + (pos === 'after' ? 1 : 0); }
  const old = p.items[it.parent], oi = old.children.indexOf(id);
  old.children.splice(oi, 1);
  if (old === np && oi < index) index--;
  np.children.splice(index, 0, id); it.parent = np.id; p.open[np.id] = true;
  return true;
}
function shift(id, dir) {
  const it = I(id), par = I(it.parent), i = par.children.indexOf(id), j = i + dir;
  if (j < 0 || j >= par.children.length) return;
  [par.children[i], par.children[j]] = [par.children[j], par.children[i]]; save(); render();
}
function trashItem(id) {
  const p = P(), it = I(id); if (it.root) return;
  it.trashedFrom = it.parent;
  moveItem(id, p.roots.trash, 'inside');
  if (p.current === id || isAncestor(id, p.current)) p.current = it.trashedFrom;
  save(); render(); toast(`Moved “${it.title}” to the Trash`);
}
function restoreItem(id) {
  const p = P(), it = I(id), back = it.trashedFrom && p.items[it.trashedFrom] && !inTrash(it.trashedFrom) ? it.trashedFrom : p.roots.manuscript;
  moveItem(id, back, 'inside'); delete it.trashedFrom; save(); render(); toast(`Restored “${it.title}”`);
}
function purge(id) { const p = P(), it = p.items[id]; if (it.type === 'folder') it.children.slice().forEach(purge); const par = p.items[it.parent]; if (par) par.children = par.children.filter(c => c !== id); delete p.items[id]; }
async function deleteForever(id) {
  const it = I(id); if (!await confirmBox(`Delete “${esc(it.title)}” forever? This can't be undone.`, 'Delete forever', true)) return;
  purge(id); const p = P(); if (!p.items[p.current]) p.current = p.roots.trash; save(); render();
}
async function emptyTrash() {
  const p = P(), t = I(p.roots.trash); if (!t.children.length) return;
  if (!await confirmBox(`Delete all ${t.children.length} item(s) in the Trash forever? This can't be undone.`, 'Empty the Trash', true)) return;
  t.children.slice().forEach(purge); if (!p.items[p.current]) p.current = p.roots.trash; save(); render();
}
function duplicate(id) {
  const p = P(), it = I(id), par = I(it.parent);
  const copy = (src, parentId, index) => { const t = src.title + (src === it ? ' (copy)' : ''); const n = mkItem(p, src.type, src.type === 'doc' ? uniqueTitle(t) : t, parentId, { content: src.content, synopsis: src.synopsis, status: src.status, label: src.label, target: src.target }, index); if (src.type === 'folder') src.children.forEach(c => copy(p.items[c], n.id)); return n; };
  const n = copy(it, par.id, par.children.indexOf(id) + 1); p.current = n.id; save(); render();
}
function renameItem(id, t, oldTitle) {
  const it = I(id); const old = String(oldTitle ?? it.title).trim(); t = String(t).trim() || 'Untitled';
  if (it.type === 'doc') { const u = uniqueTitle(t, id); if (u !== t) toast(`A page called “${t}” already exists, so this one is “${u}”`); t = u; }
  it.title = t;
  if (it.type === 'doc' && old && old !== t) {
    const re = new RegExp('\\[\\[\\s*' + reEsc(old) + '\\s*(?=\\]\\]|\\|)', 'gi'); let n = 0;
    // A function replacement, so "$&" or "$1" in a title is inserted literally. Self-links are updated too.
    docs().forEach(d => { const c = d.content.replace(re, () => '[[' + t); if (c !== d.content) { d.content = c; if (d !== it) n++; } });
    const ed = $('#ed');
    if (ed && P().current === id && ed.value !== it.content) { const s = ed.selectionStart; ed.value = it.content; ed.setSelectionRange(Math.min(s, ed.value.length), Math.min(s, ed.value.length)); updateDocWc(it); }
    if (typeof Maps !== 'undefined') n += Maps.renameLinks(old, t); // places on maps follow the rename too
    if (n) toast(`✦ Updated links in ${n} place${n > 1 ? 's' : ''}`);
  }
  it.modified = Date.now(); save();
}
function startRename(id) {
  const rowEl = $(`.row[data-id="${id}"] .ttl`); const it = I(id); if (!rowEl || it.root) return;
  rowEl.innerHTML = `<input value="${esc(it.title)}" aria-label="New name">`; const inp = $('input', rowEl); inp.focus(); inp.select();
  let done = false; const fin = ok => { if (done) return; done = true; if (ok) renameItem(id, inp.value); renderBinder(); if (P().current === id) { renderMain(); renderSide(); } };
  inp.onkeydown = e => { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); e.stopPropagation(); };
  inp.onblur = () => fin(true); inp.onclick = e => e.stopPropagation();
}
function takeSnapshot(it, name) {
  it.snapshots.unshift({ t: Date.now(), name: name || 'Snapshot', content: it.content });
  if (it.snapshots.length > 40) it.snapshots.length = 40;
  save(); toast('◷ Snapshot saved'); if (S.side === 'inspect') renderInspector();
}
function searchTag(t) { $('#search').value = '#' + t; renderBinder(); document.body.classList.add('show-binder'); }
function itemMenu(id, x, y) {
  const p = P(), it = I(id), tr = inTrash(id), items = [];
  if (it.root === 'trash') { items.push({ label: 'Empty the Trash', act: emptyTrash, danger: true }); return showMenu(x, y, items); }
  if (it.type === 'folder' && !tr) {
    items.push({ label: '+ New page inside', act: () => createDoc(id, 'Untitled') });
    items.push({ label: '+ New folder inside', act: async () => { const n = await ask('New folder', 'New folder', 'Create'); if (n == null) return; const f = mkItem(p, 'folder', n.trim() || 'New folder', id); p.open[id] = true; p.current = f.id; save(); render(); } });
    if (rootOf(id) === 'lore') items.push({ label: '✦ New lore note…', act: () => { p.current = id; setTimeout(() => loreMenu(x, y), 0); } });
    items.push({ label: '▦ Open as corkboard', act: () => { p.current = id; p.view = 'cork'; save(); render(); } });
  }
  if (!it.root) {
    if (items.length) items.push({ sep: 1 });
    if (tr) {
      items.push({ label: '↺ Restore', act: () => restoreItem(id) });
      items.push({ label: 'Delete forever', act: () => deleteForever(id), danger: true });
    } else {
      items.push({ label: 'Rename', act: () => startRename(id) });
      items.push({ label: 'Duplicate', act: () => duplicate(id) });
      if (it.type === 'doc') items.push({ label: '◷ Take snapshot', act: () => takeSnapshot(it) });
      items.push({ label: '↑ Move up', act: () => shift(id, -1) }, { label: '↓ Move down', act: () => shift(id, 1) });
      const moveTo = ROOTS.filter(([k]) => k !== 'trash' && p.roots[k] !== it.parent).map(([k, l]) => ({ label: '→ Move to ' + l, act: () => { moveItem(id, p.roots[k], 'inside'); save(); render(); } }));
      items.push(...moveTo, { sep: 1 }, { label: 'Move to Trash', act: () => trashItem(id), danger: true });
    }
  }
  if (items.length) showMenu(x, y, items);
}

/* ---------- popups ---------- */
let menuItems = [];
function showMenu(x, y, items) {
  menuItems = items; const m = $('#menu');
  m.innerHTML = items.map((it, i) => it.sep ? '<hr>' : it.h ? `<div class="mh">${esc(it.h)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''} ${it.cur ? 'cur' : ''}">${esc(it.label)}</button>`).join('');
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function hideMenu() { $('#menu').hidden = true; }
let modalCancel = null;
function openModal(html, cls = '') {
  const box = $('#modalBox'); box.className = 'modal ' + cls; box.innerHTML = html; $('#modal').hidden = false;
  const f = box.querySelector('[autofocus]'); if (f) setTimeout(() => { f.focus(); if (f.select) f.select(); }, 30);
}
function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; const c = modalCancel; modalCancel = null; if (c) c(); }
function ask(title, value = '', ok = 'Save') {
  return new Promise(res => {
    openModal(`<h3>${esc(title)}</h3><form id="askF"><input class="m-field" id="askI" value="${esc(value)}" autofocus><div class="m-act"><button type="button" class="ghost" data-x>Cancel</button><button class="primary">${esc(ok)}</button></div></form>`);
    modalCancel = () => res(null);
    $('#askF').onsubmit = e => { e.preventDefault(); const v = $('#askI').value; modalCancel = null; closeModal(); res(v); };
  });
}
function confirmBox(msgHtml, ok = 'Yes', danger) {
  return new Promise(res => {
    openModal(`<h3>Are you sure?</h3><p>${msgHtml}</p><div class="m-act"><button class="ghost" data-x>Cancel</button><button class="primary ${danger ? 'danger-fill' : ''}" id="cOk">${esc(ok)}</button></div>`);
    modalCancel = () => res(false);
    $('#cOk').onclick = () => { modalCancel = null; closeModal(); res(true); };
  });
}
let toastT;
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }

/* ---------- projects ---------- */
function projectMenu(x, y) {
  const items = [{ h: 'Your grimoires' }, ...S.order.map(id => ({ label: S.projects[id].name, cur: id === S.current, act: () => { S.current = id; ensureDay(); OR.sel = null; save(); render(); } })), { sep: 1 },
    { label: '✦ New grimoire…', act: async () => { const n = await ask('Name your new grimoire', 'Untitled tale', 'Create'); if (n == null) return; newProject(n.trim() || 'Untitled tale', false); ensureDay(); save(); render(); } },
    { label: 'Rename this grimoire…', act: async () => { const n = await ask('Rename grimoire', P().name); if (n == null) return; P().name = n.trim() || P().name; save(); renderHeader(); } },
    { label: '☁ Backups & cloud…', act: () => Backup.open() },
    { label: '📜 Compile the book…', act: compileModal },
    { label: '✦ Take the tour', act: () => Tour.start() },
    { label: '⇩ Export backup (.json)', act: exportBackup },
    { label: '⇧ Import backup…', act: () => $('#importFile').click() }];
  if (S.order.length > 1) items.push({ sep: 1 }, { label: 'Delete this grimoire…', danger: true, act: deleteProject });
  showMenu(x, y, items);
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const safeName = s => (s || 'rosequill').replace(/[\\/:*?"<>|]+/g, '').trim() || 'rosequill';
function exportBackup() { const p = P(); try { localStorage.setItem('rq_last_export', String(Date.now())); } catch { } download(safeName(p.name) + ' — ' + today() + '.rosequill.json', JSON.stringify({ app: 'rosequill', v: 1, project: p }, null, 1), 'application/json'); toast('Backup downloaded ✦'); }
async function importBackup(file) {
  try {
    const j = JSON.parse(await file.text()), p = j && (j.project || j);
    if (!p || typeof p !== 'object' || !p.items || typeof p.items !== 'object' || !Object.keys(p.items).length) throw new Error('not a backup');
    if (typeof p.id !== 'string' || !p.id) p.id = uid();
    normalizeProject(p); // fills in missing folders, fields and numbers so nothing crashes later
    if (S.projects[p.id]) { if (!await confirmBox(`“${esc(p.name)}” is already here. Import it as a separate copy?`, 'Import copy')) return; p.id = uid(); p.name += ' (imported)'; }
    S.projects[p.id] = p; S.order.push(p.id); S.current = p.id; ensureDay(); save(); render(); toast(`Imported “${p.name}” ✦`);
  } catch { toast('That file is not a Rosequill backup.'); }
}
async function deleteProject() {
  const p = P();
  if (!await confirmBox(`Delete the whole grimoire “${esc(p.name)}” and every page in it? Export a backup first if you might want it again. This can't be undone.`, 'Delete grimoire', true)) return;
  if (typeof Backup !== 'undefined') Backup.forget(p.id); // its cloud copy stays as a backup (Backups → Add to this device)
  delete S.projects[p.id]; S.order = S.order.filter(id => id !== p.id); S.current = S.order[0]; ensureDay(); save(); render();
}
function goalsModal() {
  const p = P(), total = manuscriptWords(p), todayW = Math.max(0, total - (p.dayStart[today()] ?? total));
  const days = Object.keys(p.dayStart).sort();
  openModal(`<h3>Writing goals</h3>
    <div class="stat-grid"><div class="stat"><b>${fmtN(todayW)}</b><span>words today</span></div><div class="stat"><b>${fmtN(total)}</b><span>words in the manuscript</span></div></div>
    <form id="gF"><label class="f" for="gS">Daily goal (words)</label><input class="m-field" id="gS" type="number" min="0" step="50" value="${p.sessionTarget}">
    <label class="f" for="gT">Whole-manuscript goal (words)</label><input class="m-field" id="gT" type="number" min="0" step="1000" value="${p.target}">
    <p class="muted" style="font-size:.8rem;margin-top:.8rem">Only pages in the Manuscript count, not Lore or Research. You've written here on ${days.length} day${days.length === 1 ? '' : 's'}.</p>
    <div class="m-act"><button type="button" class="ghost" data-x>Cancel</button><button class="primary">Save goals</button></div></form>`);
  $('#gF').onsubmit = e => { e.preventDefault(); p.sessionTarget = Math.max(0, +$('#gS').value || 0); p.target = Math.max(0, +$('#gT').value || 0); closeModal(); save(); updateGoals(); };
}

/* ---------- quick switcher ---------- */
function quickSwitcher() {
  openModal(`<h3>Go to a page</h3><input class="m-field" id="qsI" placeholder="Type a page name… (Enter to open or create)" autofocus autocomplete="off"><div class="qs-list" id="qsL"></div>`, 'wide');
  let idx = 0, list = [];
  const draw = () => {
    const q = $('#qsI').value.trim().toLowerCase();
    list = docs().filter(d => !inTrash(d.id) && (!q || d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q)))
      .sort((a, b) => (q ? (b.title.toLowerCase().startsWith(q) - a.title.toLowerCase().startsWith(q)) || (b.title.toLowerCase().includes(q) - a.title.toLowerCase().includes(q)) : 0) || b.modified - a.modified).slice(0, 12)
      .map(d => ({ id: d.id, title: d.title, root: rootOf(d.id) }));
    if (q && !list.some(x => x.title.toLowerCase() === q)) list.push({ create: $('#qsI').value.trim() });
    idx = Math.min(idx, list.length - 1);
    $('#qsL').innerHTML = list.map((x, i) => x.create ? `<button data-i="${i}" class="${i === idx ? 'on' : ''}">✦ Create <b>${esc(x.create)}</b><small>new page in Lore</small></button>` : `<button data-i="${i}" class="${i === idx ? 'on' : ''}"><span class="ico">${x.root === 'lore' ? ICON.lore : ICON.doc}</span>${esc(x.title)}<small>${x.root}</small></button>`).join('');
  };
  const go = i => { const x = list[i]; if (!x) return; closeModal(); if (x.create) openLink(x.create); else openItem(x.id, true); };
  draw();
  $('#qsI').addEventListener('input', () => { idx = 0; draw(); });
  $('#qsI').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(list.length - 1, idx + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
    if (e.key === 'Enter') { e.preventDefault(); go(idx); }
  });
  $('#qsL').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(+b.dataset.i); });
}

/* ---------- compile ---------- */
function compileModal() {
  const p = P(), folders = [];
  const walk = (id, d) => { const it = p.items[id]; if (it.type !== 'folder' || it.root === 'trash') return; folders.push([it, d]); it.children.forEach(c => walk(c, d + 1)); };
  ['manuscript', 'lore', 'research'].forEach(k => walk(p.roots[k], 0));
  openModal(`<h3>Compile your book</h3>
    <p class="muted" style="font-size:.85rem">Joins every page in a folder, in binder order, into one finished document. Links become plain text.</p>
    <label class="f" for="cpF">What to compile</label><select class="m-field" id="cpF">${folders.map(([f, d]) => `<option value="${f.id}">${'  '.repeat(d)}${d ? '└ ' : ''}${esc(f.title)}</option>`).join('')}</select>
    <label class="f" for="cpA">Author name (for the title page)</label><input class="m-field" id="cpA" value="${esc(p.author || '')}" placeholder="Optional">
    <label class="chkl"><input type="checkbox" id="cpTP" checked> Add a title page</label>
    <label class="chkl"><input type="checkbox" id="cpFT" checked> Folder names as chapter headings</label>
    <label class="chkl"><input type="checkbox" id="cpDT"> Page names as headings</label>
    <label class="chkl"><input type="checkbox" id="cpSep" checked> Scene break ✦ between pages</label>
    <label class="chkl"><input type="checkbox" id="cpTag" checked> Remove #tags</label>
    <label class="chkl"><input type="checkbox" id="cpIdea" checked> Leave out pages marked “Idea”</label>
    <label class="f">Choose a format</label>
    <div class="fmt-grid">
      <button data-fmt="doc"><b>Word</b><span>.docx for Word or Google Docs</span></button>
      <button data-fmt="pdf"><b>PDF / Print</b><span>save as PDF</span></button>
      <button data-fmt="html"><b>Web page</b><span>.html</span></button>
      <button data-fmt="md"><b>Markdown</b><span>.md</span></button>
      <button data-fmt="txt"><b>Plain text</b><span>.txt</span></button>
    </div>
    <div class="m-act"><button class="ghost" data-x>Close</button></div>`, 'wide');
  $('.fmt-grid').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    p.author = $('#cpA').value.trim(); save();
    const opts = { folder: $('#cpF').value, titlePage: $('#cpTP').checked, folderTitles: $('#cpFT').checked, docTitles: $('#cpDT').checked, sep: $('#cpSep').checked, stripTags: $('#cpTag').checked, skipIdeas: $('#cpIdea').checked };
    doCompile(b.dataset.fmt, opts);
  });
}
function compileMd(o) {
  const p = o.project || P(), parts = []; let lastDoc = false; // o.shift / o.docLevel set heading depths
  const f0 = p.items[o.folder], bookTitle = f0.root === 'manuscript' ? p.name : f0.title;
  const walk = (id, d) => {
    const it = p.items[id];
    if (it.type === 'folder') {
      if (d > 0 && o.folderTitles) { parts.push('#'.repeat(Math.min(d + (o.shift || 0), 3)) + ' ' + mdEsc(it.title)); lastDoc = false; }
      it.children.forEach(c => walk(c, d + 1)); return;
    }
    if (o.skipIdeas && it.status === 'Idea') return;
    let body = it.content.replace(/\[\[([^\][|\n]+)\|([^\][\n]+)\]\]/g, '$2').replace(/\[\[([^\][\n]+)\]\]/g, '$1');
    if (o.stripTags) body = body.replace(/(^|[ \t])#[\p{L}][\p{L}\p{N}_-]*/gmu, '$1').replace(/^[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
    body = body.trim(); if (!body && !o.docTitles) return;
    // With page names as headings, a page's own headings nest one level below its name.
    if (o.docTitles) { const lvl = o.docLevel || (o.folderTitles ? 3 : 2); body = body.replace(/^(#{1,6})(?=\s)/gm, h => '#'.repeat(Math.min(6, h.length + lvl - 1))); }
    if (lastDoc && o.sep) parts.push('✦ ✦ ✦');
    if (o.docTitles) parts.push('#'.repeat(o.docLevel || (o.folderTitles ? 3 : 2)) + ' ' + mdEsc(it.title));
    if (body) parts.push(body); lastDoc = true;
  };
  walk(o.folder, 0);
  return { title: bookTitle, author: p.author, md: parts.join('\n\n') + '\n' };
}
function bookHtml(c, o, forWord) {
  const tp = o.titlePage ? `<div class="title-page"><div class="orn">✦</div><h1 class="bt">${esc(c.title)}</h1>${c.author ? `<p class="au">${esc(c.author)}</p>` : ''}</div>` : '';
  const head = forWord ? `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` : '<!doctype html><html lang="en">';
  return `${head}<head><meta charset="utf-8"><title>${esc(c.title)}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.7;color:#222;max-width:38em;margin:2.5em auto;padding:0 1.2em}
    h1,h2,h3{font-weight:normal;text-align:center;letter-spacing:.06em;color:#7a1f4f}
    h1{font-size:20pt;margin:2.2em 0 1em;page-break-before:always}h2{font-size:15pt;margin:1.8em 0 .8em}h3{font-size:12.5pt;font-style:italic}
    p{margin:0;text-indent:1.5em;text-align:justify}h1+p,h2+p,h3+p,hr+p,blockquote p{text-indent:0}
    hr.scene{border:0;text-align:center;margin:1.2em 0;height:auto}hr.scene:after{content:"✦   ✦   ✦";white-space:pre;color:#b06a8f}
    blockquote{margin:1em 2em;font-style:italic}.tag{color:inherit}a{color:inherit;text-decoration:none}
    .title-page{text-align:center;padding-top:28vh;page-break-after:always}.title-page h1{page-break-before:avoid;font-size:30pt;margin:.4em 0}.orn{color:#c08a3e;font-size:22pt}.au{text-indent:0;text-align:center;font-style:italic;font-size:14pt}
    @page{margin:2.2cm}
  </style></head><body>${tp}${md(c.md).replace(/<hr class="scene">/g, forWord ? '<p style="text-align:center;text-indent:0">✦ &nbsp; ✦ &nbsp; ✦</p>' : '<hr class="scene">')}</body></html>`;
}
function toPlain(m) {
  return m.replace(/^#{1,6}\s+(.*)$/gm, (x, t) => '\n' + t.toUpperCase()).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2').replace(/(^|\W)_([^_\n]+)_/g, '$1$2').replace(/==([^=]+)==/g, '$1').replace(/^>\s?/gm, '    ').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)').replace(/\\([\\`*_[\]#~=|>!()-])/g, '$1').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function doCompile(fmt, o) {
  const c = compileMd(o), name = safeName(c.title);
  if (!c.md.trim()) return toast('There is nothing to compile in that folder yet.');
  const md0 = (o.titlePage ? `# ${mdEsc(c.title)}\n\n${c.author ? '*' + mdEsc(c.author) + '*\n\n' : ''}` : '') + c.md;
  if (fmt === 'md') download(name + '.md', md0, 'text/markdown');
  if (fmt === 'txt') download(name + '.txt', toPlain(md0), 'text/plain');
  if (fmt === 'html') download(name + '.html', bookHtml(c, o), 'text/html');
  if (fmt === 'doc') download(name + '.docx', Word.build(c.title, c.author, c.md, o.titlePage), Word.MIME);
  if (fmt === 'pdf') {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'; document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(bookHtml(c, o)); f.contentDocument.close();
    setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 350);
    toast('Choose “Save as PDF” in the print window'); return;
  }
  toast(`✦ Compiled “${c.title}”`);
}

/* ---------- theme & focus ---------- */
function applyTheme() {
  if (S.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme;
  const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').content = dark ? '#251229' : '#d63a83';
}
function setFocus(on) {
  document.body.classList.toggle('focus', on); updateGoals();
  if (on) { toast('Focus mode. Press Esc to leave'); const ed = $('#ed'); if (ed) { ed.focus(); autosize(ed); } }
}

/* ================= global events ================= */
function bindGlobal() {
  $('#views').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const p = P();
    p.view = b.dataset.view;
    const it = I(p.current);
    if (p.view === 'write' && it && it.type === 'folder') { const first = it.children.map(I).find(x => x.type === 'doc'); if (first) p.current = first.id; }
    save(); render();
  });
  $('#btnProj').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); projectMenu(r.left, r.bottom + 6); });
  $('#btnGoals').addEventListener('click', goalsModal);
  $('#btnCompile').addEventListener('click', compileModal);
  $('#btnSearch').addEventListener('click', quickSwitcher);
  $('#btnTheme').addEventListener('click', () => { S.theme = S.theme === 'auto' ? 'light' : S.theme === 'light' ? 'dark' : 'auto'; applyTheme(); renderHeader(); save(); if (P().view === 'graph') renderMain(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); if (P().view === 'graph') renderMain(); });
  $('#btnBinder').addEventListener('click', () => document.body.classList.toggle('show-binder'));
  $('#btnSide').addEventListener('click', () => document.body.classList.toggle('show-side'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('show-binder', 'show-side'));
  $('#focusExit').addEventListener('click', () => setFocus(false));
  $('#search').addEventListener('input', debounce(renderBinder, 150));
  $('#bNewDoc').addEventListener('click', newDocHere);
  $('#bNewFolder').addEventListener('click', newFolderHere);
  $('#bNewLore').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); loreMenu(r.left, r.bottom + 6); });
  $('#tags').addEventListener('click', e => { const t = e.target.closest('[data-tag]'); if (t) { $('#search').value = '#' + t.dataset.tag; renderBinder(); } });
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; });

  // binder tree
  const tree = $('#tree');
  tree.addEventListener('click', e => {
    const r = e.target.closest('.row'); if (!r) return; const id = r.dataset.id;
    if (e.target.closest('[data-more]')) { const b = e.target.closest('[data-more]').getBoundingClientRect(); itemMenu(id, b.left, b.bottom + 4); return; }
    if (e.target.closest('[data-caret]')) { P().open[id] = !P().open[id]; save(); renderBinder(); return; }
    if (e.target.closest('input')) return;
    const it = I(id);
    if (it.type === 'folder' && P().current === id) { P().open[id] = !P().open[id]; save(); renderBinder(); return; }
    select(id);
  });
  tree.addEventListener('dblclick', e => { const r = e.target.closest('.row'); if (r && !e.target.closest('button')) startRename(r.dataset.id); });
  tree.addEventListener('contextmenu', e => { const r = e.target.closest('.row'); if (!r) return; e.preventDefault(); itemMenu(r.dataset.id, e.clientX, e.clientY); });
  const clearDrop = () => $$('.row', tree).forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  const zone = (r, e) => { const it = I(r.dataset.id), b = r.getBoundingClientRect(), y = (e.clientY - b.top) / b.height; if (it.root) return 'inside'; if (it.type === 'folder') return y < .28 ? 'before' : y > .72 ? 'after' : 'inside'; return y < .5 ? 'before' : 'after'; };
  tree.addEventListener('dragstart', e => { const r = e.target.closest('.row'); if (!r) return; DRAG_ID = r.dataset.id; e.dataTransfer.setData('text/plain', DRAG_ID); e.dataTransfer.effectAllowed = 'move'; });
  tree.addEventListener('dragover', e => {
    const r = e.target.closest('.row'), id = DRAG_ID; if (!r || !id || r.dataset.id === id || isAncestor(id, r.dataset.id)) return;
    e.preventDefault(); clearDrop(); r.classList.add('drop-' + zone(r, e));
  });
  tree.addEventListener('dragleave', e => { if (!tree.contains(e.relatedTarget)) clearDrop(); });
  tree.addEventListener('drop', e => {
    const r = e.target.closest('.row'), id = DRAG_ID; clearDrop(); if (!r || !id) return; e.preventDefault();
    if (moveItem(id, r.dataset.id, zone(r, e))) { save(); render(); }
    DRAG_ID = null;
  });
  tree.addEventListener('dragend', () => { DRAG_ID = null; clearDrop(); });

  // side panel
  $('.side-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.side = b.dataset.side; save(); renderSide(); });
  const side = $('#sideBody');
  side.addEventListener('submit', e => { if (e.target.id === 'orForm') { e.preventDefault(); OR.sel = OR.sel && $('#ed') ? OR.sel : null; lookup($('#orQ').value); } });
  side.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'); if (t) { OR.tab = t.dataset.t; $$('#orTabs button').forEach(b => b.classList.toggle('on', b === t)); const w = ($('#orQ').value || OR.word).trim(); if (w) lookup(w); return; }
    const u = e.target.closest('[data-use]'); if (u) return useWord(u.dataset.use);
    const l = e.target.closest('[data-look]'); if (l) return lookup(l.dataset.look);
    const au = e.target.closest('[data-audio]'); if (au) { new Audio(au.dataset.audio).play().catch(() => toast('Could not play the sound.')); return; }
    const lk = e.target.closest('[data-link]'); if (lk) return openLink(lk.dataset.link);
    const mp = e.target.closest('[data-mappin]'); if (mp) { const [mapId, pinId] = mp.dataset.mappin.split('|'); document.body.classList.remove('show-side'); return Maps.showPin(mapId, pinId); }
    const op = e.target.closest('[data-open]'); if (op) return openItem(op.dataset.open, true);
    const la = e.target.closest('[data-linkall]'); if (la) {
      const it = I(P().current), d = I(la.dataset.linkall); let n = 0;
      const masked = d.content.replace(/\[\[[^\]]*\]\]/g, m => '\u0001'.repeat(m.length));
      let out = '', last = 0; const re = mentionRe(it.title); let m;
      while ((m = re.exec(masked))) { out += d.content.slice(last, m.index) + (m[0] === it.title ? `[[${it.title}]]` : `[[${it.title}|${m[0]}]]`); last = m.index + m[0].length; n++; }
      d.content = out + d.content.slice(last); d.modified = Date.now(); save(); renderInspector(); toast(`✦ Linked ${n} mention${n > 1 ? 's' : ''} in “${d.title}”`); return;
    }
    const sw = e.target.closest('[data-label]'); if (sw) { const it = I(P().current); it.label = sw.dataset.label; save(); renderInspector(); renderBinder(); return; }
    if (e.target.id === 'iSnap') return takeSnapshot(I(P().current));
    const it = I(P().current);
    const sv = e.target.closest('[data-snapv]'); if (sv) { const s = it.snapshots[+sv.dataset.snapv]; openModal(`<h3>${esc(s.name)} · ${fmtDate(s.t)}</h3><p class="muted" style="font-size:.85rem">${fmtN(wordsIn(s.content))} words then, ${fmtN(wordsIn(it.content))} now.</p><div class="snap-view md">${md(s.content) || '<p class="muted">(empty)</p>'}</div><div class="m-act"><button class="ghost" data-x>Close</button></div>`, 'wide'); return; }
    const sr = e.target.closest('[data-snapr]'); if (sr) {
      const s = it.snapshots[+sr.dataset.snapr];
      confirmBox(`Replace this page with the snapshot from ${fmtDate(s.t)}? Your current text is saved as a new snapshot first.`, 'Restore').then(ok => {
        if (!ok) return; takeSnapshot(it, 'Before restoring'); it.content = s.content; it.modified = Date.now(); save(); renderMain(); renderInspector();
      }); return;
    }
    const sd = e.target.closest('[data-snapd]'); if (sd) { it.snapshots.splice(+sd.dataset.snapd, 1); save(); renderInspector(); }
  });
  side.addEventListener('input', e => {
    const it = I(P().current); if (!it) return;
    if (e.target.id === 'iSyn') { it.synopsis = e.target.value; save(); }
    // Typing a target only updates the counter; the editor is rebuilt once, on change, to add or remove the bar.
    if (e.target.id === 'iTarget') { it.target = Math.max(0, +e.target.value || 0); save(); if ($('#docBar')) updateDocWc(it); }
  });
  side.addEventListener('change', e => {
    const it = I(P().current); if (!it) return;
    if (e.target.id === 'iTarget' && P().view === 'write' && !!$('#docBar') !== !!it.target) rerenderKeepCaret();
    if (e.target.id === 'iStatus') { it.status = e.target.value; save(); if (P().view !== 'write') renderMain(); }
    if (e.target.id === 'orLang') { S.lang = e.target.value; save(); lookup(OR.word, 'tr'); }
  });

  // popups
  $('#menu').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const it = menuItems[+b.dataset.i]; hideMenu(); if (it && it.act) it.act(); });
  $('#ac').addEventListener('mousedown', e => { e.preventDefault(); const b = e.target.closest('button'); if (b) pickAC(+b.dataset.i); });
  document.addEventListener('pointerdown', e => { if (!$('#menu').hidden && !e.target.closest('#menu')) hideMenu(); }, true);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-x]')) closeModal(); });
  window.addEventListener('resize', () => { hideMenu(); hideAC(); });

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) return closeModal();
      if (!$('#menu').hidden) return hideMenu();
      if (document.body.classList.contains('focus')) return setFocus(false);
      document.body.classList.remove('show-binder', 'show-side');
    }
    // Ctrl+K only: Ctrl+P stays the browser's print shortcut.
    if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); quickSwitcher(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(() => { if (!saveFailed) toast('Saved ✦ (Rosequill also saves as you type)'); }); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'o' && document.activeElement !== $('#ed')) { e.preventDefault(); oracleFromEditor(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) emergencySave(); else onVisible(); });
  window.addEventListener('pagehide', emergencySave);
}
