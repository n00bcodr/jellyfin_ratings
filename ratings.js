// ==UserScript==
// @name         Jellyfin Ratings (v6.5.0 — Settings UI, RT via MDBList + Fallback)
// @namespace    https://mdblist.com
// @version      6.5.0
// @description  Unified ratings for Jellyfin 10.11.x (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, RT critic+audience, Roger Ebert, Metacritic critic+user). Normalized 0–100, colorized; custom inline “Ends at …” (12h/24h + bullet) with strict dedupe; parental rating cloned to start; single MutationObserver; namespaced caches; tidy helpers and styles. Now with an in-page Settings menu (⚙️ bottom-right).
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

/* ======================================================
   DEFAULT CONFIG (works standalone) — editable via Settings
====================================================== */

/* 🎬 SOURCES (defaults) */
const DEFAULT_ENABLE_SOURCES = {
  imdb:                   true,
  tmdb:                   true,
  trakt:                  true,
  letterboxd:             true,
  rotten_tomatoes:        true,
  roger_ebert:            true,
  anilist:                true,
  myanimelist:            true,
  metacritic_critic:      true,
  metacritic_user:        true
};

/* 🎨 DISPLAY (defaults) */
const DEFAULT_DISPLAY = {
  showPercentSymbol:      true,   // show “%”
  colorizeRatings:        true,   // colorize ratings
  colorizeNumbersOnly:    true,   // true: number only; false: number + icon glow
  align:                  'left', // 'left' | 'center' | 'right'
  endsAtFormat:           '24h',  // '24h' | '12h'
  endsAtBullet:           true    // show bullet • before “Ends at …”
};

/* 📏 SPACING (defaults) */
const DEFAULT_SPACING = {
  ratingsTopGapPx:        8       // gap between first row and ratings row
};

/* 🧮 SORT ORDER (defaults; lower appears earlier) */
const DEFAULT_PRIORITIES = {
  imdb:                     1,
  tmdb:                     2,
  trakt:                    3,
  letterboxd:               4,
  rotten_tomatoes_critic:   5,
  rotten_tomatoes_audience: 6,
  roger_ebert:              7,
  metacritic_critic:        8,
  metacritic_user:          9,
  anilist:                  10,
  myanimelist:              11
};

/* ⚙️ NORMALIZATION (→ 0–100) */
const SCALE_MULTIPLIER = {
  imdb:                     10,
  tmdb:                      1,
  trakt:                     1,
  letterboxd:               20,
  roger_ebert:              25,
  metacritic_critic:         1,
  metacritic_user:          10,
  myanimelist:              10,
  anilist:                   1,
  rotten_tomatoes_critic:    1,
  rotten_tomatoes_audience:  1
};

/* 🎨 COLORS */
const COLOR_THRESHOLDS = { green: 75, orange: 50, red: 0 };
const COLOR_VALUES     = { green: 'limegreen', orange: 'orange', red: 'crimson' };

/* 🔑 API KEY + CACHE (namespaced) */
const MDBLIST_API_KEY = 'hehfnbo9y8blfyqm1d37ikubl';
const CACHE_DURATION  = 7 * 24 * 60 * 60 * 1000; // 7 days
const NS              = 'mdbl_';                 // localStorage prefix
const SETTINGS_KEY    = NS + 'settings_v1';

/* 🖼️ LOGOS (point to your own repo paths) */
const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = {
  imdb:            `${ICON_BASE}/IMDb.png`,
  tmdb:            `${ICON_BASE}/TMDB.png`,
  trakt:           `${ICON_BASE}/Trakt.png`,
  letterboxd:      `${ICON_BASE}/letterboxd.png`,
  anilist:         `${ICON_BASE}/anilist.png`,
  myanimelist:     `${ICON_BASE}/mal.png`,
  roger:           `${ICON_BASE}/Roger_Ebert.png`,
  tomatoes:        `${ICON_BASE}/Rotten_Tomatoes.png`,
  audience:        `${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
  metacritic:      `${ICON_BASE}/Metacritic.png`,
  metacritic_user: `${ICON_BASE}/mus2.png`,
};

/* ======================================================
   MERGE CONFIG FROM INJECTOR (window.MDBL_CFG) + persisted settings
====================================================== */
const __CFG__ = (typeof window !== 'undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
const ENABLE_SOURCES  = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources   || {});
const DISPLAY         = Object.assign({}, DEFAULT_DISPLAY,        __CFG__.display   || {});
const SPACING         = Object.assign({}, DEFAULT_SPACING,        __CFG__.spacing   || {});
const RATING_PRIORITY = Object.assign({}, DEFAULT_PRIORITIES,     __CFG__.priorities|| {});

// Load persisted user settings (if any)
(function loadPersisted(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const u = JSON.parse(raw);
    if (u.sources)    Object.assign(ENABLE_SOURCES, u.sources);
    if (u.display)    Object.assign(DISPLAY, u.display);
    if (u.spacing)    Object.assign(SPACING, u.spacing);
    if (u.priorities) Object.assign(RATING_PRIORITY, u.priorities);
  }catch{}
})();

/* ======================================================
   POLYFILL (for browsers without GM_xmlhttpRequest)
====================================================== */
if (typeof GM_xmlhttpRequest === 'undefined') {
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
  ];
  const DIRECT = ['api.mdblist.com','graphql.anilist.co','query.wikidata.org','api.themoviedb.org'];
  window.GM_xmlhttpRequest = ({ method='GET', url, headers={}, data, onload, onerror }) => {
    const isDirect = DIRECT.some(d => url.includes(d));
    const proxy = PROXIES[Math.floor(Math.random() * PROXIES.length)];
    const sep = url.includes('?') ? '&' : '?';
    const final = isDirect ? url : (proxy + encodeURIComponent(url + sep + `_=${Date.now()}`));
    fetch(final, { method, headers, body:data, cache:'no-store' })
      .then(r => r.text().then(t => onload && onload({ status:r.status, responseText:t })))
      .catch(e => onerror && onerror(e));
  };
}

/* ======================================================
   HELPERS & STYLES
====================================================== */
const Util = {
  pad(n){ return String(n).padStart(2,'0'); },
  validNumber(v){ const n = parseFloat(v); return !isNaN(n); },
  round(v){ return Math.round(parseFloat(v)); },
  normalize(v, src){
    const m = SCALE_MULTIPLIER[(src||'').toLowerCase()] || 1;
    const x = parseFloat(v);
    return isNaN(x) ? null : x * m;
  },
  slug(t){ return (t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
};

(function ensureStyleTag(){
  if (document.getElementById('mdblist-styles')) return;
  const style = document.createElement('style');
  style.id = 'mdblist-styles';
  style.textContent = `
    .mdblist-rating-container{}
    /* Settings UI */
    #mdbl-settings-fab{
      position:fixed; right:18px; bottom:18px; z-index:999999;
      width:44px; height:44px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      background: var(--theme-primary-color, #2a2a2a);
      color: var(--theme-text-color, #fff);
      box-shadow: 0 6px 18px rgba(0,0,0,.35);
      cursor:pointer; user-select:none;
      border:1px solid rgba(255,255,255,.15);
    }
    #mdbl-settings-fab:hover{ transform:translateY(-1px); }
    #mdbl-settings-overlay{
      position:fixed; inset:0; z-index:999998; background:rgba(0,0,0,.45); display:none;
    }
    #mdbl-settings-panel{
      position:fixed; right:18px; bottom:76px; z-index:999999;
      width:min(520px, 94vw); max-height:80vh; overflow:auto;
      background: var(--dialog-backdrop, #1e1e1e);
      color: var(--theme-text-color, #ddd);
      border:1px solid rgba(255,255,255,.12);
      border-radius:14px; box-shadow:0 12px 40px rgba(0,0,0,.45); display:none;
    }
    #mdbl-settings-panel header{
      position:sticky; top:0; background:inherit; z-index:1;
      padding:12px 16px; border-bottom:1px solid rgba(255,255,255,.12);
      display:flex; align-items:center; justify-content:space-between;
      font-weight:700;
    }
    #mdbl-settings-panel section{ padding:12px 16px; }
    #mdbl-settings-panel h3{
      margin:10px 0 8px; font-size:14px; opacity:.9;
      text-transform:uppercase; letter-spacing:.04em;
    }
    .mdbl-grid{
      display:grid; grid-template-columns:1fr 90px; gap:8px 12px; align-items:center;
    }
    .mdbl-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:6px 0; }
    .mdbl-note{ opacity:.7; font-size:12px; }
    .mdbl-num{ width:90px; }
    .mdbl-actions{ display:flex; gap:8px; margin:8px 16px 16px; }
    .mdbl-btn{
      padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.18);
      background:#2a2a2a; color:#fff; cursor:pointer;
    }
    .mdbl-btn.primary{ background:#4b66ff; border-color:#4b66ff; }
    .mdbl-btn.warn{ background:#8a2b2b; border-color:#c24; }
    .mdbl-input{ background:#111; color:#eee; border:1px solid rgba(255,255,255,.16); border-radius:8px; padding:6px 8px; }
    .mdbl-checkbox{ transform:translateY(1px); }
    .mdbl-select{ min-width:120px; }
    .mdbl-hidden{ display:none !important; }
  `;
  document.head.appendChild(style);
})();

/* ======================================================
   CORE LOGIC (single observer → debounced updateAll)
====================================================== */
(function(){
'use strict';

let currentImdbId = null;

/* -------- Strictly remove any non-inline (ours) “Ends at …” -------- */
function removeBuiltInEndsAt(){
  document.querySelectorAll('.itemMiscInfo-secondary').forEach(row => {
    const txt = (row.textContent || '');
    if (/\bends\s+at\b/i.test(txt)) row.remove();
  });
  const ours = document.getElementById('customEndsAt');
  document.querySelectorAll('.itemMiscInfo span, .itemMiscInfo div').forEach(el => {
    if (el === ours || (ours && ours.contains(el))) return;
    const txt = (el.textContent || '');
    if (/\bends\s+at\b/i.test(txt)) el.remove();
  });
}

/* -------- Parental rating: clone to start, hide original -------- */
function ensureInlineBadge(){
  const primary = findPrimaryRow();
  if (!primary) return;
  const ratingValue = readAndHideOriginalBadge();
  if (!ratingValue) return;
  if (primary.querySelector('#mdblistInlineParental')) return;

  const before = findYearChip(primary) || primary.firstChild;
  const badge = document.createElement('span');
  badge.id = 'mdblistInlineParental';
  badge.textContent = ratingValue;
  Object.assign(badge.style,{
    display:'inline-flex', alignItems:'center', justifyContent:'center',
    padding:'2px 6px', borderRadius:'6px', fontWeight:'600',
    fontSize:'0.9em', lineHeight:'1',
    background:'var(--theme-primary-color, rgba(255,255,255,0.12))',
    color:'var(--theme-text-color, #ddd)',
    marginRight:'10px', whiteSpace:'nowrap', flex:'0 0 auto', verticalAlign:'middle'
  });
  if (before && before.parentNode) before.parentNode.insertBefore(badge,before);
  else primary.insertBefore(badge,primary.firstChild);
}

function findPrimaryRow(){
  return document.querySelector('.itemMiscInfo.itemMiscInfo-primary')
      || document.querySelector('.itemMiscInfo-primary')
      || document.querySelector('.itemMiscInfo');
}
function findYearChip(primary){
  const chips = primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div');
  for (const el of chips){
    const t = (el.textContent || '').trim();
    if (/^\d{4}$/.test(t)) return el;
  }
  return null;
}
function readAndHideOriginalBadge(){
  let original = document.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')
               || document.querySelector('.mediaInfoItem.mediaInfoText[data-type="officialRating"]');
  if (!original) {
    const candidates=[...document.querySelectorAll('.itemMiscInfo .mediaInfoItem, .itemMiscInfo .mediaInfoText, .itemMiscInfo span')];
    original = candidates.find(el=>{
      const t=(el.textContent||'').trim();
      return /^[A-Z0-9][A-Z0-9\-+]{0,5}$/.test(t) && !/^\d{4}$/.test(t);
    }) || null;
  }
  if (!original) return null;
  const value = (original.textContent || '').trim();
  original.style.display='none';
  return value || null;
}

/* -------- Custom EndsAt on first row (12h/24h + bullet toggle) -------- */
function ensureEndsAtInline(){
  const primary = findPrimaryRow(); if (!primary) return;
  const {node: anchorNode, minutes} = findRuntimeNode(primary);
  if (!anchorNode || !minutes) return;

  const end = new Date(Date.now() + minutes * 60000);
  const timeStr = formatEndTime(end);
  const prefix  = DISPLAY.endsAtBullet ? ' • ' : '';
  const content = `${prefix}Ends at ${timeStr}`;

  let span = primary.querySelector('#customEndsAt');
  if (!span){
    span = document.createElement('span');
    span.id = 'customEndsAt';
    span.style.marginLeft='6px';
    span.style.color='inherit';
    span.style.opacity='1';
    span.style.fontSize='inherit';
    span.style.fontWeight='inherit';
    span.style.whiteSpace='nowrap';
    span.style.display='inline';
    if (anchorNode.nextSibling) anchorNode.parentNode.insertBefore(span, anchorNode.nextSibling);
    else anchorNode.parentNode.appendChild(span);
  }
  span.textContent = content;
}
function formatEndTime(d){
  if (DISPLAY.endsAtFormat === '12h') {
    let h = d.getHours();
    const m = Util.pad(d.getMinutes());
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${suffix}`;
  }
  return `${Util.pad(d.getHours())}:${Util.pad(d.getMinutes())}`;
}
function findRuntimeNode(primary){
  const chips = primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div');
  for (const el of chips){
    const t=(el.textContent||'').trim();
    const mins=parseRuntimeToMinutes(t);
    if (mins>0) return {node:el, minutes:mins};
  }
  const t=(primary.textContent||'').trim();
  const mins=parseRuntimeToMinutes(t);
  return mins>0 ? {node:primary, minutes:mins} : {node:null, minutes:0};
}
function parseRuntimeToMinutes(text){
  if (!text) return 0;
  const re = /(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i;
  const m = text.match(re);
  if (!m) return 0;
  const h = parseInt(m[1]||'0',10);
  const min = parseInt(m[2]||'0',10);
  if (h===0 && min===0) {
    const onlyMin = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
    return onlyMin ? parseInt(onlyMin[1],10) : 0;
  }
  return h*60 + min;
}

/* -------- Ratings containers + fetch -------- */
function hideDefaultRatingsOnce(){
  document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box=>{
    box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el=>{ el.style.display='none'; });
  });
}

function scanLinks(){
  document.querySelectorAll('a.emby-button[href*="imdb.com/title/"]').forEach(a=>{
    if (a.dataset.mdblSeen === '1') return;
    a.dataset.mdblSeen = '1';
    const m=a.href.match(/imdb\.com\/title\/(tt\d+)/);
    if (!m) return;
    const id = m[1];
    if (id !== currentImdbId){
      document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove());
      currentImdbId = id;
    }
  });

  [...document.querySelectorAll('a.emby-button[href*="themoviedb.org/"]')].forEach(a=>{
    if (a.dataset.mdblProc === '1') return;
    const m=a.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
    if (!m) return;
    a.dataset.mdblProc = '1';
    const type = m[1] === 'tv' ? 'show' : 'movie';
    const tmdbId = m[2];

    document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b=>{
      const ref=b.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating') || b.querySelector('.mediaInfoItem:last-of-type');
      if (!ref) return;
      if (ref.nextElementSibling && ref.nextElementSibling.classList?.contains('mdblist-rating-container')) return;

      const div = document.createElement('div');
      div.className = 'mdblist-rating-container';
      const justify     = DISPLAY.align==='center' ? 'center' : DISPLAY.align==='left' ? 'flex-start' : 'flex-end';
      const paddingRight= DISPLAY.align==='right' ? '6px' : '0';
      div.style = `
        display:flex; flex-wrap:wrap; align-items:center;
        justify-content:${justify};
        width:calc(100% + 6px);
        margin-left:-6px;
        margin-top:${SPACING.ratingsTopGapPx}px;
        padding-right:${paddingRight};
        box-sizing:border-box;
      `;
      div.dataset.type = type;
      div.dataset.tmdbId = tmdbId;
      div.dataset.mdblFetched = '0';
      ref.insertAdjacentElement('afterend', div);
    });
  });

  hideDefaultRatingsOnce();
}

function updateRatings(){
  document.querySelectorAll('.mdblist-rating-container').forEach(c=>{
    if (c.dataset.mdblFetched === '1') return;
    const type   = c.dataset.type || 'movie';
    const tmdbId = c.dataset.tmdbId;
    if (!tmdbId) return;
    c.dataset.mdblFetched = '1';
    fetchRatings(tmdbId, currentImdbId, c, type);
  });
}

function appendRating(container, logo, val, title, key, link){
  if (!ENABLE_SOURCES[key] && !key.includes('rotten_tomatoes')) {
    // For normalized keys like 'rotten_tomatoes_critic' we check below
    if (!(key==='metacritic_critic' || key==='metacritic_user' || key==='roger_ebert' || key==='anilist' || key==='myanimelist')) {
      return;
    }
  }
  if (key.startsWith('rotten_tomatoes') && !ENABLE_SOURCES.rotten_tomatoes) return;
  if (!Util.validNumber(val)) return;

  const n = Util.normalize(val, key);
  if (!Util.validNumber(n)) return;
  const r = Util.round(n);
  const disp = DISPLAY.showPercentSymbol ? `${r}%` : `${r}`;
  if (container.querySelector(`[data-source="${key}"]`)) return;

  const wrap = document.createElement('div');
  wrap.dataset.source = key;
  wrap.style = 'display:inline-flex;align-items:center;margin:0 6px;';
  const a = document.createElement('a');
  a.href = link; a.target = '_blank'; a.style.textDecoration='none;';

  const img = document.createElement('img');
  img.src = logo; img.alt = title; img.title = `${title}: ${disp}`;
  img.style = 'height:1.3em;margin-right:3px;vertical-align:middle;';

  const s = document.createElement('span');
  s.textContent = disp; s.style = 'font-size:1em;vertical-align:middle;';

  if (DISPLAY.colorizeRatings){
    let col;
    if (r >= COLOR_THRESHOLDS.green) col = COLOR_VALUES.green;
    else if (r >= COLOR_THRESHOLDS.orange) col = COLOR_VALUES.orange;
    else col = COLOR_VALUES.red;
    if (DISPLAY.colorizeNumbersOnly) s.style.color = col;
    else { s.style.color = col; img.style.filter = `drop-shadow(0 0 3px ${col})`; }
  }

  a.append(img,s);
  wrap.append(a);
  container.append(wrap);
  // sort by configured priority
  [...container.children]
    .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
    .forEach(el=>container.appendChild(el));
}

/* -------- Fetch ratings (MDBList primary, extra sources + RT fallback) -------- */
function fetchRatings(tmdbId, imdbId, container, type='movie'){
  GM_xmlhttpRequest({
    method:'GET',
    url:`https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
    onload:r=>{
      if (r.status !== 200) return;
      let d; try { d = JSON.parse(r.responseText); } catch { return; }
      const title = d.title || ''; const slug = Util.slug(title);

      d.ratings?.forEach(rr=>{
        const s = (rr.source||'').toLowerCase();
        const v = rr.value;

        if (s.includes('imdb') && ENABLE_SOURCES.imdb)
          appendRating(container, LOGO.imdb, v, 'IMDb', 'imdb', `https://www.imdb.com/title/${imdbId}/`);

        else if (s.includes('tmdb') && ENABLE_SOURCES.tmdb)
          appendRating(container, LOGO.tmdb, v, 'TMDb', 'tmdb', `https://www.themoviedb.org/${type}/${tmdbId}`);

        else if (s.includes('trakt') && ENABLE_SOURCES.trakt)
          appendRating(container, LOGO.trakt, v, 'Trakt', 'trakt', `https://trakt.tv/search/imdb/${imdbId}`);

        else if (s.includes('letterboxd') && ENABLE_SOURCES.letterboxd)
          appendRating(container, LOGO.letterboxd, v, 'Letterboxd', 'letterboxd', `https://letterboxd.com/imdb/${imdbId}/`);

        // RT from MDBList when present
        else if ((s === 'tomatoes' || s.includes('rotten_tomatoes')) && ENABLE_SOURCES.rotten_tomatoes) {
          const rtSearch = title ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}` : '#';
          appendRating(container, LOGO.tomatoes, v, 'RT Critic', 'rotten_tomatoes_critic', rtSearch);
        }
        else if ((s.includes('popcorn') || s.includes('audience')) && ENABLE_SOURCES.rotten_tomatoes) {
          const rtSearch = title ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}` : '#';
          appendRating(container, LOGO.audience, v, 'RT Audience', 'rotten_tomatoes_audience', rtSearch);
        }

        else if (s === 'metacritic' && ENABLE_SOURCES.metacritic_critic){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container, LOGO.metacritic, v, 'Metacritic (Critic)', 'metacritic_critic', link);
        }
        else if (s.includes('metacritic') && s.includes('user') && ENABLE_SOURCES.metacritic_user){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container, LOGO.metacritic_user, v, 'Metacritic (User)', 'metacritic_user', link);
        }
        else if (s.includes('roger') && ENABLE_SOURCES.roger_ebert)
          appendRating(container, LOGO.roger, v, 'Roger Ebert', 'roger_ebert', `https://www.rogerebert.com/reviews/${slug}`);
      });

      // Extra sources + RT fallback
      if (ENABLE_SOURCES.anilist)           fetchAniList(imdbId, container);
      if (ENABLE_SOURCES.myanimelist)       fetchMAL(imdbId, container);
      if (ENABLE_SOURCES.rotten_tomatoes)   fetchRT(imdbId, container);
    }
  });
}

/* -------- Extra sources: AniList / MAL / RT (cached) -------- */
function fetchAniList(imdbId, container){
  const q=`SELECT ?anilist WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P8729 ?anilist . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id = JSON.parse(r.responseText).results.bindings[0]?.anilist?.value;
        if (!id) return;
        const gql='query($id:Int){ Media(id:$id,type:ANIME){ id meanScore } }';
        GM_xmlhttpRequest({
          method:'POST',
          url:'https://graphql.anilist.co',
          headers:{'Content-Type':'application/json'},
          data:JSON.stringify({query:gql,variables:{id:parseInt(id,10)}}),
          onload:rr=>{
            try{
              const m = JSON.parse(rr.responseText).data?.Media;
              if (Util.validNumber(m?.meanScore))
                appendRating(container, LOGO.anilist, m.meanScore, 'AniList', 'anilist', `https://anilist.co/anime/${id}`);
            }catch{}
          }
        });
      }catch{}
    }
  });
}

function fetchMAL(imdbId, container){
  const q=`SELECT ?mal WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P4086 ?mal . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id = JSON.parse(r.responseText).results.bindings[0]?.mal?.value;
        if (!id) return;
        GM_xmlhttpRequest({
          method:'GET',
          url:`https://api.jikan.moe/v4/anime/${id}`,
          onload:rr=>{
            try{
              const d = JSON.parse(rr.responseText).data;
              if (Util.validNumber(d.score))
                appendRating(container, LOGO.myanimelist, d.score, 'MyAnimeList', 'myanimelist', `https://myanimelist.net/anime/${id}`);
            }catch{}
          }
        });
      }catch{}
    }
  });
}

function fetchRT(imdbId, container){
  const key = `${NS}rt_${imdbId}`;
  const cache = localStorage.getItem(key);
  if (cache){
    try{
      const j = JSON.parse(cache);
      if (Date.now() - j.time < CACHE_DURATION){
        addRT(container, j.scores);
        return;
      }
    }catch{}
  }

  const q=`SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id = JSON.parse(r.responseText).results.bindings[0]?.rtid?.value;
        if (!id) return;
        const path = id.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,'');
        const url  = `https://www.rottentomatoes.com/${path}`;
        GM_xmlhttpRequest({
          method:'GET', url,
          onload:rr=>{
            try{
              const m = rr.responseText.match(/<script\s+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/);
              if (!m) return;
              const d = JSON.parse(m[1]);
              const critic   = parseFloat(d.criticsScore?.score);
              const audience = parseFloat(d.audienceScore?.score);
              const scores = { critic, audience, link:url };
              addRT(container, scores);
              localStorage.setItem(key, JSON.stringify({ time:Date.now(), scores }));
            }catch(e){ console.error('RT parse error', e); }
          }
        });
      }catch(e){ console.error(e); }
    }
  });

  function addRT(c, s){
    if (Util.validNumber(s.critic))
      appendRating(c, LOGO.tomatoes, s.critic, 'RT Critic', 'rotten_tomatoes_critic', s.link || '#');
    if (Util.validNumber(s.audience))
      appendRating(c, LOGO.audience, s.audience, 'RT Audience', 'rotten_tomatoes_audience', s.link || '#');
  }
}

/* -------- Main update pipeline (order matters) -------- */
function updateAll(){
  try {
    removeBuiltInEndsAt();
    ensureInlineBadge();
    ensureEndsAtInline();
    removeBuiltInEndsAt();
    scanLinks();
    updateRatings();
    applyContainerAlignmentAndSpacing();
  } catch (e) {}
}

function applyContainerAlignmentAndSpacing(){
  document.querySelectorAll('.mdblist-rating-container').forEach(div=>{
    const justify = DISPLAY.align==='center' ? 'center' : DISPLAY.align==='left' ? 'flex-start' : 'flex-end';
    const paddingRight = DISPLAY.align==='right' ? '6px' : '0';
    div.style.justifyContent = justify;
    div.style.marginTop = `${SPACING.ratingsTopGapPx}px`;
    div.style.paddingRight = paddingRight;
  });
  // Re-sort by updated priorities
  document.querySelectorAll('.mdblist-rating-container').forEach(div=>{
    [...div.children]
      .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
      .forEach(el=>div.appendChild(el));
  });
}

/* -------- Observe DOM changes once; debounce updates -------- */
const MDbl = { debounceTimer: null };
MDbl.debounce = (fn, wait=150) => { clearTimeout(MDbl.debounceTimer); MDbl.debounceTimer = setTimeout(fn, wait); };

(function observePage(){
  const obs = new MutationObserver(() => MDbl.debounce(updateAll, 150));
  obs.observe(document.body, { childList:true, subtree:true });
  updateAll(); // initial
})();

/* ======================================================
   SETTINGS UI (⚙️ bottom-right)
====================================================== */
function saveSettingsToStorage(){
  const payload = {
    sources:    ENABLE_SOURCES,
    display:    DISPLAY,
    spacing:    SPACING,
    priorities: RATING_PRIORITY
  };
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload)); }catch{}
}

function resetSettings(){
  Object.assign(ENABLE_SOURCES,  DEFAULT_ENABLE_SOURCES);
  Object.assign(DISPLAY,         DEFAULT_DISPLAY);
  Object.assign(SPACING,         DEFAULT_SPACING);
  Object.assign(RATING_PRIORITY, DEFAULT_PRIORITIES);
  saveSettingsToStorage();
  rebuildSettingsForm(); // refresh UI
  refreshAll();
}

function refreshAll(){
  // Remove existing containers to fully re-render with new settings
  document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove());
  // Remove inline parental and ends-at to rebuild
  document.getElementById('mdblistInlineParental')?.remove();
  document.getElementById('customEndsAt')?.remove();
  updateAll();
}

function ensureSettingsUI(){
  if (document.getElementById('mdbl-settings-fab')) return;

  // FAB (gear)
  const fab = document.createElement('div');
  fab.id = 'mdbl-settings-fab';
  fab.title = 'Jellyfin Ratings — Settings';
  fab.innerHTML = '⚙️';
  document.body.appendChild(fab);

  // Overlay + Panel
  const overlay = document.createElement('div');
  overlay.id = 'mdbl-settings-overlay';
  const panel = document.createElement('div');
  panel.id = 'mdbl-settings-panel';
  panel.innerHTML = `
    <header>
      <span>Jellyfin Ratings — Settings</span>
      <button class="mdbl-btn" id="mdbl-close">Close</button>
    </header>
    <section id="mdbl-sect-sources">
      <h3>Sources</h3>
      <div class="mdbl-grid" id="mdbl-sources-grid"></div>
      <p class="mdbl-note">Enable/disable rating sources. RT covers both Critic & Audience.</p>
    </section>
    <section id="mdbl-sect-display">
      <h3>Display</h3>
      <div class="mdbl-row">
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-showPercent"> Show “%”</label>
        <span></span>
      </div>
      <div class="mdbl-row">
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-colorize"> Colorize ratings</label>
        <span></span>
      </div>
      <div class="mdbl-row">
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-colorNumsOnly"> Color numbers only (no icon glow)</label>
        <span></span>
      </div>
      <div class="mdbl-row">
        <label>Alignment
          <select id="mdbl-align" class="mdbl-input mdbl-select">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <span></span>
      </div>
      <div class="mdbl-row">
        <label>“Ends at …” format
          <select id="mdbl-endsFmt" class="mdbl-input mdbl-select">
            <option value="24h">24h</option>
            <option value="12h">12h</option>
          </select>
        </label>
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-endsBullet"> Bullet before “Ends at …”</label>
      </div>
    </section>
    <section id="mdbl-sect-spacing">
      <h3>Spacing</h3>
      <div class="mdbl-row">
        <label>Ratings top gap (px)</label>
        <input type="number" id="mdbl-gap" min="0" max="48" step="1" class="mdbl-input mdbl-num">
      </div>
    </section>
    <section id="mdbl-sect-prio">
      <h3>Sort Priority</h3>
      <div class="mdbl-grid" id="mdbl-prio-grid"></div>
      <p class="mdbl-note">Lower numbers appear earlier.</p>
    </section>
    <section id="mdbl-sect-io">
      <h3>Export / Import</h3>
      <div class="mdbl-row">
        <button class="mdbl-btn" id="mdbl-export">Export JSON</button>
        <input type="file" id="mdbl-import-file" accept="application/json" class="mdbl-input">
      </div>
      <textarea id="mdbl-import-text" class="mdbl-input" rows="4" placeholder="Paste settings JSON here..."></textarea>
    </section>
    <div class="mdbl-actions">
      <button class="mdbl-btn primary" id="mdbl-apply">Save & Apply</button>
      <button class="mdbl-btn warn" id="mdbl-reset">Reset to Defaults</button>
    </div>
  `;
  document.body.append(overlay, panel);

  // Build dynamic content
  rebuildSettingsForm();

  // Wiring
  const open = ()=>{ overlay.style.display='block'; panel.style.display='block'; };
  const close= ()=>{ overlay.style.display='none';  panel.style.display='none';  };
  fab.addEventListener('click', open);
  overlay.addEventListener('click', close);
  panel.querySelector('#mdbl-close').addEventListener('click', close);

  // Apply
  panel.querySelector('#mdbl-apply').addEventListener('click', ()=>{
    collectSettingsFromForm(); saveSettingsToStorage(); refreshAll(); close();
  });
  // Reset
  panel.querySelector('#mdbl-reset').addEventListener('click', resetSettings);

  // Export
  panel.querySelector('#mdbl-export').addEventListener('click', ()=>{
    const payload = {
      sources:ENABLE_SOURCES, display:DISPLAY, spacing:SPACING, priorities:RATING_PRIORITY
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='jellyfin_ratings_settings.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  });

  // Import file
  panel.querySelector('#mdbl-import-file').addEventListener('change', (ev)=>{
    const f = ev.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      try{
        const j = JSON.parse(rd.result);
        applyImportedSettings(j); rebuildSettingsForm(); saveSettingsToStorage(); refreshAll();
      }catch(e){ alert('Invalid JSON'); }
    };
    rd.readAsText(f);
  });

  // Import textarea
  panel.querySelector('#mdbl-import-text').addEventListener('change', (ev)=>{
    const txt = ev.target.value;
    if (!txt.trim()) return;
    try{
      const j = JSON.parse(txt);
      applyImportedSettings(j); rebuildSettingsForm(); saveSettingsToStorage(); refreshAll();
    }catch(e){ alert('Invalid JSON'); }
  });
}

function applyImportedSettings(j){
  if (j.sources)    Object.assign(ENABLE_SOURCES, j.sources);
  if (j.display)    Object.assign(DISPLAY, j.display);
  if (j.spacing)    Object.assign(SPACING, j.spacing);
  if (j.priorities) Object.assign(RATING_PRIORITY, j.priorities);
}

function rebuildSettingsForm(){
  const panel = document.getElementById('mdbl-settings-panel');
  if (!panel) return;

  // Sources
  const sg = panel.querySelector('#mdbl-sources-grid');
  sg.innerHTML = '';
  const sourceLabels = {
    imdb:'IMDb', tmdb:'TMDb', trakt:'Trakt', letterboxd:'Letterboxd',
    rotten_tomatoes:'Rotten Tomatoes (Critic+Audience)', roger_ebert:'Roger Ebert',
    anilist:'AniList', myanimelist:'MyAnimeList',
    metacritic_critic:'Metacritic (Critic)', metacritic_user:'Metacritic (User)'
  };
  Object.keys(DEFAULT_ENABLE_SOURCES).forEach(k=>{
    const rowLabel = document.createElement('label');
    rowLabel.innerHTML = `<input type="checkbox" class="mdbl-checkbox" data-src="${k}"> ${sourceLabels[k]||k}`;
    const valWrap = document.createElement('div'); // empty second column
    sg.append(rowLabel, valWrap);
    rowLabel.querySelector('input').checked = !!ENABLE_SOURCES[k];
  });

  // Display
  panel.querySelector('#mdbl-showPercent').checked  = !!DISPLAY.showPercentSymbol;
  panel.querySelector('#mdbl-colorize').checked     = !!DISPLAY.colorizeRatings;
  panel.querySelector('#mdbl-colorNumsOnly').checked= !!DISPLAY.colorizeNumbersOnly;
  panel.querySelector('#mdbl-align').value          = DISPLAY.align || 'left';
  panel.querySelector('#mdbl-endsFmt').value        = DISPLAY.endsAtFormat || '24h';
  panel.querySelector('#mdbl-endsBullet').checked   = !!DISPLAY.endsAtBullet;

  // Spacing
  panel.querySelector('#mdbl-gap').value = Number(SPACING.ratingsTopGapPx||0);

  // Priorities
  const pg = panel.querySelector('#mdbl-prio-grid');
  pg.innerHTML = '';
  const prioKeys = Object.keys(DEFAULT_PRIORITIES);
  prioKeys.forEach(k=>{
    const lab = document.createElement('label'); lab.textContent = k.replace(/_/g,' ');
    const inp = document.createElement('input');
    inp.type='number'; inp.step='1'; inp.className='mdbl-input mdbl-num';
    inp.dataset.prio = k; inp.value = Number(RATING_PRIORITY[k] ?? 999);
    pg.append(lab, inp);
  });
}

function collectSettingsFromForm(){
  const panel = document.getElementById('mdbl-settings-panel');
  if (!panel) return;

  // Sources
  panel.querySelectorAll('[data-src]').forEach(cb=>{
    const key = cb.getAttribute('data-src');
    ENABLE_SOURCES[key] = cb.checked;
  });

  // Display
  DISPLAY.showPercentSymbol   = panel.querySelector('#mdbl-showPercent').checked;
  DISPLAY.colorizeRatings     = panel.querySelector('#mdbl-colorize').checked;
  DISPLAY.colorizeNumbersOnly = panel.querySelector('#mdbl-colorNumsOnly').checked;
  DISPLAY.align               = panel.querySelector('#mdbl-align').value;
  DISPLAY.endsAtFormat        = panel.querySelector('#mdbl-endsFmt').value;
  DISPLAY.endsAtBullet        = panel.querySelector('#mdbl-endsBullet').checked;

  // Spacing// ==UserScript==
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
  const gap = parseInt(panel.querySelector('#mdbl-gap').value,10);
  SPACING.ratingsTopGapPx = Number.isFinite(gap) ? Math.max(0, Math.min(48, gap)) : DEFAULT_SPACING.ratingsTopGapPx;

  // Priorities
  panel.querySelectorAll('[data-prio]').forEach(inp=>{
    const k = inp.getAttribute('data-prio');
    let v = parseInt(inp.value,10);
    if (!Number.isFinite(v)) v = 999;
    RATING_PRIORITY[k] = v;
  });
}

// Only show FAB on “items” pages (try to be conservative)
function shouldShowFab(){
  // If the page has any Jellyfin media info rows, we’re likely on an item page
  return !!document.querySelector('.itemMiscInfo');
}

(function initSettingsOnce(){
  const tick = () => {
    if (!document.body) return requestAnimationFrame(tick);
    if (shouldShowFab()) ensureSettingsUI();
    else setTimeout(initSettingsOnce, 800); // try again when navigating
  };
  tick();
})();
})(); // end IIFE
