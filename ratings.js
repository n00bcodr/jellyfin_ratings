// ==UserScript==
// @name         Jellyfin Ratings+ (DE FSK, Hover Cards, Episodes, Prefetch, Cache) — No Keys Embedded
// @namespace    jf-ratings-plus
// @version      1.0.1
// @description  Ratings with hover cards, German FSK, episode ratings, caching & prefetch for Jellyfin. API keys only via injector.
// @match        *://*/web/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /********************************************************************
   * API KEYS: read-only from the injector (DO NOT STORE LOCALLY)
   ********************************************************************/
  function getKey(name) {
    const src = (typeof window !== 'undefined' && window.__JF_RATINGS_KEYS) || null;
    return src && typeof src[name] === 'string' && src[name].trim() ? src[name].trim() : null;
  }
  function hasTMDb() { return !!getKey('TMDB_API_KEY'); }
  function hasMDBList() { return !!getKey('MDBLIST_API_KEY'); }

  /********************************************************************
   * FEATURE FLAGS & SETTINGS (safe; never store secrets)
   ********************************************************************/
  const DEFAULT_CFG = {
    // Global features
    enableHoverCards: true,
    enableEpisodeRatings: true,
    enableBulkPrefetch: true,
    language: 'de-DE',

    // Providers
    providers: { tmdb: true, anilist: true, imdb: true },

    // Cache & reliability
    ttlDays: { tmdb: 7, anilist: 3, imdb: 7 },
    retry: { maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 2000 },
    rateLimits: {
      'api.themoviedb.org': { intervalMs: 300, concurrent: 4 },
      'graphql.anilist.co' : { intervalMs: 200, concurrent: 2 },
      'api.mdblist.com'    : { intervalMs: 400, concurrent: 2 }
    }
  };
  const CFG_KEY = 'jf-ratings-cfg-v3';
  function loadCfg() {
    try { return Object.assign({}, DEFAULT_CFG, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); }
    catch { return { ...DEFAULT_CFG }; }
  }
  function saveCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }
  let CFG = loadCfg();

  /********************************************************************
   * UTIL
   ********************************************************************/
  function once(el, attr = 'data-jf-rated') { if (el.hasAttribute(attr)) return false; el.setAttribute(attr, '1'); return true; }
  const debounced = (fn, ms=120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const ICONS = {
    tmdb: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 3h18v18H3zM6 6h5v12H6zM13 6h5v5h-5zM13 13h5v5h-5z"/></svg>`,
    anilist: `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 20l7-16h2l7 16h-3l-1.6-4H8.6L7 20H4zm6-7h4l-2-5-2 5z"/></svg>`,
    imdb: `<svg viewBox="0 0 64 32" width="22" height="14"><rect width="64" height="32" rx="4"></rect><rect x="8" y="8" width="6" height="16" fill="#fff"/><rect x="18" y="8" width="20" height="16" fill="#fff"/><rect x="40" y="8" width="16" height="16" fill="#fff"/></svg>`,
    fsk: `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" font-size="10" fill="#fff">FSK</text></svg>`
  };

  /********************************************************************
   * RELIABILITY: queues, cache, retry, circuit breaker
   ********************************************************************/
  class HostQueue {
    constructor({ intervalMs, concurrent }) { this.intervalMs = intervalMs; this.concurrent = concurrent; this.q = []; this.active = 0; this.timer = null; }
    push(task) { this.q.push(task); this._pump(); }
    _pump() {
      if (this.active >= this.concurrent || !this.q.length) return;
      this.active++;
      const { fn, resolve, reject } = this.q.shift();
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        this.active--;
        if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; this._pump(); }, this.intervalMs); }
      });
    }
  }
  const queues = new Map();
  function queueFor(url) {
    const host = new URL(url).host;
    if (!queues.has(host)) queues.set(host, new HostQueue(CFG.rateLimits[host] || { intervalMs: 300, concurrent: 2 }));
    return queues.get(host);
  }
  function queuedFetch(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    return new Promise((resolve, reject) => queueFor(url).push({ fn: () => fetch(input, init), resolve, reject }));
  }

  const CB = new Map(); // host -> { fails, openUntil }
  function canCall(url) { const h = new URL(url).host; const st = CB.get(h); return !st || !st.openUntil || Date.now() >= st.openUntil; }
  function noteSuccess(url) { CB.set(new URL(url).host, { fails: 0, openUntil: 0 }); }
  function noteFailure(url) { const h = new URL(url).host; const st = CB.get(h) || { fails: 0, openUntil: 0 }; st.fails++; if (st.fails >= 5) st.openUntil = Date.now() + 60_000; CB.set(h, st); }

  const DB_NAME = 'jf-ratings-cache', STORE = 'responses'; let dbp;
  function db(){ if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open(DB_NAME,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); return dbp; }
  async function idbGet(key){ const d = await db(); return new Promise((res, rej)=>{ const tx=d.transaction(STORE), st=tx.objectStore(STORE), rq=st.get(key); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error); }); }
  async function idbSet(key,val){ const d = await db(); return new Promise((res, rej)=>{ const tx=d.transaction(STORE,'readwrite'), st=tx.objectStore(STORE), rq=st.put(val,key); rq.onsuccess=()=>res(); rq.onerror=()=>rej(rq.error); }); }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  async function withRetry(fn, url){ const {maxAttempts,baseDelayMs,maxDelayMs}=CFG.retry; let a=0,last; while(a<maxAttempts){ a++; try{ if(!canCall(url)) throw new Error('Circuit open'); const r=await fn(); noteSuccess(url); return r; } catch(e){ last=e; noteFailure(url); const d=Math.min(maxDelayMs, baseDelayMs*Math.pow(2,a-1)); await sleep(d);} } throw last; }
  function days(n){ return n*24*60*60*1000; }

  async function cachedJSON(url, { ttlMs = 86400000, headers = {}, ...rest } = {}) {
    const now = Date.now(); const cacheKey = 'v3:' + url; const cached = await idbGet(cacheKey);
    const h = new Headers(headers); if (cached?.etag) h.set('If-None-Match', cached.etag);
    const fetcher = async () => { const resp = await queuedFetch(url, { headers: h, ...rest }); if (resp.status===304 && cached?.data) return { data: cached.data, cached: true }; if (!resp.ok) throw new Error(`HTTP ${resp.status}`); const etag = resp.headers.get('ETag') || null; const data = await resp.json(); await idbSet(cacheKey, { data, etag, t: now }); return { data, cached: false }; };
    try { return await withRetry(fetcher, url); } catch(e){ if (cached && (now - cached.t) < ttlMs) return { data: cached.data, cached: true }; throw e; }
  }

  /********************************************************************
   * PROVIDERS
   ********************************************************************/
  const Providers = {};

  // TMDb
  Providers.tmdb = (() => {
    const base = 'https://api.themoviedb.org/3';
    function keyQ() { return `api_key=${encodeURIComponent(getKey('TMDB_API_KEY') || '')}`; }
    function langQ() { return `language=${encodeURIComponent(CFG.language || 'de-DE')}`; }
    function link(ids) {
      if (ids?.tmdbType==='movie') return `https://www.themoviedb.org/movie/${ids.tmdbId}`;
      if (ids?.tmdbType==='tv')    return `https://www.themoviedb.org/tv/${ids.tmdbId}`;
      return `https://www.themoviedb.org/`;
    }
    async function search(item) {
      if (!hasTMDb()) return null;
      const qTitle = encodeURIComponent(item.title);
      const type = item.kind === 'episode' ? 'tv' : (item.kind === 'series' ? 'tv' : 'movie');
      const yearQ = item.year ? (type==='movie' ? `&year=${item.year}` : `&first_air_date_year=${item.year}`) : '';
      const url = `${base}/search/${type}?${keyQ()}&${langQ()}&query=${qTitle}${yearQ}`;
      const { data } = await cachedJSON(url, { ttlMs: days(CFG.ttlDays.tmdb) });
      const res = (data?.results || [])[0]; if (!res) return null;
      return { tmdbId: res.id, tmdbType: type, imdbId: null };
    }
    async function byId(ids) {
      if (!hasTMDb() || !ids?.tmdbId) return null;
      const type = ids.tmdbType || 'movie';
      const url = `${base}/${type}/${ids.tmdbId}?${keyQ()}&${langQ()}`;
      const { data } = await cachedJSON(url, { ttlMs: days(CFG.ttlDays.tmdb) });
      const rating = data?.vote_average ? (Math.round(data.vote_average*10)/10) : null;
      const count  = data?.vote_count ?? null;
      // external ids for imdb
      let imdbId = ids.imdbId || null;
      try {
        const ext = await cachedJSON(`${base}/${type}/${ids.tmdbId}/external_ids?${keyQ()}`, { ttlMs: days(30) });
        imdbId = ext?.data?.imdb_id || imdbId || null;
      } catch {}
      return { rating, count, imdbId };
    }
    async function episode(item, ids) {
      if (!hasTMDb()) return null;
      let tvId = ids?.tmdbId;
      if (!tvId) {
        const found = await search({ title: item.seriesTitle || item.title, year: item.year, kind: 'series' });
        tvId = found?.tmdbId;
      }
      if (!tvId || item.seasonNumber == null || item.episodeNumber == null) return null;
      const url = `${base}/tv/${tvId}/season/${item.seasonNumber}/episode/${item.episodeNumber}?${keyQ()}&${langQ()}`;
      const { data } = await cachedJSON(url, { ttlMs: days(3) });
      const rating = data?.vote_average ? (Math.round(data.vote_average*10)/10) : null;
      const count  = data?.vote_count ?? null;
      return { rating, count, link: `https://www.themoviedb.org/tv/${tvId}/season/${item.seasonNumber}/episode/${item.episodeNumber}` };
    }
    async function fsk(ids) {
      if (!hasTMDb() || !ids?.tmdbId) return null;
      if (ids.tmdbType === 'movie') {
        const { data } = await cachedJSON(`${base}/movie/${ids.tmdbId}/release_dates?${keyQ()}`, { ttlMs: days(30) });
        const de = (data?.results || []).find(r => r.iso_3166_1 === 'DE');
        const cert = de?.release_dates?.find(x => x.certification)?.certification || null;
        return normalizeToFSK(cert, 'movie');
      } else {
        const { data } = await cachedJSON(`${base}/tv/${ids.tmdbId}/content_ratings?${keyQ()}`, { ttlMs: days(30) });
        const de = (data?.results || []).find(r => r.iso_3166_1 === 'DE');
        const cert = de?.rating || null;
        return normalizeToFSK(cert, 'tv');
      }
    }
    return { id: 'tmdb', search, byId, link, episode, fsk };
  })();

  // AniList
  Providers.anilist = (() => {
    const url = 'https://graphql.anilist.co';
    function link(ids){ return ids?.anilistId ? `https://anilist.co/anime/${ids.anilistId}` : 'https://anilist.co/'; }
    async function search(item) {
      if (!CFG.providers.anilist) return null;
      const query = `query ($search: String, $year: Int) { Page(perPage:1){ media(search:$search,seasonYear:$year,type:ANIME){ id }}}`;
      const variables = { search: item.title, year: item.year || null };
      const { data } = await cachedJSON(url, {
        ttlMs: days(CFG.ttlDays.anilist), method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ query, variables })
      });
      const m = data?.data?.Page?.media?.[0]; if (!m) return null;
      return { anilistId: m.id };
    }
    async function byId(ids) {
      if (!ids?.anilistId) return null;
      const query = `query ($id:Int){ Media(id:$id,type:ANIME){ averageScore popularity }}`;
      const variables = { id: ids.anilistId };
      const { data } = await cachedJSON(url, {
        ttlMs: days(CFG.ttlDays.anilist), method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ query, variables })
      });
      const m = data?.data?.Media;
      const rating = m?.averageScore != null ? (Math.round(m.averageScore)/10) : null;
      const count = m?.popularity ?? null;
      return { rating, count };
    }
    async function episode(){ return null; }
    async function fsk(){ return null; }
    return { id:'anilist', search, byId, link, episode, fsk };
  })();

  // IMDb via MDBList (optional)
  Providers.imdb = (() => {
    function link(ids){ return ids?.imdbId ? `https://www.imdb.com/title/${ids.imdbId}/` : 'https://www.imdb.com/'; }
    async function search(){ return null; } // rely on TMDb external_ids
    async function byId(ids){
      if (!hasMDBList() || !ids?.imdbId) return null;
      const url = `https://api.mdblist.com/?i=${encodeURIComponent(ids.imdbId)}&apikey=${encodeURIComponent(getKey('MDBLIST_API_KEY'))}`;
      const { data } = await cachedJSON(url, { ttlMs: days(CFG.ttlDays.imdb) });
      const rating = data?.ratings?.imdb?.score ?? data?.imdb?.rating ?? null;
      const count  = data?.imdb?.votes ? Number(data.imdb.votes) : null;
      return { rating, count };
    }
    async function episode(){ return null; }
    async function fsk(){ return null; }
    return { id:'imdb', search, byId, link, episode, fsk };
  })();

  /********************************************************************
   * FSK normalization
   ********************************************************************/
  function normalizeToFSK(cert) {
    if (cert && /^FSK\s?(0|6|12|16|18)$/.test(cert)) return cert.replace(/\s+/g,'');
    const map = { '0':'FSK0','6':'FSK6','12':'FSK12','16':'FSK16','18':'FSK18',
      'G':'FSK0','TV-G':'FSK0','PG':'FSK6','TV-PG':'FSK6','PG-13':'FSK12','TV-14':'FSK12','R':'FSK16','TV-MA':'FSK16','NC-17':'FSK18' };
    if (cert && map[cert]) return map[cert];
    if (!cert) return null;
    const s = cert.toUpperCase();
    if (s.includes('PG-13')||s.includes('12')||s.includes('TV-14')) return 'FSK12';
    if (s.includes('NC-17')||s.includes('18')) return 'FSK18';
    if (s.includes('R')||s.includes('16')||s.includes('MA')) return 'FSK16';
    if (s.includes('PG')) return 'FSK6';
    return 'FSK0';
  }

  /********************************************************************
   * DOM helpers & rendering
   ********************************************************************/
  function ensureIconRow(container) {
    if (!container) return null;
    let row = container.querySelector('.jf-ratings-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'jf-ratings-row';
      row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px';
      container.appendChild(row);
    }
    return row;
  }
  function makeIcon(providerId, href, title, meta) {
    const a = document.createElement('a');
    a.href = href || '#'; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'jf-rating-icon';
    a.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:var(--theme-primary-color,#3a3a3a);opacity:.95;';
    a.innerHTML = ICONS[providerId] || ICONS.tmdb;
    if (CFG.enableHoverCards && (meta?.rating || meta?.count)) {
      a.setAttribute('data-jf-hover', JSON.stringify({ provider: providerId, rating: meta.rating ?? null, count: meta.count ?? null }));
      a.addEventListener('mouseenter', showHoverCard);
      a.addEventListener('mouseleave', hideHoverCard);
    }
    return a;
  }
  let hoverEl = null;
  function showHoverCard(e) {
    const data = JSON.parse(e.currentTarget.getAttribute('data-jf-hover') || '{}');
    if (!hoverEl) {
      hoverEl = document.createElement('div');
      hoverEl.style.cssText = `position:fixed;z-index:99999;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.85);color:#fff;backdrop-filter:blur(6px);box-shadow:0 8px 20px rgba(0,0,0,.4);pointer-events:none;transform:translate(-50%,-120%);font-size:12px;line-height:1.3;min-width:160px;text-align:center`;
      document.body.appendChild(hoverEl);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    hoverEl.style.left = (rect.left + rect.width/2) + 'px';
    hoverEl.style.top  = (rect.top) + 'px';
    const provName = String(data.provider || '').toUpperCase();
    const r = data.rating != null ? `${data.rating.toFixed(1)} / 10` : '—';
    const c = data.count != null ? new Intl.NumberFormat().format(data.count) : '—';
    hoverEl.innerHTML = `<div style="opacity:.8">${provName}</div><div style="font-weight:700;font-size:14px">${r}</div><div style="opacity:.8">Votes: ${c}</div>`;
    hoverEl.style.display = 'block';
  }
  function hideHoverCard(){ if (hoverEl) hoverEl.style.display = 'none'; }

  function injectFSKBadge(container, fsk) {
    if (!fsk) return;
    if (!once(container, 'data-jf-fsk')) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px';
    const badge = document.createElement('span');
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border-radius:8px;padding:4px 8px';
    badge.innerHTML = `${ICONS.fsk}<span style="font-size:12px"> ${fsk}</span>`;
    wrap.appendChild(badge);
    container.appendChild(wrap);
  }
  function injectEpisodeBadge(node, rating) {
    if (!rating) return;
    if (!once(node, 'data-jf-ep')) return;
    const tag = document.createElement('span');
    tag.style.cssText = 'margin-left:6px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.08);font-size:12px';
    tag.textContent = `★ ${rating.toFixed(1)}`;
    node.appendChild(tag);
  }

  /********************************************************************
   * INLINE SETTINGS PANEL (no API key inputs)
   ********************************************************************/
  function settingsUI() {
    if (document.getElementById('jf-ratings-settings')) return;
    const wrap = document.createElement('div');
    wrap.id = 'jf-ratings-settings';
    wrap.style.cssText = `
      position:fixed;right:16px;bottom:16px;z-index:9999;padding:12px 14px;
      background:#0b0b0bcc;border:1px solid #2a2a2a;border-radius:14px;backdrop-filter:blur(8px);
      color:#fff; min-width:260px; font-size:13px
    `;
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <strong>Ratings Settings</strong>
        <button id="jf-close" style="background:#222;border:1px solid #444;color:#fff;border-radius:8px;padding:2px 8px;cursor:pointer">×</button>
      </div>
      <div style="margin:6px 0 10px 0;opacity:.9">
        API Keys via Injector:
        <span style="margin-left:8px">TMDb <b>${hasTMDb()?'✅':'❌'}</b></span>
        <span style="margin-left:8px">MDBList <b>${hasMDBList()?'✅':'❌'}</b></span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:center">
        <label><input id="toggle-hover" type="checkbox"> Hover cards</label>
        <label><input id="toggle-ep" type="checkbox"> Episode ratings</label>
        <label><input id="toggle-prefetch" type="checkbox"> Bulk prefetch</label>
        <label><input id="p-tmdb" type="checkbox"> TMDb</label>
        <label><input id="p-anilist" type="checkbox"> AniList</label>
        <label><input id="p-imdb" type="checkbox"> IMDb (MDBList)</label>
      </div>
      <div style="margin-top:10px;opacity:.8">Language fixed to <code>de-DE</code>. Certifications prefer German FSK.</div>
    `;
    document.body.appendChild(wrap);

    wrap.querySelector('#toggle-hover').checked = !!CFG.enableHoverCards;
    wrap.querySelector('#toggle-ep').checked = !!CFG.enableEpisodeRatings;
    wrap.querySelector('#toggle-prefetch').checked = !!CFG.enableBulkPrefetch;
    wrap.querySelector('#p-tmdb').checked = !!CFG.providers.tmdb;
    wrap.querySelector('#p-anilist').checked = !!CFG.providers.anilist;
    wrap.querySelector('#p-imdb').checked = !!CFG.providers.imdb;

    function persist() {
      CFG = loadCfg();
      CFG.enableHoverCards   = wrap.querySelector('#toggle-hover').checked;
      CFG.enableEpisodeRatings = wrap.querySelector('#toggle-ep').checked;
      CFG.enableBulkPrefetch = wrap.querySelector('#toggle-prefetch').checked;
      CFG.providers.tmdb     = wrap.querySelector('#p-tmdb').checked;
      CFG.providers.anilist  = wrap.querySelector('#p-anilist').checked;
      CFG.providers.imdb     = wrap.querySelector('#p-imdb').checked;
      saveCfg(CFG);
    }
    wrap.addEventListener('change', persist);
    wrap.querySelector('#jf-close').addEventListener('click', () => wrap.remove());

    // Floating gear to reopen
    if (!document.getElementById('jf-gear')) {
      const gear = document.createElement('button');
      gear.id = 'jf-gear';
      gear.title = 'Ratings Einstellungen';
      gear.style.cssText = 'position:fixed;right:16px;bottom:16px;width:40px;height:40px;border-radius:10px;background:#0b0b0bcc;border:1px solid #2a2a2a;color:#fff;z-index:9999;cursor:pointer';
      gear.textContent = '⚙';
      gear.addEventListener('click', () => settingsUI());
      document.body.appendChild(gear);
    }
  }

  /********************************************************************
   * Jellyfin DOM scanning / helpers
   ********************************************************************/
  function getItemContextFromDetail() {
    const nameEl = document.querySelector('.itemName.infoText, .detailPagePrimaryContainer .itemName');
    if (!nameEl) return null;
    const rawTitle = nameEl.textContent.trim();
    const sub = document.querySelector('.parentNameLast, .mediaInfoPrimary, .seriesName, .detailPagePrimaryContainer .parentName');
    const typeGuess = document.querySelector('.detailPagePrimaryContainer [data-type]')?.getAttribute('data-type');
    const yearMatch = document.body.innerText.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : null;
    const epBadge = document.querySelector('.secondaryText, .mediaInfoSecondary');
    const epText = epBadge ? epBadge.textContent : '';

    let seriesTitle = null, seasonNumber = null, episodeNumber = null, kind = 'movie';
    if (/S\d+\s*E\d+/i.test(epText) || /Staffel\s+\d+/i.test(epText) || /Episode/i.test(epText)) {
      kind = 'episode';
      seriesTitle = sub ? sub.textContent.trim() : rawTitle;
      const se = epText.match(/S(\d+)\s*E(\d+)/i) || epText.match(/Staffel\s+(\d+)[^\d]+(\d+)/i);
      if (se) { seasonNumber = Number(se[1]); episodeNumber = Number(se[2]); }
    } else if (/Staffel\s+\d+/i.test(rawTitle) || /Season/i.test(rawTitle) || typeGuess === 'Series') {
      kind = 'series'; seriesTitle = rawTitle.replace(/Staffel\s+\d+.*/i,'').trim();
    }
    return { title: rawTitle, seriesTitle, year, kind, seasonNumber, episodeNumber };
  }

  function getCardItemsVisible() {
    const cards = [...document.querySelectorAll('[data-card], .card, .primaryImageWrapper')];
    const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.bottom>0 && r.right>0 && r.top<(window.innerHeight||0) && r.left<(window.innerWidth||0); };
    return cards.filter(inViewport).map(card => {
      if (!once(card, 'data-jf-scan')) return null;
      const titleEl = card.querySelector('.cardText, .cardOverlayText, .textActionButton') || card;
      const title = (titleEl?.textContent || '').trim();
      const yearMatch = card.innerText.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? Number(yearMatch[0]) : null;
      return { el: card, title, year, kind: 'movie' };
    }).filter(Boolean);
  }

  const MAP_KEY = 'jf-ratings-idmap-v2';
  function loadMap(){ try { return JSON.parse(localStorage.getItem(MAP_KEY)||'{}'); } catch { return {}; } }
  function saveMap(m){ localStorage.setItem(MAP_KEY, JSON.stringify(m)); }
  let IDMAP = loadMap();
  function mapKey(item){ return `${item.kind}|${item.seriesTitle||''}|${item.title}|${item.year||''}|${item.seasonNumber||''}|${item.episodeNumber||''}`; }

  async function resolveIds(item) {
    const mk = mapKey(item);
    if (IDMAP[mk]) return IDMAP[mk];
    let ids = {};
    if (CFG.providers.tmdb) {
      const f = await Providers.tmdb.search(item);
      if (f) ids = { ...ids, ...f };
      if (f && hasTMDb()) {
        const detail = await Providers.tmdb.byId(f);
        if (detail?.imdbId) ids.imdbId = detail.imdbId;
      }
    }
    if (CFG.providers.anilist && (!ids.anilistId) && (item.kind !== 'movie')) {
      const a = await Providers.anilist.search({ title: item.seriesTitle || item.title, year: item.year, kind: 'series' });
      if (a) ids = { ...ids, ...a };
    }
    IDMAP[mk] = ids; saveMap(IDMAP); return ids;
  }

  /********************************************************************
   * Prefetch + main scan
   ********************************************************************/
  const prefetchVisible = debounced(async () => {
    if (!CFG.enableBulkPrefetch) return;
    const items = getCardItemsVisible();
    for (const it of items) {
      const ids = await resolveIds(it);
      if (CFG.providers.tmdb && ids.tmdbId && hasTMDb()) await Providers.tmdb.byId(ids).catch(()=>{});
      if (CFG.providers.imdb && ids.imdbId && hasMDBList()) await Providers.imdb.byId(ids).catch(()=>{});
      if (CFG.providers.anilist && ids.anilistId) await Providers.anilist.byId(ids).catch(()=>{});
      const overlay = it.el.querySelector('.cardOverlayButton, .cardOverlayText') || it.el;
      const row = ensureIconRow(overlay);
      try {
        if (CFG.providers.tmdb && ids.tmdbId && hasTMDb()) {
          const b = await Providers.tmdb.byId(ids);
          row.appendChild(makeIcon('tmdb', Providers.tmdb.link(ids), 'TMDb', b||{}));
        }
        if (CFG.providers.imdb && ids.imdbId && hasMDBList()) {
          const b = await Providers.imdb.byId(ids);
          row.appendChild(makeIcon('imdb', Providers.imdb.link(ids), 'IMDb', b||{}));
        }
        if (CFG.providers.anilist && ids.anilistId) {
          const b = await Providers.anilist.byId(ids);
          row.appendChild(makeIcon('anilist', Providers.anilist.link(ids), 'AniList', b||{}));
        }
      } catch {}
    }
  }, 200);

  const scan = debounced(async () => {
    const titleBox = document.querySelector('.detailPagePrimaryContainer, .infoText, .detailPageContent');
    if (!titleBox) return;
    const ctx = getItemContextFromDetail(); if (!ctx) return;
    const ids = await resolveIds(ctx);
    const row = ensureIconRow(titleBox);

    if (CFG.providers.tmdb && ids.tmdbId && hasTMDb()) {
      try { const d = await Providers.tmdb.byId(ids); row.appendChild(makeIcon('tmdb', Providers.tmdb.link(ids), 'TMDb', d||{})); } catch {}
    }
    if (CFG.providers.imdb && ids.imdbId && hasMDBList()) {
      try { const d = await Providers.imdb.byId(ids); row.appendChild(makeIcon('imdb', Providers.imdb.link(ids), 'IMDb', d||{})); } catch {}
    }
    if (CFG.providers.anilist && ids.anilistId && (ctx.kind !== 'movie')) {
      try { const d = await Providers.anilist.byId(ids); row.appendChild(makeIcon('anilist', Providers.anilist.link(ids), 'AniList', d||{})); } catch {}
    }

    try { if (CFG.providers.tmdb && ids.tmdbId && hasTMDb()) { const fsk = await Providers.tmdb.fsk(ids); if (fsk) injectFSKBadge(titleBox, fsk); } } catch {}

    if (CFG.enableEpisodeRatings && (ctx.kind === 'episode' || ctx.seasonNumber != null)) {
      try { const ep = await Providers.tmdb.episode(ctx, ids); const epNode = document.querySelector('.itemName.infoText') || titleBox; if (ep?.rating && epNode) injectEpisodeBadge(epNode, ep.rating); } catch {}
    }
  }, 120);

  /********************************************************************
   * Boot
   ********************************************************************/
  function boot() {
    settingsUI();
    new MutationObserver(() => { scan(); prefetchVisible(); }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', () => { scan(); prefetchVisible(); });
    window.addEventListener('scroll', prefetchVisible, { passive: true });
    scan(); prefetchVisible();
  }
  if (location.pathname.includes('/web/')) boot();
})();
