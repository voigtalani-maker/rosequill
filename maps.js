'use strict';
/* Rosequill map maker: generates detailed fantasy maps (terrain, coastlines, rivers, forests, mountains,
   named towns, regions and seas) and lets the writer reshape and annotate them. Maps live in the grimoire
   (p.maps / p.mapOrder), so they save, sync and back up with everything else.
   Coordinates: every map is 1600 x 1000 "map units"; terrain is a 200 x 125 height grid (8 units a cell). */
const Maps = (() => {
  const W = 1600, H = 1000, GW = 200, GH = 125, CELL = W / GW, RW = 800, RH = 500;
  const STYLES = {
    parchment: { name: 'Parchment', ink: '#4a3424', deep: [138, 172, 180], shallow: [182, 207, 205], sand: [232, 219, 176], grass: [214, 212, 160], forest: [168, 182, 122], hill: [210, 192, 150], mount: [192, 172, 136], snow: [247, 243, 232], tree: '#7d8f56', shadow: [110, 86, 60], light: [255, 250, 235], shadeK: 1, river: '#4f7f92', road: '#7a5634', border: '#9b3d6e', label: '#3a2716', frame: '#4a3424', card: 'rgba(244,234,208,.92)' },
    rose: { name: 'Rose', ink: '#7a1f4f', deep: [192, 120, 164], shallow: [226, 168, 198], sand: [255, 243, 238], grass: [252, 233, 239], forest: [236, 192, 212], hill: [242, 208, 220], mount: [230, 186, 206], snow: [255, 250, 252], tree: '#a8457a', shadow: [168, 74, 122], light: [255, 246, 250], shadeK: 0.8, river: '#c0508a', road: '#8f4a6c', border: '#7a1f4f', label: '#5e1238', frame: '#a8235f', card: 'rgba(255,244,249,.92)' },
    night: { name: 'Night', ink: '#f3c1dd', deep: [20, 16, 38], shallow: [38, 30, 62], sand: [84, 68, 96], grass: [64, 52, 84], forest: [50, 44, 74], hill: [80, 66, 98], mount: [100, 86, 120], snow: [205, 196, 225], tree: '#a58fd0', shadow: [8, 6, 18], light: [150, 140, 190], shadeK: 0.9, river: '#8fb6ff', road: '#e3bd77', border: '#ff8fc0', label: '#fbe7f2', frame: '#e3bd77', card: 'rgba(36,26,52,.9)' },
  };
  const SHAPES = { continent: ['Continent', 0.42], islands: ['Islands', 0.27], island: ['One island', 0.32], inland: ['Inland realm', 0.9] };
  const PINS = { city: 'City', town: 'Town', castle: 'Castle', tower: 'Tower', ruin: 'Ruins', cave: 'Cave', temple: 'Temple', port: 'Port', star: 'Point of interest' };
  const PATHS = { river: 'River', road: 'Road', border: 'Border' };

  /* ---------- seeded randomness and noise ---------- */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function noise2(seed) {
    const r = rng(seed), p = [...Array(256).keys()], P = new Uint8Array(512), G = new Float32Array(512);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) P[i] = p[i & 255];
    for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; G[i * 2] = Math.cos(a); G[i * 2 + 1] = Math.sin(a); }
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const g = (ix, iy, dx, dy) => { const k = (P[(P[ix & 255] + (iy & 255)) & 511] & 255) * 2; return G[k] * dx + G[k + 1] * dy; };
    return (x, y) => {
      const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, u = fade(xf), v = fade(yf);
      const a = g(X, Y, xf, yf) + u * (g(X + 1, Y, xf - 1, yf) - g(X, Y, xf, yf));
      const b = g(X, Y + 1, xf, yf - 1) + u * (g(X + 1, Y + 1, xf - 1, yf - 1) - g(X, Y + 1, xf, yf - 1));
      return a + v * (b - a);
    };
  }
  function fbm(n, x, y, oct) { let s = 0, amp = 1, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += amp * n(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; } return s / norm; }
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];

  /* ---------- fantasy names ---------- */
  const SYL = {
    a: ['Ael', 'Bryn', 'Cal', 'Dun', 'El', 'Fen', 'Gal', 'Hal', 'Is', 'Kel', 'Lor', 'Mor', 'Nim', 'Ost', 'Pel', 'Quel', 'Ros', 'Sil', 'Thal', 'Ul', 'Val', 'Wyn', 'Yr', 'Zel', 'Ash', 'Bel', 'Cor', 'Dra', 'Eir', 'Fae', 'Glen', 'Hel', 'Lys', 'Mar', 'Nor', 'Or', 'Ser', 'Tir', 'Vey', 'Elow', 'Thorn', 'Rhos', 'Liri', 'Mira'],
    b: ['a', 'e', 'i', 'o', 'ar', 'en', 'or', 'is', 'an', 'el', 'ae', 'ia', '', '', ''],
    c: ['dor', 'mere', 'wick', 'ford', 'haven', 'holt', 'moor', 'vale', 'fell', 'crest', 'shire', 'gard', 'more', 'thorn', 'rose', 'wyn', 'stead', 'mouth', 'reach', 'brook', 'hollow', 'spire', 'fall', 'dell', 'bourne', 'mire', 'gate', 'keep'],
  };
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  function placeName(r) { let n = pick(r, SYL.a) + pick(r, SYL.b) + pick(r, SYL.c); n = n.replace(/([aeiou])\1+/g, '$1').replace(/(.)\1\1/g, '$1$1'); return n[0].toUpperCase() + n.slice(1).toLowerCase(); }
  function regionName(r) { const n = placeName(r); return pick(r, [`Kingdom of ${n}`, `The ${n} Wilds`, `The ${n} Marches`, `${n}`, `The ${n} Reach`, `Duchy of ${n}`]); }
  function seaName(r) { const n = placeName(r); return pick(r, [`The ${n} Sea`, `Sea of ${n}`, `${n} Bay`, `The Sea of Whispers`, `The ${n} Deep`]); }

  /* ---------- map data ---------- */
  const enc = f32 => { const u = new Uint8Array(f32.length); for (let i = 0; i < f32.length; i++) u[i] = Math.max(0, Math.min(255, Math.round(f32[i] * 255))); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  const dec = b64 => { const bin = atob(b64), f = new Float32Array(GW * GH); for (let i = 0; i < f.length && i < bin.length; i++) f[i] = bin.charCodeAt(i) / 255; return f; };
  const fid = () => Math.random().toString(36).slice(2, 9);

  function makeHeights(seed, shape) {
    const n1 = noise2(seed), n2 = noise2(seed + 101), h = new Float32Array(GW * GH);
    const freq = shape === 'islands' ? 6.2 : shape === 'inland' ? 3.6 : 3.1;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const nx = x / GW, ny = y / GH, px = nx * freq * 1.6, py = ny * freq;
      const wx = n2(px * 0.6, py * 0.6) * 0.9, wy = n2(px * 0.6 + 31.7, py * 0.6 + 17.3) * 0.9; // warp for wiggly coasts
      const v = fbm(n1, px + wx, py + wy, 6);
      const dx = nx * 2 - 1, dy = ny * 2 - 1, d = Math.sqrt(dx * dx * 0.8 + dy * dy);
      let hv = shape === 'continent' ? v + 0.55 * (1 - d * 1.05) : shape === 'islands' ? v * 1.15 + 0.22 * (1 - d) : shape === 'island' ? v * 0.75 + 0.95 * (1 - d * 1.2) : v;
      if (shape !== 'inland') { const edge = Math.min(nx, 1 - nx, ny, 1 - ny); hv -= Math.max(0, 0.09 - edge) * 7; }
      h[y * GW + x] = hv;
    }
    // Remap so the chosen share of the map is land at sea level 0.5.
    const sorted = Float32Array.from(h).sort(), lo = sorted[0], hi = sorted[sorted.length - 1];
    const t = sorted[Math.floor((1 - SHAPES[shape][1]) * (sorted.length - 1))];
    for (let i = 0; i < h.length; i++) h[i] = h[i] < t ? 0.5 * (h[i] - lo) / ((t - lo) || 1) : 0.5 + 0.5 * (h[i] - t) / ((hi - t) || 1);
    return h;
  }
  function makeMoist(seed) { const n = noise2(seed + 977), m = new Float32Array(GW * GH); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) m[y * GW + x] = Math.max(0, Math.min(1, 0.5 + fbm(n, x / GW * 4.2, y / GH * 2.8, 4) * 1.1)); return m; }

  function makeRivers(h, sea, r, count) {
    const used = new Uint8Array(GW * GH), rivers = [];
    const cands = []; for (let i = 0; i < h.length; i++) if (h[i] > sea + (1 - sea) * 0.55) cands.push(i);
    for (let k = 0; k < count * 6 && rivers.length < count && cands.length; k++) {
      let i = cands[Math.floor(r() * cands.length)]; if (used[i]) continue;
      const pts = []; let steps = 0, ok = false;
      while (steps++ < 400) {
        const x = i % GW, y = (i / GW) | 0; pts.push([(x + 0.5) * CELL + (r() - 0.5) * 4, (y + 0.5) * CELL + (r() - 0.5) * 4]);
        if (h[i] < sea) { ok = true; break; }
        if (used[i] && pts.length > 1) { ok = true; break; } // joins another river
        used[i] = 1;
        let best = -1, bh = h[i];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue; const j = yy * GW + xx, v = h[j] + r() * 0.004; if (v < bh) { bh = v; best = j; } }
        if (best < 0) { // a hollow: carve gently through it so the river keeps flowing
          let lo = -1, lh = 9; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue; const j = yy * GW + xx; if (!used[j] && h[j] < lh) { lh = h[j]; lo = j; } }
          if (lo < 0) break; h[lo] = Math.min(h[lo], h[i] - 0.002); best = lo;
        }
        i = best;
      }
      if (ok && pts.length > 10) rivers.push({ id: fid(), type: 'path', kind: 'river', pts: pts.filter((_, n) => n % 2 === 0 || n === pts.length - 1).map(p => [Math.round(p[0]), Math.round(p[1])]) });
    }
    return rivers;
  }

  function makePlaces(h, sea, rivers, r, shape) {
    const feats = [], near = (x, y, dist, list) => list.some(f => Math.hypot(f.x - x, f.y - y) < dist);
    const riverPts = rivers.flatMap(rv => rv.pts);
    const land = i => h[i] > sea + 0.006, at = (x, y) => h[Math.min(GH - 1, Math.max(0, y | 0)) * GW + Math.min(GW - 1, Math.max(0, x | 0))];
    const coastal = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (at(x + dx, y + dy) < sea) return true; return false; };
    const scored = [];
    for (let k = 0; k < 2600; k++) {
      const x = 4 + r() * (GW - 8), y = 4 + r() * (GH - 8), i = (y | 0) * GW + (x | 0); if (!land(i)) continue;
      const e = (h[i] - sea) / (1 - sea); if (e > 0.5) continue;
      const mx = (x + 0.5) * CELL, my = (y + 0.5) * CELL, nearRiver = riverPts.some(p => Math.hypot(p[0] - mx, p[1] - my) < 28);
      scored.push({ x: mx, y: my, s: r() + (nearRiver ? 0.8 : 0) + (coastal(x, y) ? 0.6 : 0) - e, coast: coastal(x, y) });
    }
    scored.sort((a, b) => b.s - a.s);
    const n = { continent: 10, islands: 7, island: 6, inland: 9 }[shape] || 8, pins = [];
    for (const c of scored) {
      if (pins.length >= n) break; if (near(c.x, c.y, 115, pins)) continue;
      const kind = pins.length === 0 ? 'city' : pins.length < 3 ? 'castle' : c.coast && r() < 0.45 ? 'port' : 'town';
      pins.push({ id: fid(), type: 'pin', kind, x: Math.round(c.x), y: Math.round(c.y), name: placeName(r), link: '' });
    }
    // A tower in the mountains, some ruins and a mysterious spot.
    const high = []; for (let k = 0; k < 1500; k++) { const x = r() * GW, y = r() * GH, i = (y | 0) * GW + (x | 0); if (land(i) && (h[i] - sea) / (1 - sea) > 0.6) high.push([(x + 0.5) * CELL, (y + 0.5) * CELL]); }
    if (high.length) { const [x, y] = high[Math.floor(r() * high.length)]; if (!near(x, y, 80, pins)) pins.push({ id: fid(), type: 'pin', kind: 'tower', x: Math.round(x), y: Math.round(y), name: placeName(r) + ' Spire', link: '' }); }
    for (const kind of ['ruin', 'star']) { const c = scored[Math.floor(scored.length * (0.4 + r() * 0.5))]; if (c && !near(c.x, c.y, 80, pins)) pins.push({ id: fid(), type: 'pin', kind, x: Math.round(c.x), y: Math.round(c.y), name: kind === 'ruin' ? 'Ruins of ' + placeName(r) : 'The ' + pick(r, ['Weeping Stone', 'Moonwell', 'Silver Grove', 'Witch’s Ring', 'Sunken Gate', 'Rose Altar']), link: '' }); }
    feats.push(...pins);
    // Region names over open land, sea names over open water.
    const regions = shape === 'island' ? 1 : shape === 'islands' ? 2 : 3;
    for (let k = 0, made = 0; k < 900 && made < regions; k++) {
      const x = 28 + r() * (GW - 56), y = 10 + r() * (GH - 20), i = (y | 0) * GW + (x | 0); if (!land(i) || (h[i] - sea) / (1 - sea) > 0.55) continue;
      const mx = (x + 0.5) * CELL, my = (y + 0.5) * CELL; if (near(mx, my, 90, pins) || near(mx, my, 300, feats.filter(f => f.kind === 'region'))) continue;
      feats.push({ id: fid(), type: 'label', kind: 'region', x: Math.round(mx), y: Math.round(my), text: regionName(r), size: 22, rot: Math.round((r() - 0.5) * 16) }); made++;
    }
    if (shape !== 'inland') for (let k = 0, made = 0; k < 900 && made < 2; k++) {
      const x = 26 + r() * (GW - 52), y = 10 + r() * (GH - 20); let open = true; // keep the whole name inside the frame
      for (let dy = -9; dy <= 9 && open; dy += 3) for (let dx = -14; dx <= 14 && open; dx += 3) if (at(x + dx, y + dy) >= sea) open = false;
      if (!open) continue; const mx = (x + 0.5) * CELL, my = (y + 0.5) * CELL; if (near(mx, my, 400, feats.filter(f => f.kind === 'sea'))) continue;
      feats.push({ id: fid(), type: 'label', kind: 'sea', x: Math.round(mx), y: Math.round(my), text: seaName(r), size: 20, rot: Math.round((r() - 0.5) * 20) }); made++;
    }
    return feats;
  }

  function generate(o) {
    const h = makeHeights(o.seed, o.shape), r = rng(o.seed + 5), feats = [];
    if (o.rivers) feats.push(...makeRivers(h, 0.5, r, { continent: 7, islands: 4, island: 4, inland: 7 }[o.shape] || 5));
    if (o.places) feats.push(...makePlaces(h, 0.5, feats.filter(f => f.kind === 'river'), r, o.shape));
    return { id: uid(), name: o.name || 'New map', seed: o.seed, shape: o.shape, sea: 0.5, style: o.style || 'parchment', heights: enc(h), features: feats, show: { symbols: true, grid: false, compass: true, frame: true, title: true }, created: Date.now(), modified: Date.now() };
  }

  /* ---------- terrain rendering (cached per map) ---------- */
  const cache = new Map(); // map id -> { key, h, m, shade, full, land, coast, deco }
  function terrain(map) {
    let c = cache.get(map.id);
    if (!c || c.seed !== map.seed) { c = { seed: map.seed, m: makeMoist(map.seed) }; cache.set(map.id, c); c.key = null; }
    if (!c.h || c.hkey !== map.heights) { c.h = dec(map.heights); c.hkey = map.heights; c.key = null; }
    const key = map.heights + '|' + map.sea + '|' + map.style;
    if (c.key !== key) { paintTerrain(map, c); c.key = key; }
    return c;
  }
  function sampler(g) { return (gx, gy) => { gx = Math.max(0, Math.min(GW - 1.001, gx)); gy = Math.max(0, Math.min(GH - 1.001, gy)); const x = gx | 0, y = gy | 0, fx = gx - x, fy = gy - y, i = y * GW + x; return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + GW] * (1 - fx) + g[i + GW + 1] * fx) * fy; }; }
  function paintTerrain(map, c, rect) {
    const S = STYLES[map.style] || STYLES.parchment, sea = map.sea, h = c.h, m = c.m;
    if (!c.full) { c.full = document.createElement('canvas'); c.full.width = RW; c.full.height = RH; c.land = document.createElement('canvas'); c.land.width = RW; c.land.height = RH; }
    const shade = new Float32Array(GW * GH);
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const i = y * GW + x; shade[i] = Math.max(0.72, Math.min(1.22, 1 + (-(h[i + 1] - h[i - 1]) - (h[i + GW] - h[i - GW])) * 5.5)); }
    for (let i = 0; i < GW; i++) { shade[i] = shade[i + GW] || 1; shade[(GH - 1) * GW + i] = shade[(GH - 2) * GW + i] || 1; }
    for (let y = 0; y < GH; y++) { shade[y * GW] = shade[y * GW + 1] || 1; shade[y * GW + GW - 1] = shade[y * GW + GW - 2] || 1; }
    const sh = sampler(h), sm = sampler(m), ss = sampler(shade);
    const x0 = rect ? Math.max(0, rect[0]) : 0, y0 = rect ? Math.max(0, rect[1]) : 0, x1 = rect ? Math.min(RW, rect[2]) : RW, y1 = rect ? Math.min(RH, rect[3]) : RH;
    const w = x1 - x0, hh = y1 - y0; if (w <= 0 || hh <= 0) return;
    const fctx = c.full.getContext('2d'), lctx = c.land.getContext('2d');
    const fi = fctx.createImageData(w, hh), li = lctx.createImageData(w, hh), fd = fi.data, ld = li.data;
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const gx = (px + 0.5) / RW * GW - 0.5, gy = (py + 0.5) / RH * GH - 0.5, hv = sh(gx, gy), k = ((py - y0) * w + (px - x0)) * 4;
      const grain = ((Math.sin(px * 12.9898 + py * 78.233) * 43758.5453) % 1) * 7;
      let col, isLand = hv >= sea;
      if (!isLand) { const t = Math.min(1, (sea - hv) / Math.max(0.05, sea) * 2.4); col = mix(S.shallow, S.deep, smooth(0, 1, t)); }
      else {
        const e = (hv - sea) / Math.max(0.05, 1 - sea), mv = sm(gx, gy);
        col = mix(S.sand, S.grass, smooth(0.015, 0.05, e));
        col = mix(col, S.hill, smooth(0.34, 0.46, e));
        col = mix(col, S.mount, smooth(0.58, 0.68, e));
        col = mix(col, S.snow, smooth(0.83, 0.9, e));
        col = mix(col, S.forest, smooth(0.5, 0.7, mv) * (1 - smooth(0.5, 0.62, e)) * smooth(0.03, 0.08, e));
        // Hill shading tints toward the style's own shadow and light colours (pink shadows on Rose).
        const s = ss(gx, gy); col = s < 1 ? mix(col, S.shadow, (1 - s) * 1.6 * S.shadeK) : mix(col, S.light, (s - 1) * 1.4 * S.shadeK);
      }
      fd[k] = col[0] + grain; fd[k + 1] = col[1] + grain; fd[k + 2] = col[2] + grain; fd[k + 3] = 255;
      if (isLand) { ld[k] = fd[k]; ld[k + 1] = fd[k + 1]; ld[k + 2] = fd[k + 2]; ld[k + 3] = 255; }
    }
    fctx.putImageData(fi, x0, y0); lctx.putImageData(li, x0, y0);
    c.coast = coastPath(h, sea);
    c.deco = decorations(map, c);
  }
  // Marching squares: the coastline at sea level, as one path in map units.
  function coastPath(h, sea) {
    const p = new Path2D(), pt = (x, y) => [(x + 0.5) * CELL, (y + 0.5) * CELL];
    const lerp = (a, b, va, vb) => { const t = (sea - va) / ((vb - va) || 1e-6); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW - 1; x++) {
      const i = y * GW + x, a = h[i], b = h[i + 1], c = h[i + GW + 1], d = h[i + GW];
      const idx = (a >= sea ? 8 : 0) | (b >= sea ? 4 : 0) | (c >= sea ? 2 : 0) | (d >= sea ? 1 : 0); if (idx === 0 || idx === 15) continue;
      const A = pt(x, y), B = pt(x + 1, y), C = pt(x + 1, y + 1), D = pt(x, y + 1);
      const top = () => lerp(A, B, a, b), right = () => lerp(B, C, b, c), bottom = () => lerp(D, C, d, c), left = () => lerp(A, D, a, d);
      const seg = (p1, p2) => { p.moveTo(p1[0], p1[1]); p.lineTo(p2[0], p2[1]); };
      switch (idx) {
        case 1: case 14: seg(left(), bottom()); break; case 2: case 13: seg(bottom(), right()); break;
        case 3: case 12: seg(left(), right()); break; case 4: case 11: seg(top(), right()); break;
        case 5: seg(left(), top()); seg(bottom(), right()); break; case 10: seg(top(), right()); seg(left(), bottom()); break;
        case 6: case 9: seg(top(), bottom()); break; case 7: case 8: seg(left(), top()); break;
      }
    }
    return p;
  }
  // Little hand-drawn trees, hills and mountains scattered over the land.
  function decorations(map, c) {
    const out = [], r = rng(map.seed + 31), sh = sampler(c.h), sm = sampler(c.m), sea = map.sea, step = 17;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const jx = x + (r() - 0.5) * step * 0.8, jy = y + (r() - 0.5) * step * 0.8, gx = jx / CELL - 0.5, gy = jy / CELL - 0.5, hv = sh(gx, gy);
      if (hv < sea + 0.01) continue;
      const e = (hv - sea) / Math.max(0.05, 1 - sea), mv = sm(gx, gy), roll = r();
      if (e > 0.6 && roll < 0.55) out.push({ t: e > 0.84 ? 'snow' : 'mount', x: jx, y: jy, s: 0.8 + e * 0.6 + r() * 0.25 });
      else if (e > 0.38 && e <= 0.6 && roll < 0.22) out.push({ t: 'hill', x: jx, y: jy, s: 0.9 + r() * 0.3 });
      else if (e > 0.04 && e < 0.58 && mv > 0.55 && roll < smooth(0.55, 0.75, mv) * 0.95) { out.push({ t: 'tree', x: jx, y: jy, s: 0.8 + r() * 0.35 }); if (mv > 0.68 && r() < 0.6) out.push({ t: 'tree', x: jx + 6, y: jy + 4, s: 0.75 + r() * 0.3 }); }
    }
    return out.sort((a, b) => a.y - b.y);
  }

  /* ---------- drawing ---------- */
  function drawGlyph(ctx, d, S) {
    const { x, y, s } = d; ctx.lineWidth = 1; ctx.strokeStyle = S.ink;
    if (d.t === 'tree') {
      ctx.fillStyle = S.tree; ctx.beginPath(); ctx.moveTo(x, y + 3 * s); ctx.lineTo(x, y + 6 * s); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, 3.8 * s, 4.6 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 0.8; ctx.stroke();
    } else if (d.t === 'hill') {
      ctx.beginPath(); ctx.moveTo(x - 8 * s, y + 3 * s); ctx.quadraticCurveTo(x, y - 6 * s, x + 8 * s, y + 3 * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 1 * s, y - 1.5 * s); ctx.quadraticCurveTo(x + 5 * s, y, x + 6 * s, y + 2.5 * s); ctx.globalAlpha *= 0.6; ctx.stroke(); ctx.globalAlpha /= 0.6;
    } else {
      const tx = x - 1 * s, ty = y - 11 * s;
      ctx.fillStyle = `rgb(${S.snow.map(v => v * 0.97).join(',')})`;
      ctx.beginPath(); ctx.moveTo(x - 11 * s, y + 6 * s); ctx.lineTo(tx, ty); ctx.lineTo(x + 10 * s, y + 6 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = S.ink; ctx.globalAlpha *= 0.28; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x + 10 * s, y + 6 * s); ctx.lineTo(x + 2 * s, y + 6 * s); ctx.lineTo(x + 1 * s, y - 2 * s); ctx.closePath(); ctx.fill(); ctx.globalAlpha /= 0.28;
      ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x - 11 * s, y + 6 * s); ctx.lineTo(tx, ty); ctx.lineTo(x + 10 * s, y + 6 * s); ctx.stroke();
      if (d.t === 'snow') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 4 * s, ty + 6 * s); ctx.lineTo(tx - 1 * s, ty + 4.5 * s); ctx.lineTo(tx + 1.5 * s, ty + 7 * s); ctx.lineTo(tx + 4 * s, ty + 6 * s); ctx.closePath(); ctx.fill(); }
    }
  }
  function smoothPath(ctx, pts) {
    ctx.beginPath(); if (!pts.length) return; ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  }
  function drawPath(ctx, f, S, sel) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (sel) { ctx.strokeStyle = 'rgba(214,58,131,.35)'; ctx.lineWidth = 12; smoothPath(ctx, f.pts); ctx.stroke(); }
    if (f.kind === 'river') { ctx.strokeStyle = S.river; ctx.lineWidth = 2.4; smoothPath(ctx, f.pts); ctx.stroke(); }
    else if (f.kind === 'road') { ctx.strokeStyle = S.road; ctx.lineWidth = 1.8; ctx.setLineDash([7, 5]); smoothPath(ctx, f.pts); ctx.stroke(); }
    else { ctx.strokeStyle = S.border; ctx.globalAlpha = 0.18; ctx.lineWidth = 9; smoothPath(ctx, f.pts); ctx.stroke(); ctx.globalAlpha = 0.9; ctx.lineWidth = 1.8; ctx.setLineDash([2, 5, 9, 5]); smoothPath(ctx, f.pts); ctx.stroke(); }
    ctx.restore();
  }
  function drawPin(ctx, f, S, sel) {
    const { x, y } = f; ctx.save(); ctx.lineWidth = 1.4; ctx.strokeStyle = S.ink; ctx.fillStyle = S.ink;
    if (sel) { ctx.fillStyle = 'rgba(214,58,131,.3)'; ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = S.ink; }
    const paper = S.card;
    switch (f.kind) {
      case 'city': ctx.fillStyle = paper; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = S.ink; ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fill(); break;
      case 'town': ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); break;
      case 'castle': ctx.fillStyle = paper; ctx.beginPath(); ctx.rect(x - 7, y - 4, 14, 9); ctx.fill(); ctx.stroke(); ctx.beginPath(); for (const cx of [-7, -2, 3]) ctx.rect(x + cx, y - 8, 4, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = S.ink; ctx.fillRect(x - 1.5, y, 3, 5); break;
      case 'tower': ctx.fillStyle = paper; ctx.beginPath(); ctx.rect(x - 3, y - 6, 6, 12); ctx.fill(); ctx.stroke(); ctx.fillStyle = S.ink; ctx.beginPath(); ctx.moveTo(x - 5, y - 6); ctx.lineTo(x, y - 13); ctx.lineTo(x + 5, y - 6); ctx.closePath(); ctx.fill(); break;
      case 'ruin': ctx.lineWidth = 2; for (const [dx, hgt] of [[-5, 9], [0, 5], [5, 7]]) { ctx.beginPath(); ctx.moveTo(x + dx, y + 5); ctx.lineTo(x + dx, y + 5 - hgt); ctx.stroke(); } ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 8, y + 5.5); ctx.lineTo(x + 8, y + 5.5); ctx.stroke(); break;
      case 'cave': ctx.fillStyle = paper; ctx.beginPath(); ctx.moveTo(x - 8, y + 5); ctx.quadraticCurveTo(x, y - 12, x + 8, y + 5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = S.ink; ctx.beginPath(); ctx.moveTo(x - 3.5, y + 5); ctx.quadraticCurveTo(x, y - 3, x + 3.5, y + 5); ctx.fill(); break;
      case 'temple': ctx.fillStyle = paper; ctx.beginPath(); ctx.rect(x - 6, y - 2, 12, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 8, y - 2); ctx.lineTo(x, y - 9); ctx.lineTo(x + 8, y - 2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 3, y - 2); ctx.lineTo(x - 3, y + 5); ctx.moveTo(x + 3, y - 2); ctx.lineTo(x + 3, y + 5); ctx.stroke(); break;
      case 'port': ctx.beginPath(); ctx.arc(x, y - 6, 2.2, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 6); ctx.moveTo(x - 4, y - 1); ctx.lineTo(x + 4, y - 1); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y + 1, 6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); break;
      default: ctx.fillStyle = S.border; ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 - Math.PI / 2, rr = k % 2 ? 3 : 9; ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.8; ctx.stroke();
    }
    if (f.name) {
      const big = f.kind === 'city' || f.kind === 'castle';
      ctx.font = `${big ? '600 ' : ''}${big ? 15 : 13}px Cinzel, Georgia, serif`; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = S.card; ctx.lineJoin = 'round'; ctx.strokeText(f.name, x + 11, y + 1); ctx.fillStyle = S.label; ctx.fillText(f.name, x + 11, y + 1);
      if (f.link && findByTitle(f.link)) { const w = ctx.measureText(f.name).width; ctx.fillStyle = S.border; ctx.beginPath(); ctx.arc(x + 14 + w, y - 4, 2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
  function labelFont(f) { return f.kind === 'sea' ? `italic ${f.size}px Lora, Georgia, serif` : f.kind === 'region' ? `600 ${f.size}px Cinzel, Georgia, serif` : `${f.size}px Cinzel, Georgia, serif`; }
  function labelText(f) { const t = String(f.text == null ? '' : f.text); return f.kind === 'region' ? t.toUpperCase().split('').join(' ') : t; }
  function drawLabel(ctx, f, S, sel) {
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate((f.rot || 0) * Math.PI / 180);
    ctx.font = labelFont(f); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const t = labelText(f);
    if (sel) { const w = ctx.measureText(t).width; ctx.fillStyle = 'rgba(214,58,131,.22)'; ctx.fillRect(-w / 2 - 6, -f.size * 0.75, w + 12, f.size * 1.5); }
    ctx.globalAlpha = f.kind === 'sea' ? 0.75 : 0.92; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = S.card; ctx.strokeText(t, 0, 0);
    ctx.fillStyle = f.kind === 'sea' ? S.river : S.label; ctx.fillText(t, 0, 0); ctx.restore();
  }
  function drawCompass(ctx, S) {
    const x = W - 95, y = H - 105, R = 44; ctx.save(); ctx.translate(x, y); ctx.strokeStyle = S.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, R * 0.56, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4 - Math.PI / 2, long = k % 2 === 0, rr = long ? R : R * 0.55, w = long ? 7 : 5;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); ctx.lineTo(Math.cos(a + side * Math.PI / 2) * w, Math.sin(a + side * Math.PI / 2) * w); ctx.closePath(); ctx.fillStyle = side > 0 ? S.ink : S.card; ctx.fill(); ctx.stroke(); }
    }
    ctx.font = '600 15px Cinzel, Georgia, serif'; ctx.fillStyle = S.ink; ctx.textAlign = 'center'; ctx.fillText('N', 0, -R - 8); ctx.restore();
  }
  function drawTitle(ctx, map, S) {
    ctx.save(); ctx.font = '700 30px Cinzel, Georgia, serif'; const w = Math.min(560, ctx.measureText(map.name).width + 60);
    const x = 46, y = 40; ctx.fillStyle = S.card; ctx.strokeStyle = S.frame; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 14, y); ctx.lineTo(x + w - 14, y); ctx.lineTo(x + w, y + 30); ctx.lineTo(x + w - 14, y + 60); ctx.lineTo(x + 14, y + 60); ctx.lineTo(x, y + 30); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = S.label; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(map.name, x + w / 2, y + 31, w - 36); ctx.restore();
  }
  function drawFrame(ctx, S) {
    ctx.save(); ctx.strokeStyle = S.frame; ctx.lineWidth = 6; ctx.strokeRect(10, 10, W - 20, H - 20); ctx.lineWidth = 1.2; ctx.strokeRect(22, 22, W - 44, H - 44);
    ctx.fillStyle = S.frame; for (const [x, y] of [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]]) { ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? 3 : 9; ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  function drawGrid(ctx, S) { ctx.save(); ctx.strokeStyle = S.ink; ctx.globalAlpha = 0.12; ctx.lineWidth = 1; for (let x = 100; x < W; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 100; y < H; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.restore(); }

  // Draw the whole map in map units onto ctx (already transformed by the caller).
  function compose(ctx, map, opts = {}) {
    const S = STYLES[map.style] || STYLES.parchment, c = terrain(map), show = map.show || {};
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c.full, 0, 0, W, H);
    if (map.sea > 0.02) { // ripple lines along the coast, then land on top
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const sh = `rgb(${S.shallow.join(',')})`;
      for (const [wid, a] of [[30, 0.25], [17, 0.4]]) { ctx.globalAlpha = a; ctx.strokeStyle = S.ink; ctx.lineWidth = wid + 1.6; ctx.stroke(c.coast); ctx.globalAlpha = 1; ctx.strokeStyle = sh; ctx.lineWidth = wid; ctx.stroke(c.coast); }
      ctx.restore();
      ctx.drawImage(c.land, 0, 0, W, H);
      ctx.save(); ctx.strokeStyle = S.ink; ctx.lineWidth = 1.9; ctx.lineJoin = 'round'; ctx.stroke(c.coast); ctx.restore();
    }
    if (show.grid) drawGrid(ctx, S);
    const feats = map.features || [];
    for (const f of feats) if (f.type === 'path' && f.kind !== 'river') drawPath(ctx, f, S, opts.sel === f.id);
    for (const f of feats) if (f.type === 'path' && f.kind === 'river') drawPath(ctx, f, S, opts.sel === f.id);
    if (show.symbols !== false) { ctx.save(); for (const d of c.deco) drawGlyph(ctx, d, S); ctx.restore(); }
    for (const f of feats) if (f.type === 'label') drawLabel(ctx, f, S, opts.sel === f.id);
    for (const f of feats) if (f.type === 'pin') drawPin(ctx, f, S, opts.sel === f.id);
    if (show.compass !== false) drawCompass(ctx, S);
    if (show.title !== false) drawTitle(ctx, map, S);
    if (show.frame !== false) drawFrame(ctx, S);
  }
  // A picture of the map (for Save picture and the folder backup).
  function png(map, scale = 2) {
    const cv = document.createElement('canvas'); cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale); compose(ctx, map);
    return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  }

  /* ---------- editor ---------- */
  const E = { map: null, tool: 'select', pinKind: 'town', brush: 60, sel: null, scale: 1, ox: 0, oy: 0, undo: [], redo: [], raf: 0, dirty: true, ptrs: new Map(), drag: null, draft: null, hover: null };
  const P_ = () => P();
  const list = () => { const p = P_(); p.maps = p.maps || {}; p.mapOrder = (p.mapOrder || []).filter(id => p.maps[id]); Object.keys(p.maps).forEach(id => { if (!p.mapOrder.includes(id)) p.mapOrder.push(id); }); return p.mapOrder.map(id => p.maps[id]); };
  const current = () => { const p = P_(), maps = list(); let m = p.maps[p.currentMap]; if (!m && maps.length) { m = maps[0]; p.currentMap = m.id; } return m || null; };
  const TOOLS = [['select', '➚', 'Select & move'], ['pan', '✋', 'Move around the map'], ['raise', '⛰', 'Raise land'], ['lower', '≋', 'Sink land into sea'], ['pin', '⌂', 'Add a place'], ['river', '〰', 'Draw a river'], ['road', '┅', 'Draw a road'], ['border', '⫶', 'Draw a border'], ['label', 'Aa', 'Add a name'], ['erase', '⌫', 'Erase']];

  function render(main) {
    const p = P_(), maps = list(), m = current();
    if (E.raf) { cancelAnimationFrame(E.raf); E.raf = 0; }
    if (!m) {
      main.innerHTML = `<div class="map-empty"><div class="map-empty-card"><div class="me-ico">🗺</div><h2>Draw your world</h2><p>Rosequill can dream up a whole land for you, with coasts, mountains, forests, rivers and named towns. Then you shape it, name it and link its places to your lore.</p><button class="primary" id="mNew">✦ Create a map</button></div></div>`;
      $('#mNew').onclick = newMapModal; return;
    }
    E.map = m; if (!E.sel || !(m.features || []).some(f => f.id === E.sel)) E.sel = null;
    // A re-render can replace the canvas mid-gesture, so its pointer-up is never seen: start clean.
    E.ptrs.clear(); E.drag = null; E.draft = null; E.pinch = null; E.pending = null;
    main.innerHTML = `<div class="map-wrap">
      <div class="map-top">
        <select id="mSel" aria-label="Choose a map">${maps.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <button class="mbtn" id="mNew" title="Create a new map">+ New</button>
        <span class="mspace"></span>
        <button class="mbtn" id="mUndo" title="Undo (Ctrl+Z)" ${E.undo.length ? '' : 'disabled'}>↶</button>
        <button class="mbtn" id="mRedo" title="Redo (Ctrl+Y)" ${E.redo.length ? '' : 'disabled'}>↷</button>
        <button class="mbtn" id="mFit" title="Show the whole map">⤢</button>
        <button class="mbtn" id="mPng" title="Save the map as a picture">⇩ Picture</button>
        <button class="mbtn" id="mMore" title="Map settings">⋯</button>
      </div>
      <div class="map-body">
        <div class="map-tools" role="toolbar" aria-label="Map tools">
          ${TOOLS.map(([k, ic, t]) => `<button data-tool="${k}" class="${E.tool === k ? 'on' : ''}" title="${t}" aria-label="${t}"><span>${ic}</span></button>`).join('')}
          <div class="map-opt" id="mOpt"></div>
        </div>
        <div class="map-stage" id="mStage"><canvas id="mCv" aria-label="Map of ${esc(m.name)}"></canvas>
          <div class="map-props" id="mProps" hidden></div>
          <div class="map-hint" id="mHint"></div></div>
      </div></div>`;
    $('#mSel').onchange = e => { p.currentMap = e.target.value; E.undo = []; E.redo = []; E.sel = null; save(); render(main); };
    $('#mNew').onclick = newMapModal;
    $('#mUndo').onclick = undo; $('#mRedo').onclick = redo; $('#mFit').onclick = () => { fit(); };
    $('#mPng').onclick = async () => { toast('Painting your map…'); const b = await png(m, 2); download(safeName(m.name) + '.png', b, 'image/png'); toast('⇩ Map saved as a picture'); };
    $('#mMore').onclick = e => moreMenu(e.currentTarget);
    $$('.map-tools [data-tool]').forEach(b => b.onclick = () => { E.tool = b.dataset.tool; $$('.map-tools [data-tool]').forEach(x => x.classList.toggle('on', x === b)); drawOpt(); hint(); E.dirty = true; });
    drawOpt(); hint(); stage(); drawProps();
  }
  function hint() {
    const h = { select: 'Tap a place, name or line to edit it. Drag to move it. Drag empty space to look around.', pan: 'Drag to look around. Scroll or pinch to zoom.', raise: 'Paint to raise land. Go over it again for hills and mountains.', lower: 'Paint to lower land, down into lakes and sea.', pin: 'Tap the map to add a place.', river: 'Draw a river from its source down to the sea.', road: 'Draw a road between places.', border: 'Draw a border around a land.', label: 'Tap the map to add a name.', erase: 'Tap a place, name or line to remove it.' }[E.tool];
    const el = $('#mHint'); if (el) el.textContent = h;
  }
  function drawOpt() {
    const o = $('#mOpt'); if (!o) return;
    if (E.tool === 'raise' || E.tool === 'lower') o.innerHTML = `<label title="Brush size">◯ <input type="range" id="mBrush" min="20" max="200" value="${E.brush}" aria-label="Brush size"></label>`;
    else if (E.tool === 'pin') o.innerHTML = `<select id="mPinKind" aria-label="Kind of place">${Object.entries(PINS).map(([k, l]) => `<option value="${k}" ${k === E.pinKind ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    else o.innerHTML = '';
    const b = $('#mBrush'); if (b) b.oninput = () => { E.brush = +b.value; };
    const k = $('#mPinKind'); if (k) k.onchange = () => { E.pinKind = k.value; };
  }
  function moreMenu(btn) {
    const m = E.map, r = btn.getBoundingClientRect(), s = m.show;
    const tog = (key, label) => ({ label: (s[key] !== false ? '☑ ' : '☐ ') + label, act: () => { pushUndo(); s[key] = !(s[key] !== false); changed(); moreMenu(btn); } });
    showMenu(r.right - 220, r.bottom + 6, [
      { h: 'Style' }, ...Object.entries(STYLES).map(([k, v]) => ({ label: v.name, cur: m.style === k, act: () => { pushUndo(); m.style = k; changed(); } })),
      { h: 'Show' }, tog('symbols', 'Trees & mountains'), tog('compass', 'Compass'), tog('title', 'Title'), tog('frame', 'Frame'), { label: (s.grid ? '☑ ' : '☐ ') + 'Grid', act: () => { pushUndo(); s.grid = !s.grid; changed(); moreMenu(btn); } },
      { sep: 1 },
      { label: 'Sea level…', act: seaModal },
      { label: 'Rename map…', act: async () => { const n = await ask('Rename map', m.name); if (n == null) return; pushUndo(); m.name = n.trim() || m.name; changed(); renderMain(); } },
      { label: '✦ Add more names & places', act: () => {
        const h = terrain(m).h, old = m.features.filter(f => f.type === 'pin');
        // Only keep new places that are well clear of every place already on the map.
        const fresh = makePlaces(h, m.sea, m.features.filter(f => f.kind === 'river'), rng(Date.now() & 0xffffff), m.shape || 'continent')
          .filter(f => f.type === 'pin' && !old.some(o => Math.hypot(o.x - f.x, o.y - f.y) < 90)).slice(0, 5);
        if (!fresh.length) return toast('There is no open space left for new places. Try raising more land.');
        pushUndo(); m.features.push(...fresh); changed(); toast(`✦ Added ${fresh.length} new place${fresh.length > 1 ? 's' : ''}`);
      } },
      { label: 'Delete this map', danger: true, act: async () => { if (!await confirmBox(`Delete the map “${esc(m.name)}”? This can't be undone, but the Backups window can restore older versions of the grimoire.`, 'Delete map', true)) return; const p = P_(); delete p.maps[m.id]; p.mapOrder = p.mapOrder.filter(x => x !== m.id); p.currentMap = p.mapOrder[0] || null; cache.delete(m.id); E.undo = []; E.redo = []; save(); renderMain(); } },
    ]);
  }
  function seaModal() {
    const m = E.map;
    openModal(`<h3>Sea level</h3><p class="muted" style="font-size:.85rem">Raise the sea to drown the lowlands, or lower it to reveal more land.</p>
      <input type="range" id="mSea" min="0.2" max="0.8" step="0.01" value="${m.sea}" style="width:100%;accent-color:var(--rose)" aria-label="Sea level">
      <div class="m-act"><button class="primary" data-x>Done</button></div>`);
    let pushed = false; // an undo step only once she actually moves the slider
    $('#mSea').oninput = e => { if (!pushed) { pushUndo(); pushed = true; } m.sea = +e.target.value; E.dirty = true; };
    $('#mSea').onchange = () => changed();
  }

  /* ---- canvas stage ---- */
  function stage() {
    const cv = $('#mCv'), wrap = $('#mStage'), ctx = cv.getContext('2d');
    const size = () => { const r = wrap.getBoundingClientRect(), d = devicePixelRatio || 1; cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; E.cw = r.width; E.ch = r.height; E.dpr = d; if (!E.fitted || E.fitted !== E.map.id) fit(); E.dirty = true; };
    const ro = new ResizeObserver(size); ro.observe(wrap); size();
    const loop = () => {
      if (!cv.isConnected) { ro.disconnect(); return; }
      if (E.dirty) { E.dirty = false; draw(ctx); }
      E.raf = requestAnimationFrame(loop);
    };
    loop();
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    cv.addEventListener('pointerleave', () => { E.hover = null; E.dirty = true; });
    cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(local(e), Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener('dblclick', e => { const hit = hitTest(world(local(e))); if (hit && hit.type === 'pin' && hit.link) openLink(hit.link); });
  }
  function fit() {
    if (!E.cw) return;
    E.scale = Math.min(E.cw / W, E.ch / H) * 0.98; E.ox = (E.cw - W * E.scale) / 2; E.oy = (E.ch - H * E.scale) / 2; E.fitted = E.map.id;
    if (E.focus) { E.scale = Math.max(E.scale, 1.2); E.ox = E.cw / 2 - E.focus.x * E.scale; E.oy = E.ch / 2 - E.focus.y * E.scale; E.focus = null; }
    E.dirty = true;
  }
  const local = e => { const r = $('#mCv').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const world = pt => ({ x: (pt.x - E.ox) / E.scale, y: (pt.y - E.oy) / E.scale });
  function zoomAt(pt, k) { const w = world(pt); E.scale = Math.max(0.15, Math.min(6, E.scale * k)); E.ox = pt.x - w.x * E.scale; E.oy = pt.y - w.y * E.scale; E.dirty = true; }
  function draw(ctx) {
    const d = E.dpr || 1; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, E.cw, E.ch);
    ctx.save(); ctx.translate(E.ox, E.oy); ctx.scale(E.scale, E.scale);
    ctx.shadowColor = 'rgba(80,20,60,.25)'; ctx.shadowBlur = 18; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.shadowBlur = 0;
    compose(ctx, E.map, { sel: E.sel });
    if (E.draft) drawPath(ctx, E.draft, STYLES[E.map.style] || STYLES.parchment, false);
    if (E.hover && (E.tool === 'raise' || E.tool === 'lower')) { ctx.strokeStyle = E.tool === 'raise' ? 'rgba(122,31,79,.7)' : 'rgba(40,90,120,.7)'; ctx.lineWidth = 1.5 / E.scale; ctx.setLineDash([6 / E.scale, 4 / E.scale]); ctx.beginPath(); ctx.arc(E.hover.x, E.hover.y, E.brush, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
  }
  function hitTest(w) {
    const feats = E.map.features || [], tol = 10 / Math.min(1.5, E.scale);
    for (let i = feats.length - 1; i >= 0; i--) { const f = feats[i]; if (f.type === 'pin' && Math.hypot(f.x - w.x, f.y - w.y) < 12 + tol) return f; }
    const ctx = $('#mCv').getContext('2d');
    for (let i = feats.length - 1; i >= 0; i--) {
      const f = feats[i]; if (f.type !== 'label') continue;
      ctx.save(); ctx.font = labelFont(f); const tw = ctx.measureText(labelText(f)).width; ctx.restore();
      const a = -(f.rot || 0) * Math.PI / 180, dx = w.x - f.x, dy = w.y - f.y, rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) < tw / 2 + 6 && Math.abs(ry) < f.size * 0.75) return f;
    }
    for (let i = feats.length - 1; i >= 0; i--) {
      const f = feats[i]; if (f.type !== 'path') continue;
      for (let k = 1; k < f.pts.length; k++) { if (segDist(w, f.pts[k - 1], f.pts[k]) < 6 + tol) return f; }
    }
    return null;
  }
  function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1; let t = ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy)); }

  function down(e) {
    const cv = $('#mCv'); try { cv.setPointerCapture(e.pointerId); } catch { } // capture is a nicety; never let it stop a tap
    const pt = local(e); E.ptrs.set(e.pointerId, pt);
    if (E.ptrs.size === 2) { const [a, b] = [...E.ptrs.values()]; E.pinch = Math.hypot(a.x - b.x, a.y - b.y); E.drag = null; E.draft = null; return; }
    const w = world(pt), t = E.tool;
    if (t === 'pan' || e.button === 1) { E.drag = { mode: 'pan', sx: pt.x, sy: pt.y, ox: E.ox, oy: E.oy }; return; }
    if (t === 'select') {
      const hit = hitTest(w);
      if (hit) { E.sel = hit.id; drawProps(); if (hit.type !== 'path') { pushUndo(); E.drag = { mode: 'move', f: hit, dx: hit.x - w.x, dy: hit.y - w.y, moved: false }; } }
      else { E.sel = null; drawProps(); E.drag = { mode: 'pan', sx: pt.x, sy: pt.y, ox: E.ox, oy: E.oy }; }
      E.dirty = true; return;
    }
    if (t === 'erase') { const hit = hitTest(w); if (hit) { pushUndo(); E.map.features = E.map.features.filter(f => f !== hit); if (E.sel === hit.id) E.sel = null; changed(); drawProps(); } return; }
    if (t === 'raise' || t === 'lower') { pushUndo(); E.drag = { mode: 'brush' }; brushAt(w, t === 'raise' ? 1 : -1); return; }
    if (t === 'pin') { pushUndo(); const f = { id: fid(), type: 'pin', kind: E.pinKind, x: Math.round(w.x), y: Math.round(w.y), name: placeName(rng(Date.now() & 0xffffff)), link: '' }; E.map.features.push(f); E.sel = f.id; changed(); drawProps(true); return; }
    if (t === 'label') { pushUndo(); const f = { id: fid(), type: 'label', kind: 'place', x: Math.round(w.x), y: Math.round(w.y), text: 'New name', size: 20, rot: 0 }; E.map.features.push(f); E.sel = f.id; E.tool = 'select'; render($('#main')); drawProps(true); changed(); return; }
    if (PATHS[t]) { E.draft = { id: fid(), type: 'path', kind: t, pts: [[Math.round(w.x), Math.round(w.y)]] }; E.drag = { mode: 'draw' }; E.dirty = true; }
  }
  function move(e) {
    const pt = local(e); if (E.ptrs.has(e.pointerId)) E.ptrs.set(e.pointerId, pt);
    if (E.pinch && E.ptrs.size === 2) { const [a, b] = [...E.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d / E.pinch); E.pinch = d; return; }
    const w = world(pt);
    if (E.tool === 'raise' || E.tool === 'lower') { E.hover = w; E.dirty = true; }
    if (!E.drag) { const cv = $('#mCv'); const hit = (E.tool === 'select' || E.tool === 'erase') ? hitTest(w) : null; cv.style.cursor = hit ? (E.tool === 'erase' ? 'not-allowed' : 'move') : E.tool === 'pan' || E.tool === 'select' ? 'grab' : 'crosshair'; return; }
    if (E.drag.mode === 'pan') { E.ox = E.drag.ox + pt.x - E.drag.sx; E.oy = E.drag.oy + pt.y - E.drag.sy; E.dirty = true; }
    else if (E.drag.mode === 'move') { E.drag.f.x = Math.round(w.x + E.drag.dx); E.drag.f.y = Math.round(w.y + E.drag.dy); E.drag.moved = true; E.dirty = true; }
    else if (E.drag.mode === 'brush') brushAt(w, E.tool === 'raise' ? 1 : -1);
    else if (E.drag.mode === 'draw') { const last = E.draft.pts[E.draft.pts.length - 1]; if (Math.hypot(last[0] - w.x, last[1] - w.y) > 7 / Math.min(1, E.scale)) { E.draft.pts.push([Math.round(w.x), Math.round(w.y)]); E.dirty = true; } }
  }
  function up(e) {
    E.ptrs.delete(e.pointerId); if (E.ptrs.size < 2) E.pinch = null;
    const d = E.drag; E.drag = null; if (!d) return;
    if (d.mode === 'move') { if (d.moved) changed(); else E.undo.pop(); drawProps(); }
    if (d.mode === 'brush') { const c = cache.get(E.map.id); E.map.heights = enc(c.h); c.hkey = E.map.heights; c.key = null; changed(); }
    if (d.mode === 'draw') { if (E.draft.pts.length > 1) { pushUndo(); E.map.features.push(E.draft); E.sel = E.draft.id; changed(); drawProps(); } E.draft = null; E.dirty = true; }
  }
  let brushT = 0;
  function brushAt(w, dir) {
    const c = terrain(E.map), h = c.h, R = E.brush / CELL, cx = w.x / CELL - 0.5, cy = w.y / CELL - 0.5;
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(GH - 1, Math.ceil(cy + R)); y++)
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(GW - 1, Math.ceil(cx + R)); x++) {
        const dd = Math.hypot(x - cx, y - cy) / R; if (dd >= 1) continue;
        const i = y * GW + x, k = (1 - dd) * (1 - dd) * 0.035;
        h[i] = Math.max(0, Math.min(1, h[i] + dir * k));
        if (dir > 0 && h[i] < E.map.sea + 0.01 && h[i] + 0.02 > E.map.sea) h[i] = E.map.sea + 0.012; // pop land just above the waterline
      }
    // repaint only the brushed area, at most once a frame
    const px = w.x / W * RW, py = w.y / H * RH, rr = E.brush / W * RW + 4;
    E.pending = E.pending ? [Math.min(E.pending[0], px - rr), Math.min(E.pending[1], py - rr), Math.max(E.pending[2], px + rr), Math.max(E.pending[3], py + rr)] : [px - rr, py - rr, px + rr, py + rr];
    if (!brushT) brushT = requestAnimationFrame(() => { brushT = 0; const r = E.pending.map(Math.round); E.pending = null; paintTerrain(E.map, c, r); c.key = E.map.heights + '|' + E.map.sea + '|' + E.map.style; E.dirty = true; });
  }

  /* ---- properties of the selected thing ---- */
  function drawProps(focus) {
    const box = $('#mProps'); if (!box) return;
    const f = (E.map.features || []).find(x => x.id === E.sel);
    if (!f) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const titles = docs().filter(d => !inTrash(d.id)).map(d => d.title);
    if (f.type === 'pin') {
      const linked = f.link && findByTitle(f.link);
      box.innerHTML = `<div class="mp-head">${esc(PINS[f.kind] || 'Place')}</div>
        <label>Name<input id="mpName" value="${esc(f.name)}" autocomplete="off"></label>
        <label>Kind<select id="mpKind">${Object.entries(PINS).map(([k, l]) => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Linked page<input id="mpLink" list="mpTitles" value="${esc(f.link || '')}" placeholder="e.g. ${esc(titles[0] || 'The Thornwood')}" autocomplete="off"></label>
        <datalist id="mpTitles">${titles.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="mp-act">${f.link ? `<button class="mini" id="mpOpen">${linked ? 'Open page' : '✦ Create page'}</button>` : `<button class="mini" id="mpMake">✦ Make a lore page</button>`}<button class="mini" id="mpDice" title="Suggest another name">🎲 Name</button><button class="mini danger" id="mpDel">Delete</button></div>`;
    } else if (f.type === 'label') {
      box.innerHTML = `<div class="mp-head">Name on the map</div>
        <label>Text<input id="mpText" value="${esc(f.text)}" autocomplete="off"></label>
        <label>Kind<select id="mpLKind">${[['region', 'Land / region'], ['sea', 'Sea / water'], ['place', 'Other']].map(([k, l]) => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Size<input type="range" id="mpSize" min="10" max="60" value="${f.size}"></label>
        <label>Tilt<input type="range" id="mpRot" min="-45" max="45" value="${f.rot || 0}"></label>
        <div class="mp-act"><button class="mini" id="mpDice" title="Suggest another name">🎲 Name</button><button class="mini danger" id="mpDel">Delete</button></div>`;
    } else {
      box.innerHTML = `<div class="mp-head">${esc(PATHS[f.kind])}</div>
        <label>Kind<select id="mpPKind">${Object.entries(PATHS).map(([k, l]) => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="mp-act"><button class="mini danger" id="mpDel">Delete</button></div>`;
    }
    const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    let typed = false; const once = () => { if (!typed) { typed = true; pushUndo(); } };
    on('mpName', 'input', e => { once(); f.name = e.target.value; changed(true); });
    on('mpText', 'input', e => { once(); f.text = e.target.value; changed(true); });
    on('mpKind', 'change', e => { pushUndo(); f.kind = e.target.value; changed(); drawProps(); });
    on('mpLKind', 'change', e => { pushUndo(); f.kind = e.target.value; changed(); });
    on('mpPKind', 'change', e => { pushUndo(); f.kind = e.target.value; changed(); drawProps(); });
    on('mpSize', 'input', e => { once(); f.size = +e.target.value; changed(true); });
    on('mpRot', 'input', e => { once(); f.rot = +e.target.value; changed(true); });
    on('mpLink', 'change', e => { pushUndo(); f.link = e.target.value.trim(); changed(); drawProps(); });
    on('mpOpen', 'click', () => openLink(f.link));
    on('mpMake', 'click', () => {
      pushUndo();
      // Link to the page that actually exists afterwards: a new page may get " 2" added if a page with
      // this name sits in the Trash, so the link must use the created page's real title.
      const existing = findByTitle(f.name);
      const page = existing || createDoc(P_().roots.lore, f.name, TEMPLATES.Place || '', null, true);
      f.link = page.title; changed(); renderBinder();
      toast(existing ? `✦ Linked to “${page.title}”` : `✦ “${page.title}” now has its own Lore page`); drawProps();
    });
    on('mpDice', 'click', () => { pushUndo(); const r = rng(Date.now() & 0xffffff); if (f.type === 'pin') f.name = placeName(r); else f.text = f.kind === 'sea' ? seaName(r) : f.kind === 'region' ? regionName(r) : placeName(r); changed(); drawProps(); });
    on('mpDel', 'click', () => { pushUndo(); E.map.features = E.map.features.filter(x => x !== f); E.sel = null; changed(); drawProps(); });
    if (focus) { const i = $('#mpName') || $('#mpText'); if (i) { i.focus(); i.select(); } }
  }

  /* ---- undo, saving ---- */
  const snap = () => JSON.stringify({ heights: E.map.heights, sea: E.map.sea, style: E.map.style, name: E.map.name, show: E.map.show, features: E.map.features });
  function pushUndo() { E.undo.push(snap()); if (E.undo.length > 40) E.undo.shift(); E.redo = []; uiUndo(); }
  function apply(s) { Object.assign(E.map, JSON.parse(s)); changed(); drawProps(); }
  function undo() { if (!E.undo.length) return; E.redo.push(snap()); apply(E.undo.pop()); uiUndo(); }
  function redo() { if (!E.redo.length) return; E.undo.push(snap()); apply(E.redo.pop()); uiUndo(); }
  function uiUndo() { const u = $('#mUndo'), r = $('#mRedo'); if (u) u.disabled = !E.undo.length; if (r) r.disabled = !E.redo.length; }
  const saveSoon = debounce(() => save(), 400);
  function changed(soft) { if (!E.map) return; E.map.modified = Date.now(); E.dirty = true; uiUndo(); soft ? saveSoon() : save(); }

  /* ---- new map window with a live preview ---- */
  function newMapModal() {
    const o = { name: '', shape: 'continent', style: 'parchment', seed: Math.floor(Math.random() * 1e9), rivers: true, places: true };
    openModal(`<h3>Create a map</h3>
      <div class="nm-grid"><div>
        <label class="f" for="nmName">Name</label><input class="m-field" id="nmName" placeholder="The Realm of…" autocomplete="off">
        <label class="f">Shape of the land</label><div class="nm-choice" id="nmShape">${Object.entries(SHAPES).map(([k, [l]]) => `<button type="button" data-v="${k}" class="${k === o.shape ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="f">Style</label><div class="nm-choice" id="nmStyle">${Object.entries(STYLES).map(([k, v]) => `<button type="button" data-v="${k}" class="${k === o.style ? 'on' : ''}">${v.name}</button>`).join('')}</div>
        <label class="chkl"><input type="checkbox" id="nmRivers" checked> Rivers</label>
        <label class="chkl"><input type="checkbox" id="nmPlaces" checked> Towns, castles and names</label>
      </div><div>
        <canvas id="nmPrev" width="320" height="200" aria-label="Preview of the new map"></canvas>
        <button type="button" class="ghost nm-dice" id="nmDice">🎲 Another world</button>
      </div></div>
      <div class="m-act"><button class="ghost" data-x>Cancel</button><button class="primary" id="nmGo">✦ Create map</button></div>`, 'wide');
    const prev = () => {
      const cv = $('#nmPrev'); if (!cv) return; const ctx = cv.getContext('2d'), h = makeHeights(o.seed, o.shape), S = STYLES[o.style], img = ctx.createImageData(GW, GH);
      for (let i = 0; i < h.length; i++) { const v = h[i], e = (v - 0.5) / 0.5, col = v < 0.5 ? mix(S.shallow, S.deep, Math.min(1, (0.5 - v) * 4)) : mix(mix(mix(S.sand, S.grass, smooth(0.015, 0.05, e)), S.hill, smooth(0.34, 0.46, e)), S.mount, smooth(0.58, 0.7, e)); img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255; }
      const tmp = document.createElement('canvas'); tmp.width = GW; tmp.height = GH; tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
    };
    const choose = (id, key) => $('#' + id).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; o[key] = b.dataset.v; $$('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b)); prev(); });
    choose('nmShape', 'shape'); choose('nmStyle', 'style');
    $('#nmDice').onclick = () => { o.seed = Math.floor(Math.random() * 1e9); prev(); };
    $('#nmGo').onclick = () => {
      o.rivers = $('#nmRivers').checked; o.places = $('#nmPlaces').checked;
      o.name = $('#nmName').value.trim() || regionName(rng(o.seed)).replace(/^The /, 'The ');
      const m = generate(o), p = P_(); p.maps = p.maps || {}; p.mapOrder = p.mapOrder || [];
      p.maps[m.id] = m; p.mapOrder.push(m.id); p.currentMap = m.id; p.view = 'maps'; E.undo = []; E.redo = []; E.sel = null; E.fitted = null;
      closeModal(); save(); render$(); toast(`✦ “${m.name}” is ready. Tap a place to name it or link it to your lore`, 6000);
    };
    prev();
  }
  const render$ = () => { renderHeader(); renderMain(); };

  /* ---- keyboard ---- */
  document.addEventListener('keydown', e => {
    if (!E.map || P_().view !== 'maps' || !$('#mCv') || !$('#modal').hidden) return;
    const typing = /input|select|textarea/i.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && E.sel) { e.preventDefault(); pushUndo(); E.map.features = E.map.features.filter(f => f.id !== E.sel); E.sel = null; changed(); drawProps(); }
    if (e.key === 'Escape' && E.sel && !typing) { E.sel = null; drawProps(); E.dirty = true; }
  });

  /* ---- used by the rest of the app ---- */
  function pinsLinkedTo(title) { const p = P_(), t = String(title).trim().toLowerCase(), out = []; for (const m of Object.values(p.maps || {})) for (const f of m.features || []) if (f.type === 'pin' && (f.link || '').trim().toLowerCase() === t) out.push({ map: m, pin: f }); return out; }
  function showPin(mapId, pinId) {
    const p = P_(), m = p.maps[mapId], pin = m && (m.features || []).find(f => f.id === pinId);
    p.currentMap = mapId; p.view = 'maps'; E.sel = pinId; E.undo = []; E.redo = [];
    E.focus = pin ? { x: pin.x, y: pin.y } : null; E.fitted = null; // centre and zoom in on the place once the stage has its size
    save(); render$();
  }
  function renameLinks(oldT, newT) { const p = P_(), o = String(oldT).trim().toLowerCase(); let n = 0; for (const m of Object.values(p.maps || {})) for (const f of m.features || []) if (f.type === 'pin' && (f.link || '').trim().toLowerCase() === o) { f.link = newT; n++; } return n; }
  function normalize(p) {
    p.maps = p.maps && typeof p.maps === 'object' ? p.maps : {};
    for (const [k, m] of Object.entries(p.maps)) {
      if (!m || typeof m !== 'object' || typeof m.heights !== 'string') { delete p.maps[k]; continue; }
      m.id = k; m.name = String(m.name || 'Map'); m.seed = +m.seed || 1; m.sea = Math.max(0.05, Math.min(0.95, +m.sea || 0.5)); if (!STYLES[m.style]) m.style = 'parchment'; if (!SHAPES[m.shape]) m.shape = 'continent';
      m.show = Object.assign({ symbols: true, grid: false, compass: true, frame: true, title: true }, m.show || {});
      // Repair every feature so one bad entry (from an old backup or a bug) can never break drawing the map.
      const num = (v, d) => Number.isFinite(+v) ? +v : d;
      m.features = (Array.isArray(m.features) ? m.features : []).filter(f => f && typeof f === 'object').map(f => {
        if (f.type === 'pin') return { id: String(f.id || fid()), type: 'pin', kind: PINS[f.kind] ? f.kind : 'town', x: num(f.x, W / 2), y: num(f.y, H / 2), name: String(f.name == null ? '' : f.name), link: String(f.link == null ? '' : f.link) };
        if (f.type === 'label') return { id: String(f.id || fid()), type: 'label', kind: ['region', 'sea', 'place'].includes(f.kind) ? f.kind : 'place', x: num(f.x, W / 2), y: num(f.y, H / 2), text: String(f.text == null ? '' : f.text), size: Math.max(8, Math.min(80, num(f.size, 20))), rot: Math.max(-90, Math.min(90, num(f.rot, 0))) };
        if (f.type === 'path' && Array.isArray(f.pts)) { const pts = f.pts.filter(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map(p => [+p[0], +p[1]]); return pts.length > 1 ? { id: String(f.id || fid()), type: 'path', kind: PATHS[f.kind] ? f.kind : 'road', pts } : null; }
        return null;
      }).filter(Boolean);
    }
    p.mapOrder = (Array.isArray(p.mapOrder) ? p.mapOrder : []).filter((id, i, a) => p.maps[id] && a.indexOf(id) === i);
    Object.keys(p.maps).forEach(id => { if (!p.mapOrder.includes(id)) p.mapOrder.push(id); });
    if (p.currentMap && !p.maps[p.currentMap]) p.currentMap = p.mapOrder[0] || null;
  }
  return { render, png, pinsLinkedTo, showPin, renameLinks, normalize, generate, _E: E, STYLES };
})();
