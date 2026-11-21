'use strict';
/* Rosequill backups. Rosequill already saves every keystroke in the browser (app.js). This adds:
   1. Device:  asks the browser to keep that storage permanently, so it is never cleared to free space.
   2. Files:   once a folder is chosen, writes a full backup, 14 daily copies and every page as a .md file there.
   3. Cloud:   a private copy in her own Rosequill account (username + password), with 30 daily versions
               kept by the database, synced to her other devices. If two devices both changed a grimoire,
               both versions are kept, so nothing is ever overwritten silently. */
const Backup = (() => {
  const SB_URL = 'https://hontxqtggrvxybamqrnh.supabase.co';
  const SB_KEY = 'sb_publishable__gdf9hPZ-q7LUOkpcwkyLg_6wUW0N3y';
  const EMAIL_SUFFIX = '@rosequill.local'; // a username becomes this address, so Rosequill accounts never clash with other apps' logins
  const K = { session: 'rq_session', cloud: 'rq_cloud:', removed: 'rq_cloud_removed:', files: 'rq_files', lastExport: 'rq_last_export', nudge: 'rq_nudge' };
  const ls = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  };
  const FS_OK = typeof window.showDirectoryPicker === 'function';
  const st = { persisted: null, cloud: 'off', cloudErr: '', lastCloud: ls.get('rq_last_cloud', 0), folder: 'none', folderName: '', lastFolder: ls.get('rq_last_folder', 0) };
  let session = ls.get(K.session, null), dir = null, cloudT = 0, fileT = 0, tick = 0, syncing = null, again = false;

  /* ---------- content signature: what counts as a real change ---------- */
  // Only the writing and its structure; not which page is open, the view, or folders expanded.
  const content = p => ({ id: p.id, name: p.name, author: p.author, target: p.target, sessionTarget: p.sessionTarget, roots: p.roots, items: p.items });
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined && k !== 'titleBefore').map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  function sig(p) { const s = canon(content(p)); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '.' + s.length; }

  /* ---------- gzip + base64 packing (keeps cloud rows small) ---------- */
  async function pack(obj) {
    const text = JSON.stringify(obj);
    if (!window.CompressionStream) return 'js:' + text;
    const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const bytes = new Uint8Array(buf); let out = '';
    for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return 'gz:' + btoa(out);
  }
  async function unpack(s) {
    if (s.startsWith('js:')) return JSON.parse(s.slice(3));
    const bin = atob(s.slice(3)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }

  /* ---------- 1. device storage ---------- */
  async function persist() {
    try { if (navigator.storage && navigator.storage.persist) st.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch { }
  }

  /* ---------- 3. cloud: sign-in ---------- */
  async function auth(path, body) {
    const r = await fetch(SB_URL + '/auth/v1/' + path, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.msg || d.error_description || d.message || 'Sign-in failed.'); e.status = r.status; throw e; }
    return d;
  }
  function keep(d) {
    session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000, user: { id: d.user.id, email: d.user.email } };
    ls.set(K.session, session);
  }
  let refreshing = null;
  async function token() {
    if (!session) throw Object.assign(new Error('Signed out'), { status: 401 });
    const fresh = ls.get(K.session, null); // another tab may already have refreshed it
    if (fresh && fresh.user && session.user && fresh.user.id === session.user.id && fresh.expires_at > session.expires_at) session = fresh;
    if (session.expires_at - Date.now() > 60000) return session.access_token;
    if (!refreshing) refreshing = auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token }).then(keep).finally(() => { refreshing = null; });
    try { await refreshing; } catch (e) { if (e.status === 400 || e.status === 401) signedOut('Your sign-in expired. Sign in again to keep backing up.'); throw e; }
    return session.access_token;
  }
  function signedOut(msg) { session = null; localStorage.removeItem(K.session); st.cloud = 'signedout'; st.cloudErr = msg || ''; paint(); }
  async function rest(path, opt = {}) {
    const t = await token();
    const r = await fetch(SB_URL + '/rest/v1/' + path, {
      method: opt.method || 'GET',
      headers: Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + t }, opt.body !== undefined ? { 'Content-Type': 'application/json' } : {}, opt.headers || {}),
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) { const e = new Error(r.status + ' ' + text.slice(0, 200)); e.status = r.status; throw e; }
    return text ? JSON.parse(text) : null;
  }
  const emailFor = name => { name = String(name).trim(); return name.includes('@') ? name.toLowerCase() : name.toLowerCase().replace(/\s+/g, '') + EMAIL_SUFFIX; };
  const who = () => session ? session.user.email.replace(EMAIL_SUFFIX, '') : '';
  async function signIn(name, password, create) {
    const email = emailFor(name);
    const d = await auth(create ? 'signup' : 'token?grant_type=password', { email, password });
    if (!d.access_token) throw new Error('The account was made but needs confirming before it can be used.');
    keep(d); st.cloud = 'ok'; st.cloudErr = '';
    await syncNow();
  }
  function signOut() {
    const old = session; signedOut();
    st.cloud = 'off';
    if (old) fetch(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + old.access_token } }).catch(() => { });
    paint();
  }

  /* ---------- 3. cloud: sync ---------- */
  const metaKey = () => K.cloud + session.user.id, removedKey = () => K.removed + session.user.id;
  function addProject(p) { S.projects[p.id] = p; if (!S.order.includes(p.id)) S.order.push(p.id); save(); }
  function replaceProject(p) {
    const old = S.projects[p.id];
    if (old) { p.view = old.view; p.open = old.open; p.dayStart = old.dayStart; if (p.items[old.current]) p.current = old.current; }
    S.projects[p.id] = p; save();
    if (S.current === p.id) rerenderKeepCaret(); else renderHeader();
  }
  async function cloudSync() {
    if (!session) { st.cloud = 'off'; paint(); return; }
    if (!navigator.onLine) { st.cloud = 'offline'; paint(); return; }
    st.cloud = 'syncing'; paint();
    const M = ls.get(metaKey(), {}), removed = ls.get(removedKey(), {});
    let conflicts = 0, pulled = 0;
    const rows = await rest('rq_projects?select=id,name,rev,words,updated_at');
    const cloud = new Map(rows.map(r => [r.id, r]));
    // Pull: grimoires that are new here, or changed on another device since this one last synced.
    for (const r of rows) {
      if (removed[r.id]) continue;
      const m = M[r.id];
      if (m && r.rev === m.base && S.projects[r.id]) continue;
      const full = (await rest('rq_projects?select=data,rev&id=eq.' + encodeURIComponent(r.id)))[0]; if (!full) continue;
      const proj = await unpack(full.data); proj.id = r.id; normalizeProject(proj);
      const ps = sig(proj), local = S.projects[r.id]; // from here to the decision there is no await, so typing can't slip in between
      if (!local) { addProject(proj); M[r.id] = { base: full.rev, sig: ps }; pulled++; continue; }
      const ls_ = sig(local);
      if (ls_ === ps) { M[r.id] = { base: full.rev, sig: ps }; continue; }
      if (!m || m.sig === ls_) { replaceProject(proj); M[r.id] = { base: full.rev, sig: ps }; pulled++; continue; }
      // Both devices changed it: keep the other device's version as its own grimoire; this one then uploads.
      const copy = { ...proj, id: uid(), name: proj.name + ' (from another device, ' + today() + ')' };
      addProject(normalizeProject(copy)); M[r.id] = { base: full.rev, sig: null }; conflicts++;
    }
    ls.set(metaKey(), M);
    // Drop the untouched sample tale once her real grimoires have arrived on a new device.
    if (pulled) for (const id of [...S.order]) { const p = S.projects[id]; if (p && p.sample && p.sampleSig === sig(p) && S.order.length > 1) { delete S.projects[id]; S.order = S.order.filter(x => x !== id); if (S.current === id) S.current = S.order[0]; save(); render(); } }
    // Push: grimoires changed on this device.
    for (const id of [...S.order]) {
      const p = S.projects[id]; if (!p || removed[id]) continue;
      const s = sig(p), m = M[id];
      if (p.sample && p.sampleSig === s) continue; // never upload the untouched sample
      if (m && m.sig === s && cloud.has(id)) continue;
      const body = { name: p.name, data: await pack(content(p)), words: manuscriptWords(p) };
      let res = null;
      try {
        if (cloud.has(id) && m) res = await rest(`rq_projects?id=eq.${encodeURIComponent(id)}&rev=eq.${m.base}&select=rev`, { method: 'PATCH', body: { ...body, rev: m.base + 1 }, headers: { Prefer: 'return=representation' } });
        else if (!cloud.has(id)) res = await rest('rq_projects?select=rev', { method: 'POST', body: { ...body, id, rev: 1 }, headers: { Prefer: 'return=representation' } });
      } catch (e) { if (e.status !== 409) throw e; }
      if (res && res.length) { M[id] = { base: res[0].rev, sig: s }; ls.set(metaKey(), M); }
      else again = true; // another device saved first: the next round pulls it and keeps both versions
    }
    ls.set(metaKey(), M);
    st.cloud = 'ok'; st.cloudErr = ''; st.lastCloud = Date.now(); ls.set('rq_last_cloud', st.lastCloud); paint();
    if (pulled) toast(`☁ Brought ${pulled} grimoire${pulled > 1 ? 's' : ''} up to date from your other devices`);
    if (conflicts) toast(`☁ A grimoire was changed on two devices, so both versions were kept. Look for “(from another device)”`, 9000);
  }
  async function syncNow() {
    clearTimeout(cloudT);
    if (syncing) { again = true; return syncing; }
    const run = async () => {
      try { await cloudSync(); }
      catch (e) {
        if (!session) return;
        st.cloud = navigator.onLine ? 'error' : 'offline';
        st.cloudErr = navigator.onLine ? 'The cloud backup could not be reached. It will try again.' : '';
        paint();
        cloudT = setTimeout(syncNow, 60000);
      }
    };
    syncing = (navigator.locks ? navigator.locks.request('rq-cloud', run) : run()).finally(() => { syncing = null; if (again) { again = false; cloudT = setTimeout(syncNow, 3000); } });
    return syncing;
  }

  /* ---------- 2. files in a folder she chooses ---------- */
  const safe = s => (String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 80) || 'Untitled').replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '_$1');
  async function loadDir() {
    if (!FS_OK || !Store.db) return;
    try { dir = await Store.get('backupDir'); } catch { dir = null; }
    if (!dir || typeof dir.queryPermission !== 'function') { dir = null; return; }
    st.folderName = dir.name;
    st.folder = (await dir.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'reconnect';
  }
  async function chooseFolder() {
    try {
      const d = await window.showDirectoryPicker({ id: 'rosequill', mode: 'readwrite', startIn: 'documents' });
      dir = d; await Store.set('backupDir', d); st.folderName = d.name; st.folder = 'ok';
      ls.set(K.files, {}); await writeFolder(true);
      toast(`❧ Backing up to the “${d.name}” folder`);
    } catch (e) { if (e.name !== 'AbortError') toast('Rosequill could not use that folder. Try another one.'); }
    paint();
  }
  async function reconnect() {
    if (!dir) return chooseFolder();
    try { st.folder = (await dir.requestPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'reconnect'; } catch { st.folder = 'reconnect'; }
    if (st.folder === 'ok') await writeFolder(true);
    paint();
  }
  async function writeFile(base, parts, name, text) {
    let d = base; for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(name, { create: true }); const w = await fh.createWritable();
    await w.write(text); await w.close();
  }
  async function removeFile(base, parts, name) {
    try { let d = base; for (const p of parts) d = await d.getDirectoryHandle(p); await d.removeEntry(name); } catch { }
  }
  let writing = null;
  async function writeFolder(force) {
    if (!dir || st.folder !== 'ok') return;
    if (writing) return writing.then(() => writeFolder(force));
    writing = (async () => {
      try {
        if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') { st.folder = 'reconnect'; paint(); return; }
        const F = ls.get(K.files, {}), day = today();
        for (const id of S.order) {
          const p = S.projects[id], s = sig(p), name = safe(p.name);
          let f = F[id]; if (!f || f.dir !== name) f = F[id] = { dir: name, pages: {} };
          if (!force && f.sig === s) continue;
          const backup = JSON.stringify({ app: 'rosequill', v: 1, saved: new Date().toISOString(), project: p });
          await writeFile(dir, [name], name + '.rosequill.json', backup);
          await writeFile(dir, [name, 'Daily backups'], `${name} ${day}.rosequill.json`, backup);
          // Readable copies of every page, mirroring the binder; only changed pages are rewritten.
          const seen = new Set();
          const walk = (fid, parts) => {
            const it = p.items[fid]; if (!it || it.root === 'trash') return [];
            const here = it.root ? [...parts, safe(it.title)] : parts;
            return it.children.flatMap(c => { const x = p.items[c]; if (!x) return []; return x.type === 'folder' ? walk(c, [...here, safe(x.title)]) : [{ x, parts: here }]; });
          };
          const pages = ['manuscript', 'lore', 'research'].flatMap(k => walk(p.roots[k], ['Pages']));
          for (const { x, parts } of pages) {
            const path = [...parts, safe(x.title) + '.md'].join('/'); seen.add(x.id);
            const old = f.pages[x.id];
            if (!force && old && old.path === path && old.mod === x.modified) continue;
            if (old && old.path !== path) { const op = old.path.split('/'); await removeFile(dir, [name, ...op.slice(0, -1)], op[op.length - 1]); }
            const md = `# ${x.title}\n\n${x.synopsis ? '> ' + x.synopsis.replace(/\n/g, '\n> ') + '\n\n' : ''}${x.content}\n`;
            await writeFile(dir, [name, ...parts], safe(x.title) + '.md', md);
            f.pages[x.id] = { path, mod: x.modified };
          }
          for (const [pid, old] of Object.entries(f.pages)) if (!seen.has(pid)) { const op = old.path.split('/'); await removeFile(dir, [name, ...op.slice(0, -1)], op[op.length - 1]); delete f.pages[pid]; }
          // Keep 14 days of dated copies.
          try {
            const dd = await (await dir.getDirectoryHandle(name)).getDirectoryHandle('Daily backups');
            const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
            for await (const [fname] of dd.entries()) { const m = fname.match(/ (\d{4}-\d{2}-\d{2})\.rosequill\.json$/); if (m && m[1] < cutoff) await dd.removeEntry(fname).catch(() => { }); }
          } catch { }
          f.sig = s; ls.set(K.files, F);
        }
        st.lastFolder = Date.now(); ls.set('rq_last_folder', st.lastFolder); st.folderErr = '';
      } catch (e) {
        if (e && e.name === 'NotAllowedError') st.folder = 'reconnect';
        else st.folderErr = 'Could not write to the folder. Is it still there?';
      }
      paint();
    })();
    try { await writing; } finally { writing = null; }
  }

  /* ---------- status in the header ---------- */
  const ago = t => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); };
  function level() {
    if (st.cloud === 'error' || st.cloud === 'signedout' || st.folder === 'reconnect') return 'warn';
    if (st.cloud === 'syncing') return 'busy';
    if (session || st.folder === 'ok') return 'ok';
    return 'off';
  }
  function paint() {
    const b = $('#btnBackup'); if (b) {
      const lv = level(); b.className = 'ibtn bk-' + lv;
      const parts = [];
      parts.push(session ? (st.cloud === 'ok' ? `Cloud backup: ${ago(st.lastCloud)}` : st.cloud === 'offline' ? 'Cloud backup: waiting for internet' : st.cloud === 'syncing' ? 'Cloud backup: saving…' : 'Cloud backup: needs attention') : 'Cloud backup: off');
      parts.push(st.folder === 'ok' ? `Folder “${st.folderName}”: ${ago(st.lastFolder)}` : st.folder === 'reconnect' ? 'Folder: click to reconnect' : 'Folder backup: off');
      b.title = parts.join('\n');
    }
    if ($('#bkModal')) drawModal();
  }

  /* ---------- the Backups window ---------- */
  let cloudList = null, versions = {};
  async function open() { openModal('<div id="bkModal"></div>', 'wide'); drawModal(); if (session) { refreshList(); } }
  async function refreshList() {
    try { cloudList = await rest('rq_projects?select=id,name,words,updated_at&order=updated_at.desc'); } catch { cloudList = null; }
    if ($('#bkModal')) drawModal();
  }
  function drawModal() {
    const box = $('#bkModal'); if (!box) return;
    const removed = session ? ls.get(removedKey(), {}) : {};
    const dev = st.persisted ? '<span class="ok">✓ Protected.</span> Your browser has promised not to clear it.' : '<span class="warn">Not protected yet.</span> The browser could clear it if the device runs low on space. Installing Rosequill as an app (browser menu → Install) usually fixes this.';
    let files;
    if (!FS_OK) files = `<p class="muted">This browser can't save to a folder automatically (phones, tablets, Firefox and Safari can't). The cloud backup below covers this device. You can also download a copy any time.</p><div class="bk-act"><button class="ghost" data-bk="download">⇩ Download a backup now</button></div>`;
    else if (st.folder === 'ok') files = `<p><span class="ok">✓ On.</span> Saving to the <b>${esc(st.folderName)}</b> folder: a full backup, a dated copy for each of the last 14 days, and every page as a .md file. Last written ${ago(st.lastFolder)}.</p>${st.folderErr ? `<p class="warn">${esc(st.folderErr)}</p>` : ''}<div class="bk-act"><button class="ghost" data-bk="folder">Choose a different folder</button><button class="ghost" data-bk="writenow">Write now</button></div>`;
    else if (st.folder === 'reconnect') files = `<p><span class="warn">Paused.</span> The browser needs your OK again to write to <b>${esc(st.folderName)}</b>.</p><div class="bk-act"><button class="primary" data-bk="reconnect">Allow writing to “${esc(st.folderName)}”</button><button class="ghost" data-bk="folder">Choose another folder</button></div>`;
    else files = `<p class="muted">Pick a folder once, and Rosequill keeps copies there as you write. Choose one inside <b>OneDrive</b> (e.g. Documents) and OneDrive backs it up too.</p><div class="bk-act"><button class="primary" data-bk="folder">Choose a backup folder</button></div>`;
    let cloud;
    if (!session) {
      cloud = `<p class="muted">Keeps a private copy online with 30 days of daily versions, and brings your writing to your other devices. Only you can see it.</p>
        ${st.cloudErr ? `<p class="warn">${esc(st.cloudErr)}</p>` : ''}
        <p class="bk-small"><b>First time?</b> Choose a username and a password (at least 6 characters) and press <b>Create my account</b>. On your other devices, use the same two and press <b>Sign in</b>.</p>
        <form class="bk-form" id="bkForm"><input class="m-field" id="bkUser" placeholder="Username" autocomplete="username" autocapitalize="off" spellcheck="false" required>
        <input class="m-field" id="bkPass" type="password" placeholder="Password" autocomplete="current-password" required minlength="6">
        <div class="bk-go"><button class="primary" data-mode="up">Create my account</button><button class="ghost" data-mode="in">Sign in</button></div></form>
        <p class="bk-msg" id="bkMsg"></p>`;
    } else {
      const lv = st.cloud === 'ok' ? `<span class="ok">✓ On.</span> Last backed up ${ago(st.lastCloud)}.` : st.cloud === 'syncing' ? 'Backing up…' : st.cloud === 'offline' ? '<span class="warn">Waiting for internet.</span> It backs up as soon as you are online.' : `<span class="warn">${esc(st.cloudErr || 'Needs attention.')}</span>`;
      const local = new Set(S.order);
      const rows = (cloudList || []).map(r => {
        const here = local.has(r.id) && !removed[r.id];
        const v = versions[r.id];
        return `<div class="bk-row"><div class="bk-name"><b>${esc(r.name || 'Untitled')}</b><small>${fmtN(r.words || 0)} words · saved ${ago(Date.parse(r.updated_at))}${here ? '' : ' · <i>not on this device</i>'}</small></div>
          <div class="bk-btns">${here ? '' : `<button class="mini" data-bk="bring" data-id="${esc(r.id)}">Add to this device</button>`}<button class="mini" data-bk="versions" data-id="${esc(r.id)}">${v ? 'Hide versions' : 'Versions'}</button>${here ? '' : `<button class="mini danger" data-bk="delcloud" data-id="${esc(r.id)}" data-name="${esc(r.name)}">Delete from cloud</button>`}</div>
          ${v ? `<div class="bk-vers">${v === 'loading' ? '<p class="muted">Loading…</p>' : v.length ? v.map(x => `<div class="bk-ver"><span>${new Date(x.day + 'T12:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtN(x.words || 0)} words</span><button class="mini" data-bk="restore" data-id="${esc(r.id)}" data-day="${x.day}">Restore as a copy</button></div>`).join('') : '<p class="muted">No versions yet.</p>'}</div>` : ''}</div>`;
      }).join('');
      cloud = `<p>${lv} Signed in as <b>${esc(who())}</b>.</p>
        <div class="bk-act"><button class="ghost" data-bk="syncnow">Back up now</button><button class="ghost" data-bk="signout">Sign out</button></div>
        <label class="f">In your cloud</label>${cloudList === null ? '<p class="muted">Loading…</p>' : rows || '<p class="muted">Nothing backed up yet. It starts within a few seconds of your next change.</p>'}`;
    }
    const focused = document.activeElement && document.activeElement.id, uval = $('#bkUser') ? $('#bkUser').value : '', pval = $('#bkPass') ? $('#bkPass').value : '';
    box.innerHTML = `<h3>Backups</h3><p class="muted bk-lead">Rosequill saves as you type. These keep extra copies in case anything goes wrong.</p>
      <section class="bk-sec"><h4>✦ On this device</h4><p>Saved automatically in this browser. ${dev}</p></section>
      <section class="bk-sec"><h4>❧ In your files</h4>${files}</section>
      <section class="bk-sec"><h4>☁ Cloud backup</h4>${cloud}</section>
      <div class="m-act"><button class="ghost" data-x>Close</button></div>`;
    if ($('#bkUser')) { $('#bkUser').value = uval; $('#bkPass').value = pval; if (focused && $('#' + focused)) $('#' + focused).focus(); }
  }
  async function onModalClick(e) {
    const b = e.target.closest('[data-bk]'); if (!b) return;
    const a = b.dataset.bk, id = b.dataset.id;
    if (a === 'download') return exportBackup();
    if (a === 'folder') return chooseFolder();
    if (a === 'reconnect') return reconnect();
    if (a === 'writenow') { await writeFolder(true); toast('❧ Written to your folder'); return; }
    if (a === 'syncnow') { await syncNow(); await refreshList(); if (st.cloud === 'ok') toast('☁ Backed up'); return; }
    if (a === 'signout') { if (await confirmBox('Sign out of the cloud backup on this device? Your writing stays here, but it stops being backed up online.', 'Sign out')) { signOut(); open(); } else open(); return; }
    if (a === 'versions') {
      if (versions[id]) { delete versions[id]; return drawModal(); }
      versions[id] = 'loading'; drawModal();
      try { versions[id] = await rest(`rq_versions?select=day,words&project_id=eq.${encodeURIComponent(id)}&order=day.desc`); } catch { versions[id] = []; toast('Could not load the versions.'); }
      return drawModal();
    }
    if (a === 'bring') {
      const removed = ls.get(removedKey(), {}); delete removed[id]; ls.set(removedKey(), removed);
      const M = ls.get(metaKey(), {}); delete M[id]; ls.set(metaKey(), M);
      if (S.projects[id]) { delete S.projects[id]; S.order = S.order.filter(x => x !== id); }
      await syncNow(); if (S.projects[id]) { S.current = id; ensureDay(); save(); render(); toast(`✦ “${S.projects[id].name}” is on this device again`); }
      return refreshList();
    }
    if (a === 'restore') {
      try {
        const v = (await rest(`rq_versions?select=data,name&project_id=eq.${encodeURIComponent(id)}&day=eq.${b.dataset.day}`))[0];
        const p = await unpack(v.data); p.id = uid(); p.name = (v.name || p.name) + ' (restored ' + b.dataset.day + ')'; delete p.sample;
        normalizeProject(p); S.projects[p.id] = p; S.order.push(p.id); S.current = p.id; ensureDay(); save(); closeModal(); render();
        toast(`✦ Restored as “${p.name}”. The original is untouched`, 6000);
      } catch { toast('Could not restore that version.'); }
      return;
    }
    if (a === 'delcloud') {
      if (!await confirmBox(`Delete “${esc(b.dataset.name)}” and all its versions from the cloud? It is not on this device, so this removes the last copy. This can't be undone.`, 'Delete from cloud', true)) return open();
      try { await rest(`rq_versions?project_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); await rest(`rq_projects?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Deleted from the cloud'); } catch { toast('Could not delete it. Try again.'); }
      return open();
    }
  }
  async function onModalSubmit(e) {
    if (e.target.id !== 'bkForm') return; e.preventDefault();
    const up = !!(e.submitter && e.submitter.dataset.mode === 'up'), msg = $('#bkMsg'), btns = $$('#bkForm button');
    btns.forEach(b => { b.disabled = true; }); msg.textContent = up ? 'Creating your account…' : 'Signing in…';
    try { await signIn($('#bkUser').value, $('#bkPass').value, up); drawModal(); refreshList(); toast(up ? '☁ Account made. Cloud backup is on' : '☁ Signed in. Cloud backup is on'); }
    catch (err) {
      btns.forEach(b => { b.disabled = false; });
      const m = err.message || '';
      msg.textContent = /invalid login/i.test(m) ? 'That username and password don’t match. First time here? Press Create my account instead.'
        : /already registered|already exists/i.test(m) ? 'That username is taken. If it is yours, press Sign in; otherwise choose another username.'
        : /password/i.test(m) && /6|short|weak/i.test(m) ? 'The password needs at least 6 characters.'
        : m;
    }
  }

  /* ---------- wiring ---------- */
  function changed() {
    clearTimeout(fileT); fileT = setTimeout(() => writeFolder(false), 6000);
    if (session) { clearTimeout(cloudT); cloudT = setTimeout(syncNow, 15000); }
  }
  function flushSoon() { if (session) syncNow(); writeFolder(false); }
  function forget(id) { if (session) { const r = ls.get(removedKey(), {}); r[id] = true; ls.set(removedKey(), r); } } // a grimoire deleted here stays in the cloud as a backup, but isn't pulled back
  function nudge() {
    if (session || st.folder === 'ok') return;
    const words = S.order.reduce((n, id) => { const p = S.projects[id]; return n + (p.sample && p.sampleSig === sig(p) ? 0 : manuscriptWords(p)); }, 0);
    const last = ls.get(K.lastExport, 0), shown = ls.get(K.nudge, '');
    if (words >= 100 && Date.now() - last > 7 * 864e5 && shown !== today()) { ls.set(K.nudge, today()); setTimeout(() => toast('✦ Your writing is only saved in this browser. Tap ☁ to turn on backups', 8000), 2500); }
  }
  async function init() {
    for (const id of S.order) { const p = S.projects[id]; if (p.sample && !p.sampleSig) { p.sampleSig = sig(p); save(); } }
    const box = $('#modalBox');
    box.addEventListener('click', e => { if ($('#bkModal')) onModalClick(e); });
    box.addEventListener('submit', e => { if ($('#bkModal')) onModalSubmit(e); });
    $('#btnBackup').addEventListener('click', open);
    await persist(); await loadDir();
    if (session) st.cloud = 'ok';
    paint(); nudge();
    if (session) syncNow();
    window.addEventListener('online', () => { if (session) syncNow(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSoon(); else if (session) syncNow(); });
    tick = setInterval(() => { if (!document.hidden && session) syncNow(); paint(); }, 5 * 60000);
    window.addEventListener('storage', e => { if (e.key === K.session) { session = ls.get(K.session, null); st.cloud = session ? 'ok' : 'off'; paint(); } });
  }
  return { init, changed, forget, open, paint, sig, _st: st, _sync: syncNow, _write: writeFolder };
})();
