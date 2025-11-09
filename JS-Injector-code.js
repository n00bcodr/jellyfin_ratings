/* =========================================================
   Jellyfin Ratings — Injector (safe keys + toggles)
   - Keys stay on your client; not in GitHub
   - Loads ratings.js from your repo
========================================================= */

/* 1) CONFIG — your preferences */
window.MDBL_CFG = {
  sources: {
    imdb:                true,
    tmdb:                true,
    trakt:               true,
    letterboxd:          true,
    rotten_tomatoes:     true,
    roger_ebert:         true,
    anilist:             true,
    myanimelist:         true,
    metacritic_critic:   true,
    metacritic_user:     true,
  },
  display: {
    showPercentSymbol:   true,
    colorizeRatings:     true,
    colorizeNumbersOnly: true,
    align:               'left',
    endsAtFormat:        '24h',
    endsAtBullet:        true,
    iconsOnly:           false, // set true for icons-only
  },
  spacing: { ratingsTopGapPx: 8 },
  priorities: {
    imdb: 1, tmdb: 2, trakt: 3, letterboxd: 4,
    rotten_tomatoes_critic: 5, rotten_tomatoes_audience: 6,
    roger_ebert: 7, metacritic_critic: 8, metacritic_user: 9,
    anilist: 10, myanimelist: 11,
  },
};

/* 2) KEYS — prefilled (client-side only) */
(function ensureKeys(){
  const KEYS = {
    // Required for MDBList API:
    MDBLIST: 'hehfnbo9y8blfyqm1d37ikubl',

    // Optional future keys (not used by ratings.js right now):
    // TMDB:   'YOUR_TMDB_KEY_HERE',
    // TRAKT:  'YOUR_TRAKT_KEY_HERE',
  };

  // Primary path for ratings.js
  window.MDBL_KEYS = KEYS;

  // Mirror to localStorage so reloads keep working
  try { localStorage.setItem('mdbl_keys', JSON.stringify(KEYS)); } catch {}
})();

/* 3) (Optional) Show status in console once ratings.js is loaded */
(function pingStatusLater(){
  const tick = setInterval(()=>{
    if (window.MDBL_STATUS) {
      console.groupCollapsed('[jellyfin_ratings] status');
      console.log('Version:', window.MDBL_STATUS.version);
      console.log('Keys:', window.MDBL_STATUS.keys); // { MDBLIST: true }
      console.groupEnd();
      clearInterval(tick);
    }
  }, 1000);
  setTimeout(()=>clearInterval(tick), 15000);
})();

/* 4) LOADER — fetch from your raw GitHub URL and execute */
(async function loadJellyfinRatings() {
  const RAW_URL = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js';
  const url     = `${RAW_URL}?t=${Date.now()}`; // cache-bust

  try {
    console.groupCollapsed('[jellyfin_ratings] loader');
    console.info('Fetching:', RAW_URL);

    const res = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${RAW_URL}`);

    const code = await res.text();

    try { new Function(code)(); } catch { (0, eval)(code); }

    console.info('Loaded successfully.');
    console.groupEnd();
  } catch (err) {
    console.groupCollapsed('[jellyfin_ratings] loader ERROR');
    console.error(err);
    console.groupEnd();
  }
})();
