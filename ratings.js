// ==UserScript==
// @name         MDBList Ratings (v6.2.2 — Toggleable EndsAt Bullet + Readable Toggles)
// @namespace    https://mdblist.com
// @version      6.2.2
// @description  Unified ratings for Jellyfin 10.11.x with inline “Ends at …” (12h/24h + optional bullet), cloned parental rating, spacing, normalized 0–100, and colorized icons.
// @match        *://*.imdb.com/title/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

/* ======================================================
   🧠 CONFIGURATION — toggles on separate lines
====================================================== */

/* 🎬 SOURCES */
const ENABLE_SOURCES = {
  imdb:                true,
  tmdb:                true,
  trakt:               true,
  letterboxd:          true,
  rotten_tomatoes:     true,
  roger_ebert:         true,
  anilist:             true,
  myanimelist:         true,
  metacritic_critic:   true,
  metacritic_user:     true
};

/* 🎨 DISPLAY */
const DISPLAY = {
  showPercentSymbol:    true,     // show “%”
  colorizeRatings:      true,     // colorize numbers (and icons if colorizeNumbersOnly=false)
  colorizeNumbersOnly:  true,     // true: color number only; false: number + icon glow
  align:                'left',   // 'left' | 'center' | 'right'
  endsAtFormat:         '24h',    // '24h' | '12h'
  endsAtBullet:         true      // true: prefix “Ends at …” with a bullet “• ”
};

/* 📏 SPACING */
const SPACING = {
  ratingsTopGapPx:      8         // gap between first row and ratings row
};

/* ⚙️ NORMALIZATION (→ 0–100) */
const SCALE_MULTIPLIER = {
  imdb:                   10,
  tmdb:                   1,
  trakt:                  1,
  letterboxd:             20,
  roger_ebert:            25,
  metacritic_critic:      1,
  metacritic_user:        10,
  myanimelist:            10,
  anilist:                1,
  rotten_tomatoes_critic: 1,
  rotten_tomatoes_audience: 1
};

/* 🎨 COLORS */
const COLOR_THRESHOLDS = { green: 75, orange: 50, red: 0 };
const COLOR_VALUES     = { green: 'limegreen', orange: 'orange', red: 'crimson' };

/* 🧮 SORT ORDER (lower appears earlier) */
const RATING_PRIORITY = {
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

/* 🔑 API KEY + CACHE */
const MDBLIST_API_KEY = 'hehfnbo9y8blfyqm1d37ikubl';
const CACHE_DURATION  = 7 * 24 * 60 * 60 * 1000;

/* 🖼️ LOGOS */
const LOGO = {
  imdb:            'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/IMDb.png',
  tmdb:            'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/TMDB.png',
  trakt:           'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/Trakt.png',
  letterboxd:      'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/letterboxd.png',
  anilist:         'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/anilist.png',
  myanimelist:     'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/mal.png',
  roger:           'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/Roger_Ebert.png',
  tomatoes:        'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/Rotten_Tomatoes.png',
  audience:        'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/Rotten_Tomatoes_positive_audience.png',
  metacritic:      'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/Metacritic.png',
  metacritic_user: 'https://cdn.jsdelivr.net/gh/Druidblack/jellyfin_ratings@main/logo/mus2.png'
};

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
      .then(r => r.text().then(t => onload({ status:r.status, responseText:t })))
      .catch(e => onerror && onerror(e));
  };
}

/* ======================================================
   MAIN SCRIPT
====================================================== */
(function(){
'use strict';

/* === Utility functions === */
function validNumber(v){const n=parseFloat(v);return !isNaN(n);}
function roundValue(v){return Math.round(parseFloat(v));}
function normalizeValue(v,src){const x=parseFloat(v);if(isNaN(x))return null;const m=SCALE_MULTIPLIER[src.toLowerCase()]||1;return x*m;}
function slugify(t){return(t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function sortContainer(c){[...c.children].sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999)).forEach(e=>c.append(e));}
function hideDefault(){document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b=>{
  b.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(e=>e.style.display='none');});}

/* === Custom "Ends at" generator (12h/24h + optional bullet) === */
(function endsAtInit(){
  const pad = n => n.toString().padStart(2,'0');

  function formatEndTime(d){
    if (DISPLAY.endsAtFormat === '12h') {
      let h = d.getHours();
      const m = pad(d.getMinutes());
      const suffix = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${suffix}`;
    }
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function parseRuntimeToMinutes(text){
    if(!text) return 0;
    const re = /(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i;
    const m = text.match(re);
    if(!m) return 0;
    const h = parseInt(m[1]||'0',10);
    const min = parseInt(m[2]||'0',10);
    if(h===0 && min===0){
      const only = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
      return only ? parseInt(only[1],10) : 0;
    }
    return h*60+min;
  }

  function removeBuiltInEndsAt(){
    document.querySelectorAll('.itemMiscInfo-secondary, .itemMiscInfo .mediaInfoItem, .itemMiscInfo .mediaInfoText')
      .forEach(el=>{
        const txt=(el.textContent||'').toLowerCase();
        if(txt.includes('ends at')){
          const row = el.closest('.itemMiscInfo-secondary') || el;
          row.remove();
        }
      });
  }

  function findPrimaryRow(){
    return document.querySelector('.itemMiscInfo.itemMiscInfo-primary')
        || document.querySelector('.itemMiscInfo-primary')
        || document.querySelector('.itemMiscInfo');
  }

  function findRuntimeNode(primary){
    const chips = primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div');
    for(const el of chips){
      const t=(el.textContent||'').trim();
      const m=parseRuntimeToMinutes(t);
      if(m>0) return {node:el, minutes:m};
    }
    const t=(primary.textContent||'').trim();
    const m=parseRuntimeToMinutes(t);
    return m>0 ? {node:primary, minutes:m} : {node:null, minutes:0};
  }

  function ensureInlineEndsAt(primary, anchorNode, minutes){
    if(!primary || !anchorNode || !minutes) return;
    const end=new Date(Date.now()+minutes*60000);
    const timeStr = formatEndTime(end);
    const prefix  = DISPLAY.endsAtBullet ? ' • ' : ' ';
    const content = `${prefix}Ends at ${timeStr}`;

    let span=primary.querySelector('#customEndsAt');
    if(!span){
      span=document.createElement('span');
      span.id='customEndsAt';
      // Match first-line style
      span.style.marginLeft='10px';
      span.style.color='inherit';
      span.style.opacity='1';
      span.style.fontSize='inherit';
      span.style.fontWeight='inherit';
      span.style.whiteSpace='nowrap';
      span.style.display='inline';
      if(anchorNode.nextSibling) anchorNode.parentNode.insertBefore(span, anchorNode.nextSibling);
      else anchorNode.parentNode.appendChild(span);
    }
    span.textContent=content;
  }

  function tick(){
    try{
      removeBuiltInEndsAt();
      const primary=findPrimaryRow(); if(!primary) return;
      const {node,minutes}=findRuntimeNode(primary); if(!node || !minutes) return;
      ensureInlineEndsAt(primary,node,minutes);
    }catch(_){}
  }
  setInterval(tick,800);
  tick();
})();

/* === Clone parental rating at start (hide original) === */
(function parentalRatingInlineInit(){
  function findPrimaryRow() {
    return document.querySelector('.itemMiscInfo.itemMiscInfo-primary')
        || document.querySelector('.itemMiscInfo-primary')
        || document.querySelector('.itemMiscInfo');
  }
  function findYearChip(primary){
    const chips=primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div');
    for(const el of chips){
      const t=(el.textContent||'').trim();
      if(/^\d{4}$/.test(t)) return el;
    }
    return null;
  }
  function readAndHideOriginalBadge(){
    let original = document.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')
                || document.querySelector('.mediaInfoItem.mediaInfoText[data-type="officialRating"]');
    if(!original){
      const candidates=[...document.querySelectorAll('.itemMiscInfo .mediaInfoItem, .itemMiscInfo .mediaInfoText, .itemMiscInfo span')];
      original=candidates.find(el=>{
        const t=(el.textContent||'').trim();
        return /^[A-Z0-9][A-Z0-9\-+]{0,5}$/.test(t) && !/^\d{4}$/.test(t);
      })||null;
    }
    if(!original) return null;
    const value=(original.textContent||'').trim();
    original.style.display='none';
    return value||null;
  }
  function ensureInlineBadge(){
    const primary=findPrimaryRow(); if(!primary) return;
    const ratingValue=readAndHideOriginalBadge(); if(!ratingValue) return;
    if(primary.querySelector('#mdblistInlineParental')) return;
    const before=findYearChip(primary)||primary.firstChild;

    const badge=document.createElement('span');
    badge.id='mdblistInlineParental';
    badge.textContent=ratingValue;
    Object.assign(badge.style,{
      display:'inline-flex',
      alignItems:'center',
      justifyContent:'center',
      padding:'2px 6px',
      borderRadius:'6px',
      fontWeight:'600',
      fontSize:'0.9em',
      lineHeight:'1',
      background:'var(--theme-primary-color, rgba(255,255,255,0.12))',
      color:'var(--theme-text-color, #ddd)',
      marginRight:'10px',
      whiteSpace:'nowrap',
      flex:'0 0 auto',
      verticalAlign:'middle'
    });
    if(before && before.parentNode) before.parentNode.insertBefore(badge,before);
    else primary.insertBefore(badge,primary.firstChild);
  }
  const tick=()=>{try{ensureInlineBadge();}catch(_){}}; setInterval(tick,800); tick();
})();

/* === Append Rating === */
function appendRating(c,logo,val,title,key,link){
  if(!validNumber(val))return;
  const n=normalizeValue(val,key); if(!validNumber(n))return;
  const r=roundValue(n);
  const disp = DISPLAY.showPercentSymbol ? `${r}%` : `${r}`;
  if(c.querySelector(`[data-source="${key}"]`))return;

  const wrap=document.createElement('div');
  wrap.dataset.source=key;
  wrap.style='display:inline-flex;align-items:center;margin:0 6px;';

  const a=document.createElement('a');
  a.href=link; a.target='_blank'; a.style.textDecoration='none;';

  const img=document.createElement('img');
  img.src=logo; img.alt=title; img.title=`${title}: ${disp}`;
  img.style='height:1.3em;margin-right:3px;vertical-align:middle;';

  const s=document.createElement('span');
  s.textContent=disp; s.style='font-size:1em;vertical-align:middle;';

  if(DISPLAY.colorizeRatings){
    let col;
    if(r>=COLOR_THRESHOLDS.green)col=COLOR_VALUES.green;
    else if(r>=COLOR_THRESHOLDS.orange)col=COLOR_VALUES.orange;
    else col=COLOR_VALUES.red;
    if(DISPLAY.colorizeNumbersOnly)s.style.color=col;
    else{s.style.color=col;img.style.filter=`drop-shadow(0 0 3px ${col})`;}
  }

  a.append(img,s);
  wrap.append(a);
  c.append(wrap);
  sortContainer(c);
}

/* === Main scanning === */
let currentImdbId=null;
function scanLinks(){
  document.querySelectorAll('a.emby-button[href*="imdb.com/title/"]').forEach(a=>{
    if(a.dataset.done)return;a.dataset.done='1';
    const m=a.href.match(/imdb\.com\/title\/(tt\d+)/);if(!m)return;
    const id=m[1];
    if(id!==currentImdbId){
      document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove());
      currentImdbId=id;
    }
  });

  [...document.querySelectorAll('a.emby-button[href*="themoviedb.org/"]')].filter(a=>!a.dataset.proc)
  .forEach(a=>{
    a.dataset.proc='1';
    const m=a.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
    if(!m)return;
    const type=m[1]==='tv'?'show':'movie',tid=m[2];

    document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b=>{
      const ref=b.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')||b.querySelector('.mediaInfoItem:last-of-type');
      if(!ref)return;
      const div=document.createElement('div');
      div.className='mdblist-rating-container';
      const justify = DISPLAY.align==='center'?'center':DISPLAY.align==='left'?'flex-start':'flex-end';
      const paddingRight = DISPLAY.align==='right'?'6px':'0';
      div.style=`
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        justify-content:${justify};
        width:calc(100% + 6px);
        margin-left:-6px;
        margin-top:${SPACING.ratingsTopGapPx}px;
        padding-right:${paddingRight};
        box-sizing:border-box;
      `;
      div.dataset.type=type;
      ref.insertAdjacentElement('afterend',div);
      fetchRatings(tid,currentImdbId,div,type);
    });
  });

  hideDefault();
}
scanLinks();
setInterval(scanLinks,1000);

/* === Fetch Ratings === */
function fetchRatings(tid,imdbId,c,type){
  GM_xmlhttpRequest({
    method:'GET',
    url:`https://api.mdblist.com/tmdb/${type}/${tid}?apikey=${MDBLIST_API_KEY}`,
    onload:r=>{
      if(r.status!==200)return;
      let d;try{d=JSON.parse(r.responseText);}catch{return;}
      const title=d.title||'';const slug=slugify(title);
      d.ratings?.forEach(rr=>{
        const s=(rr.source||'').toLowerCase();const v=rr.value;
        if(s.includes('imdb')&&ENABLE_SOURCES.imdb)
          appendRating(c,LOGO.imdb,v,'IMDb','imdb',`https://www.imdb.com/title/${imdbId}/`);
        else if(s.includes('tmdb')&&ENABLE_SOURCES.tmdb)
          appendRating(c,LOGO.tmdb,v,'TMDb','tmdb',`https://www.themoviedb.org/${type}/${tid}`);
        else if(s.includes('trakt')&&ENABLE_SOURCES.trakt)
          appendRating(c,LOGO.trakt,v,'Trakt','trakt',`https://trakt.tv/search/imdb/${imdbId}`);
        else if(s.includes('letterboxd')&&ENABLE_SOURCES.letterboxd)
          appendRating(c,LOGO.letterboxd,v,'Letterboxd','letterboxd',`https://letterboxd.com/imdb/${imdbId}/`);
        else if(s==='metacritic'&&ENABLE_SOURCES.metacritic_critic){
          const seg=(c.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(c,LOGO.metacritic,v,'Metacritic (Critic)','metacritic_critic',link);
        } else if(s.includes('metacritic')&&s.includes('user')&&ENABLE_SOURCES.metacritic_user){
          const seg=(c.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(c,LOGO.metacritic_user,v,'Metacritic (User)','metacritic_user',link);
        } else if(s.includes('roger')&&ENABLE_SOURCES.roger_ebert)
          appendRating(c,LOGO.roger,v,'Roger Ebert','roger_ebert',`https://www.rogerebert.com/reviews/${slug}`);
      });
      if(ENABLE_SOURCES.anilist)fetchAniList(imdbId,c);
      if(ENABLE_SOURCES.myanimelist)fetchMAL(imdbId,c);
      if(ENABLE_SOURCES.rotten_tomatoes)fetchRT(imdbId,c);
    }
  });
}

/* === AniList === */
function fetchAniList(imdbId,c){
  const q=`SELECT ?anilist WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P8729 ?anilist . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id=JSON.parse(r.responseText).results.bindings[0]?.anilist?.value;
        if(!id)return;
        const gql='query($id:Int){ Media(id:$id,type:ANIME){ id meanScore } }';
        GM_xmlhttpRequest({
          method:'POST',
          url:'https://graphql.anilist.co',
          headers:{'Content-Type':'application/json'},
          data:JSON.stringify({query:gql,variables:{id:parseInt(id,10)}}),
          onload:rr=>{
            try{
              const m=JSON.parse(rr.responseText).data?.Media;
              if(validNumber(m?.meanScore))
                appendRating(c,LOGO.anilist,m.meanScore,'AniList','anilist',`https://anilist.co/anime/${id}`);
            }catch{}
          }
        });
      }catch{}
    }
  });
}

/* === MyAnimeList === */
function fetchMAL(imdbId,c){
  const q=`SELECT ?mal WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P4086 ?mal . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id=JSON.parse(r.responseText).results.bindings[0]?.mal?.value;
        if(!id)return;
        GM_xmlhttpRequest({
          method:'GET',
          url:`https://api.jikan.moe/v4/anime/${id}`,
          onload:rr=>{
            try{
              const d=JSON.parse(rr.responseText).data;
              if(validNumber(d.score))
                appendRating(c,LOGO.myanimelist,d.score,'MyAnimeList','myanimelist',`https://myanimelist.net/anime/${id}`);
            }catch{}
          }
        });
      }catch{}
    }
  });
}

/* === Rotten Tomatoes === */
function fetchRT(imdbId,c){
  const key=`rt_${imdbId}`,cache=localStorage.getItem(key);
  if(cache){
    try{
      const j=JSON.parse(cache);
      if(Date.now()-j.time<CACHE_DURATION){
        const s=j.scores;
        if(validNumber(s.critic))
          appendRating(c,LOGO.tomatoes,s.critic,'RT Critic','rotten_tomatoes_critic',s.link);
        if(validNumber(s.audience))
          appendRating(c,LOGO.audience,s.audience,'RT Audience','rotten_tomatoes_audience',s.link);
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
        const id=JSON.parse(r.responseText).results.bindings[0]?.rtid?.value;
        if(!id)return;
        const path=id.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,'');
        const url=`https://www.rottentomatoes.com/${path}`;
        GM_xmlhttpRequest({
          method:'GET',
          url,
          onload:rr=>{
            try{
              const m=rr.responseText.match(/<script\s+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/);
              if(!m)return;
              const d=JSON.parse(m[1]);
              const critic=parseFloat(d.criticsScore?.score);
              const audience=parseFloat(d.audienceScore?.score);
              const scores={critic,audience,link:url};
              if(validNumber(critic))
                appendRating(c,LOGO.tomatoes,critic,'RT Critic','rotten_tomatoes_critic',url);
              if(validNumber(audience))
                appendRating(c,LOGO.audience,audience,'RT Audience','rotten_tomatoes_audience',url);
              localStorage.setItem(key,JSON.stringify({time:Date.now(),scores}));
            }catch(e){console.error('RT parse error',e);}
          }
        });
      }catch(e){console.error(e);}
    }
  });
}

})();
