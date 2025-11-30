// ==UserScript==
// @name         Jellyfin Ratings (v10.1.26 — Direct Metadata API)
// @namespace    https://mdblist.com
// @version      10.1.26
// @description  Master Rating links to Wikipedia. Gear icon first. Hides default ratings. Fetches IDs directly from Jellyfin Server API (No scraping).
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

console.log('[Jellyfin Ratings] v10.1.26 loading...');

/* ==========================================================================
   1. CONFIGURATION
========================================================================== */

const NS = 'mdbl_';
const DEFAULTS = {
    sources: {
        master: true, imdb: true, tmdb: true, trakt: true, letterboxd: true,
        rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
        metacritic_critic: true, metacritic_user: true, roger_ebert: true,
        anilist: true, myanimelist: true
    },
    display: {
        showPercentSymbol: true, colorNumbers: true, colorIcons: false,
        posX: 0, posY: 0,
        colorBands: { redMax: 50, orangeMax: 69, ygMax: 79 },
        colorChoice: { red: 0, orange: 2, yg: 3, mg: 0 },
        endsAt24h: true
    },
    spacing: { ratingsTopGapPx: 4 },
    priorities: {
        master: -1, imdb: 1, tmdb: 2, trakt: 3, letterboxd: 4,
        rotten_tomatoes_critic: 5, rotten_tomatoes_audience: 6,
        roger_ebert: 7, metacritic_critic: 8, metacritic_user: 9,
        anilist: 10, myanimelist: 11
    }
};

const SCALE = {
    master: 1, imdb: 10, tmdb: 1, trakt: 1, letterboxd: 20, roger_ebert: 25,
    metacritic_critic: 1, metacritic_user: 10, myanimelist: 10, anilist: 1,
    rotten_tomatoes_critic: 1, rotten_tomatoes_audience: 1
};

const SWATCHES = {
    red:    ['#e53935', '#f44336', '#d32f2f', '#c62828'],
    orange: ['#fb8c00', '#f39c12', '#ffa726', '#ef6c00'],
    yg:     ['#9ccc65', '#c0ca33', '#aeea00', '#cddc39'],
    mg:     ['#43a047', '#66bb6a', '#388e3c', '#81c784']
};

const PALETTE_NAMES = {
    red:    ['Alert Red', 'Tomato', 'Crimson', 'Deep Red'],
    orange: ['Amber', 'Signal Orange', 'Apricot', 'Burnt Orange'],
    yg:     ['Lime Leaf', 'Citrus', 'Chartreuse', 'Soft Lime'],
    mg:     ['Emerald', 'Leaf Green', 'Forest', 'Mint']
};

const CACHE_DURATION_API = 24 * 60 * 60 * 1000;
const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';

const LOGO = {
    master: `${ICON_BASE}/master.png`, imdb: `${ICON_BASE}/IMDb.png`, tmdb: `${ICON_BASE}/TMDB.png`,
    trakt: `${ICON_BASE}/Trakt.png`, letterboxd: `${ICON_BASE}/letterboxd.png`, anilist: `${ICON_BASE}/anilist.png`,
    myanimelist: `${ICON_BASE}/mal.png`, roger_ebert: `${ICON_BASE}/Roger_Ebert.png`,
    rotten_tomatoes_critic: `${ICON_BASE}/Rotten_Tomatoes.png`,
    rotten_tomatoes_audience: `${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
    metacritic_critic: `${ICON_BASE}/Metacritic.png`, metacritic_user: `${ICON_BASE}/mus2.png`
};

const LABEL = {
    master: 'Master Rating', imdb: 'IMDb', tmdb: 'TMDb', trakt: 'Trakt', letterboxd: 'Letterboxd',
    rotten_tomatoes_critic: 'Rotten Tomatoes (Critic)', rotten_tomatoes_audience: 'Rotten Tomatoes (Audience)',
    metacritic_critic: 'Metacritic (Critic)', metacritic_user: 'Metacritic (User)',
    roger_ebert: 'Roger Ebert', anilist: 'AniList', myanimelist: 'MyAnimeList'
};

let CFG = loadConfig();
let currentImdbId = null;

function loadConfig() {
    try {
        const raw = localStorage.getItem(`${NS}prefs`);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
        const p = JSON.parse(raw);
        if (p.display && (isNaN(parseInt(p.display.posX)) || isNaN(parseInt(p.display.posY)))) {
            p.display.posX = 0; p.display.posY = 0;
        }
        if (p.display.posX > 500) p.display.posX = 500;
        if (p.display.posX < -700) p.display.posX = -700;
        if (p.display.posY > 500) p.display.posY = 500;
        if (p.display.posY < -500) p.display.posY = -500;
        return {
            sources: { ...DEFAULTS.sources, ...p.sources },
            display: { ...DEFAULTS.display, ...p.display, colorBands: { ...DEFAULTS.display.colorBands, ...p.display?.colorBands }, colorChoice: { ...DEFAULTS.display.colorChoice, ...p.display?.colorChoice } },
            spacing: { ...DEFAULTS.spacing, ...p.spacing },
            priorities: { ...DEFAULTS.priorities, ...p.priorities }
        };
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function saveConfig() {
    try { localStorage.setItem(`${NS}prefs`, JSON.stringify(CFG)); } catch (e) {}
}

const INJ_KEYS = (window.MDBL_KEYS || {});
const LS_KEYS = JSON.parse(localStorage.getItem(`${NS}keys`) || '{}');
const API_KEY = String(INJ_KEYS.MDBLIST || LS_KEYS.MDBLIST || 'hehfnbo9y8blfyqm1d37ikubl');

/* ==========================================================================
   2. UTILITIES & STYLES
========================================================================== */

if (typeof GM_xmlhttpRequest === 'undefined') {
    const PROXIES = ['https://api.allorigins.win/raw?url=', 'https://api.codetabs.com/v1/proxy?quest='];
    window.GM_xmlhttpRequest = ({ method = 'GET', url, onload, onerror }) => {
        const useProxy = !url.includes('mdblist.com') && !url.includes('graphql.anilist.co');
        const finalUrl = useProxy ? PROXIES[Math.floor(Math.random() * PROXIES.length)] + encodeURIComponent(url) : url;
        fetch(finalUrl).then(r => r.text().then(t => onload && onload({ status: r.status, responseText: t }))).catch(e => onerror && onerror(e));
    };
}

const localSlug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const styleEl = document.createElement('style');
styleEl.id = 'mdbl-dynamic-styles';
document.head.appendChild(styleEl);

function updateGlobalStyles() {
    document.documentElement.style.setProperty('--mdbl-x', `${CFG.display.posX}px`);
    document.documentElement.style.setProperty('--mdbl-y', `${CFG.display.posY}px`);

    let rules = `
        .mdblist-rating-container {
            display: flex; flex-wrap: wrap; align-items: center;
            justify-content: flex-end; 
            width: 100%; margin-top: ${CFG.spacing.ratingsTopGapPx}px;
            box-sizing: border-box;
            transform: translate(var(--mdbl-x), var(--mdbl-y));
            z-index: 2147483647; position: relative; 
            pointer-events: auto !important; 
            flex-shrink: 0;
            min-height: 24px;
        }
        .mdbl-rating-item {
            display: inline-flex; align-items: center; margin: 0 6px; gap: 6px;
            text-decoration: none;
            transition: transform 0.2s ease;
            cursor: pointer;
            color: inherit;
        }
        .mdbl-rating-item:hover { transform: scale(1.15) rotate(2deg); z-index: 2147483647; }
        .mdbl-rating-item img { height: 1.3em; vertical-align: middle; }
        .mdbl-rating-item span { font-size: 1em; vertical-align: middle; }
        
        .mdbl-settings-btn {
            opacity: 0.6; margin-right: 8px; border-right: 1px solid rgba(255,255,255,0.2); 
            padding: 4px 8px 4px 0; cursor: pointer !important; pointer-events: auto !important;
            order: -9999 !important; display: inline-flex;
        }
        .mdbl-settings-btn:hover { opacity: 1; transform: scale(1.1); }
        .mdbl-settings-btn svg { width: 1.2em; height: 1.2em; fill: currentColor; }
        
        /* Scan Indicator */
        .mdbl-scan-dot {
            animation: mdbl-blink 1s infinite;
            font-size: 18px; line-height: 10px; opacity: 0.5; margin-right: 5px; color: #fff;
        }
        .mdbl-scan-error { color: #e53935; font-weight: bold; font-size: 12px; margin-right: 5px; cursor: help; }
        @keyframes mdbl-blink { 0% {opacity:0.2} 50% {opacity:0.8} 100% {opacity:0.2} }

        .itemMiscInfo, .mainDetailRibbon, .detailRibbon { overflow: visible !important; contain: none !important; position: relative; z-index: 10; }
        #customEndsAt { font-size: inherit; opacity: 0.9; cursor: default; margin-left: 10px; display: inline-block; padding: 2px 4px; }
        
        .mediaInfoOfficialRating { display: inline-flex !important; margin-right: 14px; }
        .starRatingContainer, .mediaInfoCriticRating, .mediaInfoAudienceRating, .starRating { display: none !important; }
    `;

    Object.keys(CFG.priorities).forEach(key => {
        const isEnabled = CFG.sources[key];
        const order = CFG.priorities[key];
        rules += `.mdbl-rating-item[data-source="${key}"] { display: ${isEnabled ? 'inline-flex' : 'none'}; order: ${order}; }`;
    });
    styleEl.textContent = rules;
}

function getRatingColor(bands, choice, r) {
    bands = bands || { redMax: 50, orangeMax: 69, ygMax: 79 };
    choice = choice || { red: 0, orange: 0, yg: 0, mg: 0 };
    let band = 'mg';
    if (r <= bands.redMax) band = 'red';
    else if (r <= bands.orangeMax) band = 'orange';
    else if (r <= bands.ygMax) band = 'yg';
    const idx = Math.max(0, Math.min(3, choice[band] || 0));
    return SWATCHES[band][idx];
}

function refreshDomElements() {
    updateGlobalStyles(); 
    document.querySelectorAll('.mdbl-rating-item:not(.mdbl-settings-btn)').forEach(el => {
        const score = parseFloat(el.dataset.score);
        if (isNaN(score)) return;
        const color = getRatingColor(CFG.display.colorBands, CFG.display.colorChoice, score);
        const img = el.querySelector('img');
        const span = el.querySelector('span');
        if (CFG.display.colorIcons) img.style.filter = `drop-shadow(0 0 3px ${color})`;
        else img.style.filter = '';
        if (CFG.display.colorNumbers) span.style.color = color;
        else span.style.color = '';
        const text = CFG.display.showPercentSymbol ? `${Math.round(score)}%` : `${Math.round(score)}`;
        if (span.textContent !== text) span.textContent = text;
    });
    updateEndsAt();
}

updateGlobalStyles();

/* ==========================================================================
   3. MAIN LOGIC
========================================================================== */

function fixUrl(url, domain) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    const clean = url.startsWith('/') ? url.substring(1) : url;
    return `https://${domain}/${clean}`;
}

function openSettingsMenu() {
    if (window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS();
    else { initMenu(); if (window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS(); }
}

function formatTime(minutes) {
    const d = new Date(Date.now() + minutes * 60000);
    const opts = CFG.display.endsAt24h 
        ? { hour: '2-digit', minute: '2-digit', hour12: false } 
        : { hour: 'numeric', minute: '2-digit', hour12: true };
    return d.toLocaleTimeString([], opts);
}

function parseRuntimeToMinutes(text) {
    if (!text) return 0;
    let m = text.match(/(?:(\d+)\s*(?:h|hr|std?)\w*\s*)?(?:(\d+)\s*(?:m|min)\w*)?/i);
    if (m && (m[1] || m[2])) {
        const h = parseInt(m[1] || '0', 10);
        const min = parseInt(m[2] || '0', 10);
        if (h > 0 || min > 0) return h * 60 + min;
    }
    m = text.match(/(\d+)\s*(?:m|min)\w*/i);
    if (m) return parseInt(m[1], 10);
    return 0;
}

function updateEndsAt() {
    const allWrappers = document.querySelectorAll('.itemMiscInfo');
    let primary = null;
    for (const el of allWrappers) {
        if (el.offsetParent !== null) { primary = el; break; }
    }
    if (!primary) return; 

    let minutes = 0;
    const detailContainer = primary.closest('.detailRibbon') || primary.closest('.mainDetailButtons') || primary.parentNode;
    if (detailContainer) {
        const walker = document.createTreeWalker(detailContainer, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            const val = node.nodeValue.trim();
            if (val.length > 0 && val.length < 20 && /\d/.test(val)) {
                const p = parseRuntimeToMinutes(val);
                if (p > 0) { minutes = p; break; }
            }
        }
    }
    
    const parent = primary.parentNode;
    if (parent) {
        parent.querySelectorAll('.itemMiscInfo-secondary, .itemMiscInfo span, .itemMiscInfo div').forEach(el => {
            if (el.id === 'customEndsAt' || el.closest('.mdblist-rating-container') || el.classList.contains('mediaInfoOfficialRating')) return;
            const t = (el.textContent || '').toLowerCase();
            if (t.includes('ends at') || t.includes('endet um') || t.includes('endet am')) {
                 if (minutes > 0) el.style.display = 'none';
                 else el.style.display = ''; 
            }
        });
    }
    document.querySelectorAll('.starRatingContainer, .mediaInfoCriticRating, .mediaInfoAudienceRating').forEach(el => el.style.display = 'none');

    if (minutes > 0) {
        const timeStr = formatTime(minutes);
        let span = primary.querySelector('#customEndsAt');
        if (!span) {
            span = document.createElement('div');
            span.id = 'customEndsAt';
            const rc = primary.querySelector('.mdblist-rating-container');
            if (rc && rc.nextSibling) primary.insertBefore(span, rc.nextSibling);
            else primary.appendChild(span);
        }
        span.textContent = `Ends at ${timeStr}`;
        span.style.display = ''; 
    } else {
        const span = primary.querySelector('#customEndsAt');
        if(span) span.remove();
    }
}

function createRatingHtml(key, val, link, count, title, kind) {
    if (val === null || isNaN(val)) return '';
    if (!LOGO[key]) return '';
    const n = parseFloat(val) * (SCALE[key] || 1);
    const r = Math.round(n);
    const tooltip = (count && count > 0) ? `${title} — ${count.toLocaleString()} ${kind||'Votes'}` : title;
    const safeLink = (link && link !== '#' && !link.startsWith('http://192')) ? link : '#';
    const style = safeLink === '#' ? 'cursor:default;' : '';
    return `<a href="${safeLink}" target="_blank" class="mdbl-rating-item" data-source="${key}" data-score="${r}" style="${style}" title="${tooltip}"><img src="${LOGO[key]}" alt="${title}"><span>${CFG.display.showPercentSymbol ? r+'%' : r}</span></a>`;
}

function renderGearIcon(container) {
    if (container.querySelector('.mdbl-settings-btn')) return;
    container.innerHTML = `
    <div class="mdbl-rating-item mdbl-settings-btn" title="Settings" style="order: -9999 !important;" onclick="event.preventDefault(); event.stopPropagation(); window.MDBL_OPEN_SETTINGS_GL();"><svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></div>
    <span class="mdbl-scan-dot" title="Fetching IDs from Jellyfin...">...</span>`;
    updateGlobalStyles();
}

function renderRatings(container, data, pageImdbId, type) {
    let html = `
    <div class="mdbl-rating-item mdbl-settings-btn" title="Settings" style="order: -9999 !important;" onclick="event.preventDefault(); event.stopPropagation(); window.MDBL_OPEN_SETTINGS_GL();"><svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></div>`;

    const add = (k, v, lnk, cnt, tit, kind) => html += createRatingHtml(k, v, lnk, cnt, tit, kind);
    const ids = { imdb: data.imdbid || data.imdb_id || pageImdbId, tmdb: data.id || data.tmdbid || data.tmdb_id, trakt: data.traktid || data.trakt_id, slug: data.slug || data.ids?.slug };
    const fallbackSlug = localSlug(data.title || '');
    const metaType = type === 'show' ? 'tv' : 'movie';
    let masterSum = 0, masterCount = 0;
    const trackMaster = (val, scaleKey) => { if (val !== null && !isNaN(parseFloat(val))) { masterSum += parseFloat(val) * (SCALE[scaleKey] || 1); masterCount++; } };

    if (data.ratings) {
        data.ratings.forEach(r => {
            const s = (r.source || '').toLowerCase();
            const v = r.value, c = r.votes || r.count, apiLink = r.url;
            if (s.includes('imdb')) { add('imdb', v, ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : apiLink, c, 'IMDb', 'Votes'); trackMaster(v, 'imdb'); }
            else if (s.includes('tmdb')) { add('tmdb', v, ids.tmdb ? `https://www.themoviedb.org/${type}/${ids.tmdb}` : '#', c, 'TMDb', 'Votes'); trackMaster(v, 'tmdb'); }
            else if (s.includes('trakt')) { add('trakt', v, ids.imdb ? `https://trakt.tv/search/imdb/${ids.imdb}` : '#', c, 'Trakt', 'Votes'); trackMaster(v, 'trakt'); }
            else if (s.includes('letterboxd')) { add('letterboxd', v, ids.imdb ? `https://letterboxd.com/imdb/${ids.imdb}/` : fixUrl(apiLink, 'letterboxd.com'), c, 'Letterboxd', 'Votes'); trackMaster(v, 'letterboxd'); }
            else if (s.includes('tomatoes') || s.includes('rotten')) {
                if(s.includes('audience') || s.includes('popcorn')) { add('rotten_tomatoes_audience', v, fixUrl(apiLink, 'rottentomatoes.com'), c, 'RT Audience', 'Ratings'); trackMaster(v, 'rotten_tomatoes_audience'); }
                else { add('rotten_tomatoes_critic', v, fixUrl(apiLink, 'rottentomatoes.com'), c, 'RT Critic', 'Reviews'); trackMaster(v, 'rotten_tomatoes_critic'); }
            }
            else if (s.includes('metacritic')) {
                const lnk = fallbackSlug ? `https://www.metacritic.com/${metaType}/${fallbackSlug}` : `https://www.metacritic.com/search/all/${encodeURIComponent(data.title||'')}/results`;
                if(s.includes('user')) { add('metacritic_user', v, lnk, c, 'User', 'Ratings'); trackMaster(v, 'metacritic_user'); }
                else { add('metacritic_critic', v, lnk, c, 'Metacritic', 'Reviews'); trackMaster(v, 'metacritic_critic'); }
            }
            else if (s.includes('roger')) { add('roger_ebert', v, fixUrl(apiLink, 'rogerebert.com'), c, 'Roger Ebert', 'Reviews'); trackMaster(v, 'roger_ebert'); }
            else if (s.includes('anilist')) { add('anilist', v, fixUrl(apiLink, 'anilist.co'), c, 'AniList', 'Votes'); trackMaster(v, 'anilist'); }
            else if (s.includes('myanimelist')) { add('myanimelist', v, fixUrl(apiLink, 'myanimelist.net'), c, 'MAL', 'Votes'); trackMaster(v, 'myanimelist'); }
        });
    }

    if (masterCount > 0) {
        const avg = masterSum / masterCount;
        const wikiUrl = `https://duckduckgo.com/?q=!ducky+site:en.wikipedia.org+${encodeURIComponent(data.title || '')}+${(data.year || '')}+${type === 'movie' ? 'film' : 'TV series'}`;
        add('master', avg, wikiUrl, masterCount, 'Master Rating', 'Sources');
    }

    container.innerHTML = html;
    refreshDomElements();
}

function fetchRatings(container, id, type, apiMode) {
    if (container.dataset.fetching === 'true') return;
    const apiUrl = (apiMode === 'imdb') ? `https://api.mdblist.com/imdb/${id}?apikey=${API_KEY}` : `https://api.mdblist.com/tmdb/${type}/${id}?apikey=${API_KEY}`;
    const cacheKey = `${NS}c_${id}`;
    
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const c = JSON.parse(cached);
            if (Date.now() - c.ts < CACHE_DURATION_API) { renderRatings(container, c.data, currentImdbId, type); return; }
        }
    } catch(e) {}

    container.dataset.fetching = 'true';
    GM_xmlhttpRequest({
        method: 'GET', url: apiUrl,
        onload: r => {
            container.dataset.fetching = 'false';
            if (r.status !== 200) { 
                console.error('[MDBList] API Error:', r.status);
                const dot = container.querySelector('.mdbl-scan-dot');
                if(dot) { dot.textContent = '✖'; dot.className = 'mdbl-scan-error'; dot.title = 'MDBList API Error: ' + r.status; }
                return;
            }
            try {
                const d = JSON.parse(r.responseText);
                localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: d }));
                renderRatings(container, d, currentImdbId, type);
            } catch(e) { console.error('[MDBList] Parse Error', e); }
        },
        onerror: e => { container.dataset.fetching = 'false'; console.error('[MDBList] Net Error', e); }
    });
}

// === DIRECT METADATA API ENGINE ===

function getJellyfinId() {
    const url = window.location.hash || window.location.search;
    const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : url);
    return params.get('id');
}

function fetchJellyfinMetadata(itemId, container) {
    if(!itemId) return;
    // Try to fetch from Jellyfin API directly (/Users/Me/Items/{Id})
    const url = `${window.location.origin}/Users/Me/Items/${itemId}`;
    fetch(url).then(r => r.json()).then(data => {
        let extId = null, mode = 'tmdb', type = 'movie';
        
        if (data.Type === 'Series' || data.Type === 'Episode') type = 'show';
        
        if (data.ProviderIds && data.ProviderIds.Tmdb) {
            extId = data.ProviderIds.Tmdb;
            mode = 'tmdb';
        } else if (data.ProviderIds && data.ProviderIds.Imdb) {
            extId = data.ProviderIds.Imdb;
            mode = 'imdb';
        }

        if (extId) {
            container.dataset.tmdbId = extId;
            fetchRatings(container, extId, type, mode);
        } else {
            console.log('[MDBList] No External IDs found in Jellyfin Metadata.');
            const dot = container.querySelector('.mdbl-scan-dot');
            if(dot) { dot.textContent = '?'; dot.title = 'No TMDB/IMDb ID found'; }
        }
    }).catch(e => {
        console.error('[MDBList] Jellyfin API Fetch failed', e);
        // Fallback to DOM scraping if API fails
        fallbackDomScrape(container);
    });
}

function fallbackDomScrape(container) {
    let type = 'movie', id = null, mode = 'tmdb';
    for (let i = 0; i < document.links.length; i++) {
        const href = document.links[i].href;
        if (href.includes('themoviedb.org')) {
            const m = href.match(/\/(movie|tv)\/(\d+)/);
            if (m) { type = m[1] === 'tv' ? 'show' : 'movie'; id = m[2]; mode = 'tmdb'; break; }
        }
    }
    if (!id) {
        for (let i = 0; i < document.links.length; i++) {
            const href = document.links[i].href;
            if (href.includes('imdb.com/title/')) {
                const m = href.match(/tt\d+/);
                if (m) { id = m[0]; mode = 'imdb'; break; }
            }
        }
    }
    if (id) {
        container.dataset.tmdbId = id;
        fetchRatings(container, id, type, mode);
    }
}

function scan() {
    updateEndsAt();
    const currentJellyfinId = getJellyfinId();
    const allWrappers = document.querySelectorAll('.itemMiscInfo');
    let wrapper = null;
    for (const el of allWrappers) { if (el.offsetParent !== null) { wrapper = el; break; } }
    if (!wrapper) return;

    let container = wrapper.querySelector('.mdblist-rating-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'mdblist-rating-container';
        container.dataset.jellyfinId = currentJellyfinId;
        wrapper.appendChild(container);
        renderGearIcon(container);
        if (currentJellyfinId) fetchJellyfinMetadata(currentJellyfinId, container);
    } else if (container.dataset.jellyfinId !== currentJellyfinId) {
        container.innerHTML = '';
        renderGearIcon(container);
        container.dataset.jellyfinId = currentJellyfinId;
        container.dataset.fetching = 'false';
        if (currentJellyfinId) fetchJellyfinMetadata(currentJellyfinId, container);
    }
}

setInterval(scan, 500);

/* ==========================================================================
   4. SETTINGS MENU (INIT) - [Compact]
========================================================================== */
function initMenu(){if(document.getElementById("mdbl-panel"))return;const e=document.createElement("style");e.textContent=`
:root{--mdbl-right-col:48px}#mdbl-panel{position:fixed;right:16px;bottom:70px;width:500px;max-height:90vh;overflow:auto;border-radius:14px;border:1px solid rgba(255,255,255,.15);background:rgba(22,22,26,.94);backdrop-filter:blur(8px);color:#eaeaea;z-index:100000;box-shadow:0 20px 40px rgba(0,0,0,.45);display:none;font-family:sans-serif}#mdbl-panel header{position:sticky;top:0;background:rgba(22,22,26,.98);padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:8px;cursor:move;z-index:999;font-weight:700;justify-content:space-between}#mdbl-close{width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:0 0;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:0;border-radius:6px}#mdbl-close:hover{background:rgba(255,255,255,.06);color:#fff}#mdbl-panel .mdbl-section{padding:2px 12px;gap:2px;display:flex;flex-direction:column}#mdbl-panel .mdbl-subtle{color:#9aa0a6;font-size:12px}#mdbl-panel .mdbl-row,#mdbl-panel .mdbl-source{display:grid;grid-template-columns:1fr var(--mdbl-right-col);align-items:center;gap:5px;padding:2px 6px;border-radius:6px;min-height:32px}#mdbl-panel .mdbl-row{background:0 0;border:1px solid rgba(255,255,255,.06);box-sizing:border-box}.mdbl-slider-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:4px 6px;border-radius:6px;background:0 0;border:1px solid rgba(255,255,255,.06);min-height:32px}.mdbl-slider-row>span{white-space:nowrap;width:110px;flex-shrink:0}.mdbl-slider-row .slider-wrapper{flex-grow:1;display:flex;align-items:center;gap:10px;justify-content:flex-end;width:100%}#mdbl-panel input[type=checkbox]{transform:scale(1.2);cursor:pointer;accent-color:var(--mdbl-theme)}#mdbl-panel input[type=range]{flex-grow:1;width:100%;margin:0;cursor:pointer;accent-color:var(--mdbl-theme)}#mdbl-panel input[type=text]{width:100%;padding:10px 0;border:0;background:0 0;color:#eaeaea;font-size:14px;outline:0}#mdbl-panel input.mdbl-num-input,#mdbl-panel input.mdbl-pos-input,#mdbl-panel select{padding:0 10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#121317;color:#eaeaea;height:28px;line-height:28px;font-size:12px;box-sizing:border-box;display:inline-block;color-scheme:dark}#mdbl-panel .mdbl-select{width:140px;justify-self:end}#mdbl-panel input.mdbl-pos-input{width:75px;text-align:center;font-size:14px}#mdbl-panel input.mdbl-num-input{width:60px;text-align:center}#mdbl-panel .mdbl-actions{position:sticky;bottom:0;background:rgba(22,22,26,.96);display:flex;gap:10px;padding:6px 10px;border-top:1px solid rgba(255,255,255,.08)}#mdbl-panel button{padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#1b1c20;color:#eaeaea;cursor:pointer}#mdbl-panel button.primary{background-color:var(--mdbl-theme)!important;border-color:var(--mdbl-theme)!important;color:#fff}#mdbl-sources{display:flex;flex-direction:column;gap:8px}.mdbl-source{background:#0f1115;border:1px solid rgba(255,255,255,.1);cursor:grab}.mdbl-src-left{display:flex;align-items:center;gap:10px}.mdbl-src-left img{height:16px;width:auto}.mdbl-src-left .name{font-size:13px}.mdbl-drag-handle{justify-self:start;opacity:.6;cursor:grab}#mdbl-key-box{background:#0f1115;border:1px solid rgba(255,255,255,.1);padding:10px;border-radius:12px}.mdbl-grid{display:grid;grid-template-columns:1fr;gap:10px}.mdbl-grid .grid-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:12px}.grid-right{display:flex;align-items:center;gap:8px;justify-content:flex-end}.mdbl-grid label{white-space:nowrap}.sw{display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid rgba(255,255,255,.25)}#mdbl-panel hr{border:0;border-top:1px solid rgba(255,255,255,.08);margin:4px 0}@media (max-width:600px){#mdbl-panel{width:96%!important;left:2%!important;right:2%!important;bottom:10px!important;top:auto!important;transform:none!important;max-height:80vh;--mdbl-right-col:40px}#mdbl-panel header{cursor:default}#mdbl-panel .mdbl-row,#mdbl-panel .mdbl-source{min-height:42px;padding:4px 8px}#mdbl-panel .mdbl-select{width:140px}}`,document.head.appendChild(e);const t=document.createElement("div");t.id="mdbl-panel",document.body.appendChild(t),window.MDBL_OPEN_SETTINGS=()=>{const e=getComputedStyle(document.documentElement).getPropertyValue("--theme-primary-color").trim()||"#2a6df4";t.style.setProperty("--mdbl-theme",e),renderMenuContent(t),t.style.display="block"};let n=!1,l,a,o,i;t.addEventListener("mousedown",e=>{window.innerWidth<=600||["INPUT","SELECT","BUTTON"].includes(e.target.tagName)||e.target.closest(".sec")||e.target.closest(".mdbl-section")||(n=!0,{left:l,top:a}=t.getBoundingClientRect(),o=e.clientX,i=e.clientY,t.style.right="auto",t.style.bottom="auto",t.style.left=l+"px",t.style.top=a+"px")}),document.addEventListener("mousemove",e=>{n&&(t.style.left=l+(e.clientX-o)+"px",t.style.top=a+(e.clientY-i)+"px")}),document.addEventListener("mouseup",()=>n=!1),document.addEventListener("mousedown",e=>{"block"===t.style.display&&!t.contains(e.target)&&"customEndsAt"!==e.target.id&&!e.target.closest(".mdbl-settings-btn")&&(t.style.display="none")})}function renderMenuContent(e){const t=(e,t)=>`<div class="mdbl-row"><span>${e}</span>${t}</div>`,n=(e,t,n,l,a,o)=>`\n    <div class="mdbl-slider-row">\n        <span>${e}</span>\n        <div class="slider-wrapper">\n            <input type="range" id="${t}" min="${l}" max="${a}" value="${o}">\n            <input type="number" id="${n}" value="${o}" class="mdbl-pos-input">\n        </div>\n    </div>\n    `;let l=`\n    <header>\n      <h3>Settings</h3>\n      <button id="mdbl-close">✕</button>\n    </header>\n    <div class="mdbl-section" id="mdbl-sec-keys">\n       ${!INJ_KEYS.MDBLIST&&!JSON.parse(localStorage.getItem("mdbl_keys")||"{}").MDBLIST?`<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" placeholder="MDBList API key" value="${JSON.parse(localStorage.getItem("mdbl_keys")||"{}").MDBLIST||""}"></div>`:""}\n    </div>\n    <div class="mdbl-section">\n       <div class="mdbl-subtle">Sources (drag to reorder)</div>\n       <div id="mdbl-sources"></div>\n       <hr>\n    </div>\n    <div class="mdbl-section" id="mdbl-sec-display">\n        <div class="mdbl-subtle">Display</div>\n        ${t("Color numbers",`<input type="checkbox" id="d_cnum" ${CFG.display.colorNumbers?"checked":""}>`)}\n        ${t("Color icons",`<input type="checkbox" id="d_cicon" ${CFG.display.colorIcons?"checked":""}>`)}\n        ${t("Show %",`<input type="checkbox" id="d_pct" ${CFG.display.showPercentSymbol?"checked":""}>`)}\n        ${t("Enable 24h format",`<input type="checkbox" id="d_24h" ${CFG.display.endsAt24h?"checked":""}>`)}\n        \n        ${n("Position X (px)","d_x_rng","d_x_num",-700,500,CFG.display.posX)}\n        ${n("Position Y (px)","d_y_rng","d_y_num",-500,500,CFG.display.posY)}\n\n        <hr>\n        \n        <div class="mdbl-subtle">Color bands &amp; palette</div>\n        <div class="mdbl-grid">\n            ${createColorBandRow("th_red","Rating",CFG.display.colorBands.redMax,"red")}\n            ${createColorBandRow("th_orange","Rating",CFG.display.colorBands.orangeMax,"orange")}\n            ${createColorBandRow("th_yg","Rating",CFG.display.colorBands.ygMax,"yg")}\n            <div class="grid-row">\n                <label id="label_top_tier">Top tier (≥ ${CFG.display.colorBands.ygMax+1}%)</label>\n                <div class="grid-right">\n                    <span class="sw" id="sw_mg" style="background:${SWATCHES.mg[CFG.display.colorChoice.mg]}"></span>\n                    <select id="col_mg" class="mdbl-select">${PALETTE_NAMES.mg.map((e,t)=>`<option value="${t}" ${CFG.display.colorChoice.mg===t?"selected":""}>${e}</option>`).join("")}</select>\n                </div>\n            </div>\n        </div>\n    </div>\n    <div class="mdbl-actions" style="padding-bottom:16px">\n      <button id="mdbl-btn-reset">Reset</button>\n      <button id="mdbl-btn-save" class="primary">Save & Apply</button>\n    </div>\n    `;e.innerHTML=l;const a=e.querySelector("#mdbl-sources");Object.keys(CFG.priorities).sort((e,t)=>CFG.priorities[e]-CFG.priorities[t]).forEach(e=>{if(!CFG.sources.hasOwnProperty(e))return;const t=document.createElement("div");t.className="mdbl-source mdbl-src-row",t.draggable=!0,t.dataset.key=e,t.innerHTML=`\n            <div class="mdbl-src-left">\n                <span class="mdbl-drag-handle">⋮⋮</span>\n                <img src="${LOGO[e]||""}" style="height:16px">\n                <span class="name" style="font-size:13px;margin-left:8px">${LABEL[e]}</span>\n            </div>\n            <input type="checkbox" class="src-check" ${CFG.sources[e]?"checked":""}>\n         `,a.appendChild(t)}),e.querySelector("#mdbl-close").onclick=()=>e.style.display="none";const o=()=>{CFG.display.colorNumbers=e.querySelector("#d_cnum").checked,CFG.display.colorIcons=e.querySelector("#d_cicon").checked,CFG.display.showPercentSymbol=e.querySelector("#d_pct").checked,CFG.display.endsAt24h=e.querySelector("#d_24h").checked,CFG.display.colorBands.redMax=parseInt(e.querySelector("#th_red").value)||50,CFG.display.colorBands.orangeMax=parseInt(e.querySelector("#th_orange").value)||69,CFG.display.colorBands.ygMax=parseInt(e.querySelector("#th_yg").value)||79,["red","orange","yg","mg"].forEach(t=>CFG.display.colorChoice[t]=parseInt(e.querySelector(`#col_${t}`).value)||0),e.querySelector("#label_top_tier").textContent=`Top tier (≥ ${CFG.display.colorBands.ygMax+1}%)`,["red","orange","yg","mg"].forEach(t=>e.querySelector(`#sw_${t}`).style.background=SWATCHES[t][CFG.display.colorChoice[t]]),refreshDomElements()};e.querySelectorAll("input, select").forEach(e=>{"range"===e.type||"text"===e.type||"number"===e.type?e.addEventListener("input",o):e.addEventListener("change",o)});const i=(t,n)=>{CFG.display[t]=parseInt(n),e.querySelector(`#d_${"posX"===t?"x":"y"}_rng`).value=n,e.querySelector(`#d_${"posX"===t?"x":"y"}_num`).value=n,updateGlobalStyles()},r=(t,n)=>e.querySelector(t).addEventListener("input",n);r("#d_x_rng",e=>i("posX",e.target.value)),r("#d_x_num",e=>i("posX",e.target.value)),r("#d_y_rng",e=>i("posY",e.target.value)),r("#d_y_num",e=>i("posY",e.target.value)),e.querySelectorAll(".src-check").forEach(e=>{e.addEventListener("change",e=>{CFG.sources[e.target.closest(".mdbl-source").dataset.key]=e.target.checked,updateGlobalStyles()})});let s=null;e.querySelectorAll(".mdbl-src-row").forEach(e=>{e.addEventListener("dragstart",e=>{s=e,e.dataTransfer.effectAllowed="move"}),e.addEventListener("dragover",t=>{if(t.preventDefault(),s&&s!==e){const n=e.parentNode,l=[...n.children],a=l.indexOf(s),o=l.indexOf(e);a<o?n.insertBefore(s,e.nextSibling):n.insertBefore(s,e),[...n.querySelectorAll(".mdbl-src-row")].forEach((e,t)=>CFG.priorities[e.dataset.key]=t+1),updateGlobalStyles()}})}),e.querySelector("#mdbl-btn-save").onclick=()=>{saveConfig();const t=e.querySelector("#mdbl-key-mdb");t&&t.value.trim()&&localStorage.setItem("mdbl_keys",JSON.stringify({MDBLIST:t.value.trim()})),location.reload()},e.querySelector("#mdbl-btn-reset").onclick=()=>{confirm("Reset all settings?")&&(localStorage.removeItem("mdbl_prefs"),location.reload())};const d=()=>{try{return window.MDBL_KEYS&&window.MDBL_KEYS.MDBLIST?String(window.MDBL_KEYS.MDBLIST):""}catch(e){return""}};if(d()){const t=e.querySelector("#mdbl-sec-keys");t&&(t.innerHTML="",t.style.display="none")}}function createColorBandRow(e,t,n,l){const a=PALETTE_NAMES[l].map((e,t)=>`<option value="${t}" ${CFG.display.colorChoice[l]===t?"selected":""}>${e}</option>`).join("");return`<div class="grid-row">\n        <label>${t} ≤ <input type="number" id="${e}" value="${n}" class="mdbl-num-input"> %</label>\n        <div class="grid-right">\n            <span class="sw" id="sw_${l}" style="background:${SWATCHES[l][CFG.display.colorChoice[l]]}"></span>\n            <select id="col_${l}" class="mdbl-select">${a}</select>\n        </div>\n    </div>`}
