// ==UserScript==
// @name          Jellyfin Ratings (v11.1.0 — Best of Both)
// @namespace     https://mdblist.com
// @version       11.1.0
// @description   Combines the working engine of ratings-other-user.js with the full feature set (Settings, Master Rating, etc).
// @match         *://*/*
// ==/UserScript==

console.log('[Jellyfin Ratings] Loading v11.1.0...');

(function() {
    'use strict';

    /* ==========================================================================
       1. CONFIGURATION & CONSTANTS
    ========================================================================== */
    const NS = 'mdbl_';
    const API_BASE = 'https://api.mdblist.com';
    const CACHE_DURATION = 24 * 60 * 60 * 1000;

    const INJ_KEYS = (window.MDBL_KEYS || {});
    const LS_KEYS = JSON.parse(localStorage.getItem(`${NS}keys`) || '{}');
    const API_KEY = String(INJ_KEYS.MDBLIST || LS_KEYS.MDBLIST || '');

    const DEFAULTS = {
        sources: {
            master: true, imdb: true, tmdb: true, trakt: true, letterboxd: true,
            rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
            metacritic_critic: true, metacritic_user: true, roger_ebert: true,
            anilist: true, myanimelist: true
        },
        display: {
            showPercentSymbol: false,
            colorNumbers: false,
            colorBands: { redMax: 50, orangeMax: 69, ygMax: 79 },
            colorChoice: { red: 0, orange: 2, yg: 3, mg: 0 },
            endsAt24h: true,
            episodeStrategy: 'series'
        },
        spacing: { ratingsTopGapPx: 0 },
        priorities: {
            master: -1, imdb: 1, tmdb: 2, trakt: 3, letterboxd: 4,
            rotten_tomatoes_critic: 5, rotten_tomatoes_audience: 6,
            roger_ebert: 7, metacritic_critic: 8, metacritic_user: 9,
            anilist: 10, myanimelist: 11
        }
    };

    const SCALE = {
        master: 1, imdb: 10, tmdb: 10, trakt: 1, letterboxd: 20, roger_ebert: 25,
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
        rotten_tomatoes_critic: 'RT Critic', rotten_tomatoes_audience: 'RT Audience',
        metacritic_critic: 'Metascore', metacritic_user: 'Metacritic User',
        roger_ebert: 'Roger Ebert', anilist: 'AniList', myanimelist: 'MAL'
    };

    const GEAR_SVG = `<svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;

    let CFG = loadConfig();
    let CFG_BACKUP = null;

    function loadConfig() {
        try {
            const raw = localStorage.getItem(`${NS}prefs`);
            if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
            const p = JSON.parse(raw);
            return {
                sources: { ...DEFAULTS.sources, ...p.sources },
                display: {
                    showPercentSymbol: p.display?.showPercentSymbol ?? DEFAULTS.display.showPercentSymbol,
                    colorNumbers: p.display?.colorNumbers ?? DEFAULTS.display.colorNumbers,
                    colorBands: { ...DEFAULTS.display.colorBands, ...p.display?.colorBands },
                    colorChoice: { ...DEFAULTS.display.colorChoice, ...p.display?.colorChoice },
                    endsAt24h: p.display?.endsAt24h ?? DEFAULTS.display.endsAt24h,
                    episodeStrategy: p.display?.episodeStrategy ?? DEFAULTS.display.episodeStrategy
                },
                spacing: { ratingsTopGapPx: p.spacing?.ratingsTopGapPx ?? DEFAULTS.spacing.ratingsTopGapPx },
                priorities: { ...DEFAULTS.priorities, ...p.priorities }
            };
        } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
    }

    function saveConfig() {
        try { localStorage.setItem(`${NS}prefs`, JSON.stringify(CFG)); } catch (e) {}
    }

    const localSlug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    /* ==========================================================================
       2. STYLES & ASSETS
    ========================================================================== */
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .mdblist-rating-container { display: inline-flex; align-items: center; justify-content: flex-start; margin-left: 12px; margin-top: ${parseInt(CFG.spacing.ratingsTopGapPx)||0}px; z-index: 2000; position: relative; pointer-events: auto !important; vertical-align: middle; }
        .mdbl-rating-item { display: inline-flex; align-items: center; margin: 0 3px; text-decoration: none; cursor: pointer; color: inherit; padding: 4px; border-radius: 6px; }
        .mdbl-inner { display: flex; align-items: center; gap: 6px; pointer-events: none; }
        .mdbl-rating-item:hover { background: rgba(255,255,255,0.08); }
        .mdbl-rating-item img { height: 1.3em; vertical-align: middle; }
        .mdbl-rating-item span { font-size: 1em; vertical-align: middle; }
        .mdbl-rating-item[data-title]:hover::after { content: attr(data-title); position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%); background: rgba(15, 15, 18, 0.98); border: 1px solid rgba(255,255,255,0.15); color: #eaeaea; padding: 8px 12px; border-radius: 8px; font-size: 14px; font-family: sans-serif; font-weight: 500; white-space: nowrap; z-index: 999999; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,0.75); backdrop-filter: blur(4px); }
        .mdbl-rating-item:nth-last-child(-n+2)[data-title]:hover::after { left: auto; right: -5px; transform: none; }
        .mdbl-settings-btn { opacity: 0.6; margin-right: 12px; padding: 4px; cursor: pointer; display: inline-flex; justify-content: center; position: relative; }
        .mdbl-settings-btn:hover { opacity: 1; }
        .mdbl-settings-btn svg { width: 1.2em; height: 1.2em; fill: currentColor; }
        .mdbl-settings-btn::after { content: ''; position: absolute; right: -6px; top: 50%; transform: translateY(-50%); width: 1px; height: 14px; background: rgba(255, 255, 255, 0.2); pointer-events: none; }
        .mdbl-status-text { font-size: 11px; opacity: 0.8; margin-left: 5px; color: #ffeb3b; font-family: monospace; }
        .itemMiscInfo, .mainDetailRibbon, .detailRibbon { overflow: visible !important; contain: none !important; position: relative; z-index: 10; }
        #customEndsAt { font-size: inherit; opacity: 0.9; cursor: default; margin-left: 10px; display: inline-block; padding: 2px 4px; vertical-align: middle; }
        .starRatingContainer, .mediaInfoCriticRating, .mediaInfoAudienceRating, .starRating { display: none !important; opacity: 0 !important; visibility: hidden !important; width: 0 !important; height: 0 !important; overflow: hidden !important; }
    `;
    document.head.appendChild(styleEl);

    function updateGlobalStyles() {
        let rules = styleEl.textContent.split('/* DYNAMIC */')[0] + '/* DYNAMIC */';
        Object.keys(CFG.priorities).forEach(key => {
            const isEnabled = CFG.sources[key];
            const order = CFG.priorities[key];
            rules += `.mdbl-rating-item[data-source="${key}"] { display: ${isEnabled ? 'inline-flex' : 'none'}; order: ${order}; }`;
        });
        // We re-append to update
        styleEl.textContent = rules;
    }

    function getRatingColor(bands, choice, r) {
        let band = 'mg';
        if (r <= bands.redMax) band = 'red';
        else if (r <= bands.orangeMax) band = 'orange';
        else if (r <= bands.ygMax) band = 'yg';
        return SWATCHES[band][choice[band]||0];
    }

    function refreshDomElements() {
        updateGlobalStyles();
        document.querySelectorAll('.mdbl-rating-item:not(.mdbl-settings-btn)').forEach(el => {
            const score = parseFloat(el.dataset.score);
            if (isNaN(score)) return;
            const color = getRatingColor(CFG.display.colorBands, CFG.display.colorChoice, score);
            const span = el.querySelector('span');
            el.querySelector('img').style.removeProperty('filter');
            span.style.color = CFG.display.colorNumbers ? color : '';
            span.textContent = CFG.display.showPercentSymbol ? `${Math.round(score)}%` : `${Math.round(score)}`;
        });
        updateEndsAt();
    }

    /* ==========================================================================
       3. ENDS AT LOGIC
    ========================================================================== */
    function formatTime(minutes) {
        const d = new Date(Date.now() + minutes * 60000);
        const opts = CFG.display.endsAt24h ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', minute: '2-digit', hour12: true };
        return d.toLocaleTimeString([], opts);
    }
    
    function updateEndsAt() {
        const primary = document.querySelector('.itemMiscInfo') || document.querySelector('.mediaInfoItem');
        if (!primary) return;
        
        let minutes = 0;
        const detailContainer = primary.closest('.detailRibbon') || primary.closest('.mainDetailButtons') || primary.parentNode;
        if (detailContainer) {
            const walker = document.createTreeWalker(detailContainer, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while ((node = walker.nextNode())) {
                const val = node.nodeValue.trim();
                const m = val.match(/(?:(\d+)\s*(?:h|hr|std?)\w*\s*)?(?:(\d+)\s*(?:m|min)\w*)?/i);
                // Also matches just number '45 min'
                if (val.length < 20 && /\d/.test(val) && (val.includes('m') || val.includes('h'))) {
                    let h = 0, min = 0;
                    if (m && (m[1] || m[2])) {
                        h = parseInt(m[1]||0);
                        min = parseInt(m[2]||0);
                    } else if (val.match(/(\d+)\s*m/)) {
                        min = parseInt(val.match(/(\d+)\s*m/)[1]);
                    }
                    if (h > 0 || min > 0) { minutes = h*60 + min; break; }
                }
            }
        }
        
        // Hide default Ends At
        if(primary.parentNode) {
            primary.parentNode.querySelectorAll('div, span').forEach(el => {
                if(el.id==='customEndsAt' || el.classList.contains('mdblist-rating-container')) return;
                if((el.textContent||'').toLowerCase().includes('ends at') || (el.textContent||'').toLowerCase().includes('endet')) el.style.display = 'none';
            });
        }

        let span = document.getElementById('customEndsAt');
        const offRating = document.querySelector('.mediaInfoOfficialRating');
        
        if (minutes > 0) {
            if (!span) { span = document.createElement('div'); span.id = 'customEndsAt'; }
            span.textContent = `Ends at ${formatTime(minutes)}`;
            span.style.display = '';
            
            // Insert EndsAt BEFORE ratings
            if (offRating && offRating.parentNode) offRating.insertAdjacentElement('afterend', span);
            else if (primary.parentNode) primary.parentNode.insertBefore(span, primary.nextSibling);
            
            // Ensure ratings container is AFTER EndsAt
            const rc = document.querySelector('.mdblist-rating-container');
            if (rc && span.nextSibling !== rc) span.insertAdjacentElement('afterend', rc);
        } else {
            if (span) span.style.display = 'none';
        }
    }

    /* ==========================================================================
       4. LINK & RENDER LOGIC
    ========================================================================== */
    function generateLink(key, ids, apiLink, type, title) {
        const sLink = String(apiLink || '');
        const safeTitle = encodeURIComponent(title || '');
        const safeType = (type === 'show' || type === 'tv') ? 'tv' : 'movie';
        if (sLink.startsWith('http') && key !== 'metacritic_user' && key !== 'roger_ebert') return sLink;
        switch(key) {
            case 'imdb': return ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : '#';
            case 'tmdb': return ids.tmdb ? `https://www.themoviedb.org/${safeType}/${ids.tmdb}` : '#';
            case 'trakt': return ids.trakt ? `https://trakt.tv/${safeType==='tv'?'shows':'movies'}/${ids.trakt}` : '#';
            case 'letterboxd': return (sLink.includes('/film/')||sLink.includes('/slug/')) ? `https://letterboxd.com${sLink.startsWith('/')?'':'/'}${sLink}` : '#';
            case 'metacritic_critic':
            case 'metacritic_user':
                 if (sLink.startsWith('/')) return `https://www.metacritic.com${sLink}`;
                 return slug ? `https://www.metacritic.com/${safeType}/${localSlug(title)}` : '#';
            case 'rotten_tomatoes_critic':
            case 'rotten_tomatoes_audience': return sLink.length > 2 ? `https://www.rottentomatoes.com/m/${sLink}` : '#';
            case 'anilist': return ids.anilist ? `https://anilist.co/anime/${ids.anilist}` : `https://anilist.co/search/anime?search=${safeTitle}`;
            case 'myanimelist': return ids.mal ? `https://myanimelist.net/anime/${ids.mal}` : `https://myanimelist.net/anime.php?q=${safeTitle}`;
            case 'roger_ebert': return sLink.length > 2 ? `https://www.rogerebert.com/reviews/${sLink}` : `https://duckduckgo.com/?q=!ducky+site:rogerebert.com/reviews+${safeTitle}`;
            default: return '#';
        }
    }

    function createRatingHtml(key, val, link, count, title, kind) {
        if (val === null || isNaN(val)) return '';
        if (!LOGO[key]) return '';
        const n = parseFloat(val) * (SCALE[key] || 1);
        const r = Math.round(n);
        const tooltip = (count && count > 0) ? `${title} — ${count.toLocaleString()} ${kind||'Votes'}` : title;
        const style = (!link || link === '#') ? 'cursor:default;' : 'cursor:pointer;';
        return `<a href="${link}" target="_blank" class="mdbl-rating-item" data-source="${key}" data-score="${r}" style="${style}" data-title="${tooltip}"><div class="mdbl-inner"><img src="${LOGO[key]}" alt="${title}"><span>${CFG.display.showPercentSymbol ? r+'%' : r}</span></div></a>`;
    }

    function renderRatings(container, data, type) {
        // Clear except settings btn
        const btn = container.querySelector('.mdbl-settings-btn');
        container.innerHTML = '';
        if(btn) { container.appendChild(btn); btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openSettingsMenu(); }; }
        
        let html = '';
        const ids = { imdb: data.ids?.imdb||data.imdbid, tmdb: data.ids?.tmdb||data.id, trakt: data.ids?.trakt||data.traktid, mal: data.ids?.mal, anilist: data.ids?.anilist };
        
        let masterSum = 0, masterCount = 0;
        const trackMaster = (val, scaleKey) => { 
            if (val !== null && !isNaN(parseFloat(val))) { 
                masterSum += parseFloat(val) * (SCALE[scaleKey] || 1); 
                masterCount++; 
            } 
        };
        const add = (k, v, apiLink, c, tit, kind) => {
            const safeLink = generateLink(k, ids, apiLink, type, data.title);
            html += createRatingHtml(k, v, safeLink, c, tit, kind);
        };

        if (data.ratings && data.ratings.length > 0) {
            data.ratings.forEach(r => {
                const s = (r.source||'').toLowerCase();
                const v = r.value, c = r.votes||r.count, apiLink = r.url;
                if (s.includes('imdb')) { add('imdb', v, apiLink, c, 'IMDb', 'Votes'); trackMaster(v, 'imdb'); }
                else if (s.includes('tmdb')) { add('tmdb', v, apiLink, c, 'TMDb', 'Votes'); trackMaster(v, 'tmdb'); }
                else if (s.includes('trakt')) { add('trakt', v, apiLink, c, 'Trakt', 'Votes'); trackMaster(v, 'trakt'); }
                else if (s.includes('letterboxd')) { add('letterboxd', v, apiLink, c, 'Letterboxd', 'Votes'); trackMaster(v, 'letterboxd'); }
                else if (s.includes('tomatoes') || s.includes('rotten') || s.includes('popcorn')) {
                    if(s.includes('audience') || s.includes('popcorn')) { add('rotten_tomatoes_audience', v, apiLink, c, 'RT Audience', 'Votes'); trackMaster(v, 'rotten_tomatoes_audience'); }
                    else { add('rotten_tomatoes_critic', v, apiLink, c, 'RT Critic', 'Reviews'); trackMaster(v, 'rotten_tomatoes_critic'); }
                }
                else if (s.includes('metacritic')) {
                    if(s.includes('user')) { add('metacritic_user', v, apiLink, c, 'User', 'Votes'); trackMaster(v, 'metacritic_user'); }
                    else { add('metacritic_critic', v, apiLink, c, 'Metascore', 'Reviews'); trackMaster(v, 'metacritic_critic'); }
                }
                else if (s.includes('roger')) { add('roger_ebert', v, apiLink, c, 'Roger Ebert', 'Reviews'); trackMaster(v, 'roger_ebert'); }
                else if (s.includes('anilist')) { add('anilist', v, apiLink, c, 'AniList', 'Votes'); trackMaster(v, 'anilist'); }
                else if (s.includes('myanimelist')) { add('myanimelist', v, apiLink, c, 'MAL', 'Votes'); trackMaster(v, 'myanimelist'); }
            });
            
            if (masterCount > 0) {
                html += createRatingHtml('master', masterSum/masterCount, `https://duckduckgo.com/?q=${encodeURIComponent(data.title)}`, masterCount, 'Master Rating', 'Sources');
            }
            const sp = document.createElement('span');
            sp.innerHTML = html;
            container.appendChild(sp);
            refreshDomElements();
        } else {
             const err = document.createElement('span');
             err.className = 'mdbl-status-text';
             err.textContent = 'MDB: 0';
             err.style.color = '#e53935';
             container.appendChild(err);
        }
    }

    function fetchRatings(container, id, type, apiSource) {
        let url;
        if (apiSource === 'imdb') url = `${API_BASE}/imdb/${id}?apikey=${API_KEY}`;
        else url = `${API_BASE}/tmdb/${type}/${id}?apikey=${API_KEY}`;
        
        const cacheKey = `${NS}c_${id}`;
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const c = JSON.parse(cached);
                if (Date.now() - c.ts < CACHE_DURATION) { renderRatings(container, c.data, type); return; }
            }
        } catch(e) {}
        
        const st = document.createElement('span'); st.className = 'mdbl-status-text'; st.textContent = '...'; container.appendChild(st);
        fetch(url).then(r=>r.json()).then(d => {
            st.remove();
            localStorage.setItem(cacheKey, JSON.stringify({ts:Date.now(), data:d}));
            renderRatings(container, d, type);
        }).catch(e => { st.textContent = 'Err'; st.style.color = '#e53935'; });
    }

    /* ==========================================================================
       5. ENGINE (From ratings-other-user.js)
    ========================================================================== */
    function scanAndProcessLinks() {
        updateEndsAt();
        document.querySelectorAll(
            'div.starRatingContainer.mediaInfoItem,' +
            'div.mediaInfoItem.mediaInfoCriticRating.mediaInfoCriticRatingFresh,' +
            'div.mediaInfoItem.mediaInfoCriticRating.mediaInfoCriticRatingRotten'
        ).forEach(el => el.style.display = 'none');

        document.querySelectorAll('a[href*="themoviedb.org/"]').forEach(link => {
            if (link.dataset.mdblProcessed) return;
            link.dataset.mdblProcessed = "true";
            
            const m = link.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
            if (!m) return;
            
            let type = m[1] === 'tv' ? 'show' : 'movie';
            let id = m[2];
            let apiSource = 'tmdb';

            const isEpisode = link.href.includes('/season/') || link.href.includes('/episode/');
            if (type === 'show' && isEpisode && CFG.display.episodeStrategy === 'episode') {
                const parent = link.closest('.itemMiscInfo') || link.closest('.mainDetailButtons') || link.parentNode.parentNode;
                if (parent) {
                    const imdbLink = parent.querySelector('a[href*="imdb.com/title/tt"]');
                    if (imdbLink) {
                        const mImdb = imdbLink.href.match(/tt\d+/);
                        if (mImdb) { id = mImdb[0]; type = 'movie'; apiSource = 'imdb'; } // Fetch episode as movie via imdb
                    }
                }
                // Fallback: If no IMDb, keep 'show' and 'tmdb' (Series rating) -> NO ERROR
            }

            const officialEls = document.querySelectorAll('div.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating');
            if (officialEls.length) officialEls.forEach(el => insertContainer(el, type, id, apiSource));
            else {
                document.querySelectorAll('div.mediaInfoItem').forEach(el => {
                    if (/^\d+\s*(?:h(?:ours?)?)?\s*\d*\s*m(?:inutes?)?$/i.test(el.textContent.trim())) insertContainer(el, type, id, apiSource);
                });
            }
        });
    }

    function insertContainer(target, type, id, apiSource) {
        // Check for existing sibling
        const next = target.nextElementSibling;
        if (next && next.classList.contains('mdblist-rating-container')) {
            if (next.dataset.id === id) return;
            next.remove();
        }

        const container = document.createElement('div');
        container.className = 'mdblist-rating-container';
        container.dataset.id = id;
        
        // Settings Button
        const btn = document.createElement('div');
        btn.className = 'mdbl-rating-item mdbl-settings-btn';
        btn.innerHTML = GEAR_SVG;
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openSettingsMenu(); };
        container.appendChild(btn);

        // Insertion Logic (Corrected for Ends At)
        const endsAt = document.getElementById('customEndsAt');
        if (endsAt && endsAt.parentNode === target.parentNode) endsAt.insertAdjacentElement('afterend', container);
        else target.insertAdjacentElement('afterend', container);

        fetchRatings(container, id, type, apiSource);
    }

    setInterval(scanAndProcessLinks, 1000);
    scanAndProcessLinks();

    /* ==========================================================================
       6. SETTINGS MENU
    ========================================================================== */
    function initMenu() {
        if(document.getElementById('mdbl-panel')) return;
        const css = `
        :root { --mdbl-right-col: 48px; }
        #mdbl-panel { position:fixed; right:16px; bottom:70px; width:500px; max-height:90vh; overflow:auto; border-radius:14px; border:1px solid rgba(255,255,255,0.15); background:rgba(22,22,26,0.94); backdrop-filter:blur(8px); color:#eaeaea; z-index:100000; box-shadow:0 20px 40px rgba(0,0,0,0.45); display:none; font-family: sans-serif; }
        #mdbl-panel header { position:sticky; top:0; background:rgba(22,22,26,0.98); padding:6px 12px; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; gap:8px; cursor:move; z-index:999; backdrop-filter:blur(8px); font-weight: bold; justify-content: space-between; }
        #mdbl-close { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; color: #aaa; font-size: 18px; cursor: pointer; padding: 0; border-radius: 6px; }
        #mdbl-close:hover { background:rgba(255,255,255,0.06); color:#fff; }
        #mdbl-panel .mdbl-section { padding:2px 12px; gap:2px; display:flex; flex-direction:column; }
        #mdbl-panel .mdbl-subtle { color:#9aa0a6; font-size:12px; }
        #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { display:grid; grid-template-columns:1fr var(--mdbl-right-col); align-items:center; gap:5px; padding:2px 6px; border-radius:6px; min-height: 32px; }
        #mdbl-panel .mdbl-row { background:transparent; border:1px solid rgba(255,255,255,0.06); box-sizing:border-box; }
        #mdbl-panel input[type="checkbox"] { transform: scale(1.2); cursor: pointer; accent-color: var(--mdbl-theme); }
        #mdbl-panel input[type="text"] { width:100%; padding:10px 0; border:0; background:transparent; color:#eaeaea; font-size:14px; outline:none; }
        #mdbl-panel select, #mdbl-panel input.mdbl-num-input { padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#121317; color:#eaeaea; height:28px; line-height: 28px; font-size: 12px; box-sizing:border-box; display:inline-block; color-scheme: dark; }
        #mdbl-panel .mdbl-select { width:140px; justify-self:end; }
        #mdbl-panel input.mdbl-num-input { width: 60px; text-align: center; }
        #mdbl-panel .mdbl-actions { position:sticky; bottom:0; background:rgba(22,22,26,0.96); display:flex; gap:10px; padding:6px 10px; border-top:1px solid rgba(255,255,255,0.08); }
        #mdbl-panel button { padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#1b1c20; color:#eaeaea; cursor:pointer; }
        #mdbl-panel button.primary { background-color: var(--mdbl-theme) !important; border-color: var(--mdbl-theme) !important; color: #fff; }
        #mdbl-sources { display:flex; flex-direction:column; gap:8px; }
        .mdbl-source { background:#0f1115; border:1px solid rgba(255,255,255,0.1); cursor: grab; }
        .mdbl-src-left { display:flex; align-items:center; gap:10px; }
        .mdbl-src-left img { height:16px; width:auto; }
        .mdbl-src-left .name { font-size:13px; }
        .mdbl-drag-handle { justify-self:start; opacity:0.6; cursor:grab; }
        #mdbl-key-box { background:#0f1115; border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:12px; }
        .mdbl-grid { display:grid; grid-template-columns:1fr; gap:10px; }
        .mdbl-grid .grid-row { display:grid; grid-template-columns:1fr 1fr; align-items:center; gap:12px; }
        .grid-right { display:flex; align-items:center; gap:8px; justify-content:flex-end; }
        .mdbl-grid label { white-space: nowrap; }
        .sw { display:inline-block; width:18px; height:18px; border-radius:4px; border:1px solid rgba(255,255,255,0.25); }
        #mdbl-panel hr { border:0; border-top:1px solid rgba(255,255,255,0.08); margin:4px 0; }
        #mdbl-panel .mdbl-actions { display:flex; align-items:center; gap:8px; }
        #mdbl-panel .mdbl-actions .mdbl-grow { flex:1; }
        @media (max-width: 600px) { #mdbl-panel { width: 96% !important; left: 2% !important; right: 2% !important; bottom: 10px !important; top: auto !important; transform: none !important; max-height: 80vh; --mdbl-right-col: 40px; } }`;
        
        const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
        const panel = document.createElement('div'); panel.id = 'mdbl-panel'; document.body.appendChild(panel);
        
        // Drag
        let isDrag = false, sx, sy, lx, ly;
        panel.addEventListener('mousedown', (e) => { if(window.innerWidth<=600||['INPUT','SELECT','BUTTON'].includes(e.target.tagName)||e.target.closest('.sec'))return; isDrag=true; const r=panel.getBoundingClientRect(); lx=r.left; ly=r.top; sx=e.clientX; sy=e.clientY; panel.style.right='auto'; panel.style.bottom='auto'; panel.style.left=lx+'px'; panel.style.top=ly+'px'; });
        document.addEventListener('mousemove', (e) => { if(!isDrag)return; panel.style.left=(lx+(e.clientX-sx))+'px'; panel.style.top=(ly+(e.clientY-sy))+'px'; });
        document.addEventListener('mouseup', ()=>isDrag=false);
        document.addEventListener('mousedown', (e) => { if (panel.style.display==='block' && !panel.contains(e.target) && !e.target.closest('.mdbl-settings-btn')) closeSettingsMenu(false); });
    }

    function openSettingsMenu() {
        initMenu();
        CFG_BACKUP = JSON.parse(JSON.stringify(CFG));
        const p = document.getElementById('mdbl-panel');
        if(p) {
            const col = getComputedStyle(document.documentElement).getPropertyValue('--theme-primary-color').trim() || '#2a6df4';
            p.style.setProperty('--mdbl-theme', col);
            renderMenuContent(p);
            p.style.display = 'block';
        }
    }

    function closeSettingsMenu(save) {
        const p = document.getElementById('mdbl-panel');
        if (p) p.style.display = 'none';
        if (save) {
            saveConfig();
            if(p.querySelector('#mdbl-key-mdb').value.trim()) localStorage.setItem('mdbl_keys', JSON.stringify({MDBLIST: p.querySelector('#mdbl-key-mdb').value.trim()}));
            location.reload();
        } else if (CFG_BACKUP) {
            CFG = JSON.parse(JSON.stringify(CFG_BACKUP));
            refreshDomElements();
        }
    }

    function renderMenuContent(panel) {
        const createRow = (id, lbl, val, key) => {
            const opts = PALETTE_NAMES[key].map((n,i) => `<option value="${i}" ${CFG.display.colorChoice[key]===i?'selected':''}>${n}</option>`).join('');
            return `<div class="grid-row"><label>${lbl} ≤ <input type="number" id="${id}" value="${val}" class="mdbl-num-input"> %</label><div class="grid-right"><span class="sw" id="sw_${key}" style="background:${SWATCHES[key][CFG.display.colorChoice[key]]}"></span><select id="col_${key}" class="mdbl-select">${opts}</select></div></div>`;
        };
        const row = (l, i) => `<div class="mdbl-row"><span>${l}</span>${i}</div>`;
        const k = (JSON.parse(localStorage.getItem('mdbl_keys')||'{}').MDBLIST)||'';

        let html = `
        <header><h3>Settings</h3><button id="mdbl-close">✕</button></header>
        <div class="mdbl-section">${(!INJ_KEYS.MDBLIST && !k) ? `<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" placeholder="MDBList API key" value="${k}"></div>`:''}</div>
        <div class="mdbl-section"><div class="mdbl-subtle">Sources (drag)</div><div id="mdbl-sources"></div><hr></div>
        <div class="mdbl-section">
            <div class="mdbl-subtle">Display</div>
            ${row('Color numbers', `<input type="checkbox" id="d_cnum" ${CFG.display.colorNumbers?'checked':''}>`)}
            ${row('Show %', `<input type="checkbox" id="d_pct" ${CFG.display.showPercentSymbol?'checked':''}>`)}
            <div class="mdbl-row"><span>Episode Source</span><select id="d_ep_strat" class="mdbl-select" style="width:160px"><option value="series" ${CFG.display.episodeStrategy==='series'?'selected':''}>Series (Stable)</option><option value="episode" ${CFG.display.episodeStrategy==='episode'?'selected':''}>Episode (Individual)</option></select></div>
            <hr><div class="mdbl-subtle">Colors</div><div class="mdbl-grid">
            ${createRow('th_red','Rating',CFG.display.colorBands.redMax,'red')}
            ${createRow('th_orange','Rating',CFG.display.colorBands.orangeMax,'orange')}
            ${createRow('th_yg','Rating',CFG.display.colorBands.ygMax,'yg')}
            <div class="grid-row"><label>Top tier</label><div class="grid-right"><span class="sw" id="sw_mg" style="background:${SWATCHES.mg[CFG.display.colorChoice.mg]}"></span><select id="col_mg" class="mdbl-select">${PALETTE_NAMES.mg.map((n,i)=>`<option value="${i}" ${CFG.display.colorChoice.mg===i?'selected':''}>${n}</option>`).join('')}</select></div></div>
            </div>
        </div>
        <div class="mdbl-actions" style="padding-bottom:16px"><button id="mdbl-btn-reset">Reset</button><button id="mdbl-btn-save" class="primary">Save & Apply</button></div>`;
        
        panel.innerHTML = html;
        panel.querySelector('#mdbl-close').onclick = () => closeSettingsMenu(false);
        panel.querySelector('#mdbl-btn-save').onclick = () => { closeSettingsMenu(true); };
        panel.querySelector('#mdbl-btn-reset').onclick = () => { if(confirm('Reset?')) { localStorage.removeItem('mdbl_prefs'); location.reload(); }};
        
        // Live Update Listeners
        const update = () => {
            CFG.display.colorNumbers = panel.querySelector('#d_cnum').checked;
            CFG.display.showPercentSymbol = panel.querySelector('#d_pct').checked;
            CFG.display.episodeStrategy = panel.querySelector('#d_ep_strat').value;
            CFG.display.colorBands.redMax = parseInt(panel.querySelector('#th_red').value)||50;
            CFG.display.colorBands.orangeMax = parseInt(panel.querySelector('#th_orange').value)||69;
            CFG.display.colorBands.ygMax = parseInt(panel.querySelector('#th_yg').value)||79;
            ['red','orange','yg','mg'].forEach(k => CFG.display.colorChoice[k] = parseInt(panel.querySelector(`#col_${k}`).value)||0);
            ['red','orange','yg','mg'].forEach(k => panel.querySelector(`#sw_${k}`).style.background = SWATCHES[k][CFG.display.colorChoice[k]]);
            refreshDomElements();
        };
        panel.querySelectorAll('input, select').forEach(el => el.addEventListener(el.type==='checkbox'?'change':'input', update));

        // Sources
        const sList = panel.querySelector('#mdbl-sources');
        let dragSrc = null;
        Object.keys(CFG.priorities).sort((a,b) => CFG.priorities[a]-CFG.priorities[b]).forEach(k => {
             if (!CFG.sources.hasOwnProperty(k)) return;
             const div = document.createElement('div');
             div.className = 'mdbl-source mdbl-src-row';
             div.draggable = true;
             div.dataset.key = k;
             div.innerHTML = `<div class="mdbl-src-left"><span class="mdbl-drag-handle">::</span><img src="${LOGO[k]}" style="height:16px"><span class="name" style="font-size:13px;margin-left:8px">${LABEL[k]}</span></div><input type="checkbox" ${CFG.sources[k]?'checked':''}>`;
             div.querySelector('input').onchange = (e) => { CFG.sources[k] = e.target.checked; updateGlobalStyles(); };
             div.ondragstart = (e) => { dragSrc = div; e.dataTransfer.effectAllowed = 'move'; };
             div.ondragover = (e) => {
                 e.preventDefault();
                 if (dragSrc && dragSrc !== div) {
                     const list = div.parentNode, all = [...list.children];
                     const srcI = all.indexOf(dragSrc), tgtI = all.indexOf(div);
                     list.insertBefore(dragSrc, srcI < tgtI ? div.nextSibling : div);
                     [...list.querySelectorAll('.mdbl-src-row')].forEach((r, i) => CFG.priorities[r.dataset.key] = i+1);
                     updateGlobalStyles();
                 }
             };
             sList.appendChild(div);
        });
    }

})();
