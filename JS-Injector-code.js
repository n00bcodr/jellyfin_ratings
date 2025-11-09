/* =========================================================
   Jellyfin Ratings — Lightweight Injector
   - Put your personal toggles in CONFIG below
   - Loads the main script from your GitHub (raw)
   - Cache-busts each load to avoid stale code
========================================================= */

/* 1) CONFIG — edit these as you like */
window.MDBL_CFG = {
  /* Sources to show */
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

  /* Display options */
  display: {
    showPercentSymbol:   true,     // “78%” vs “78”
    colorizeRatings:     true,     // green/orange/red based on thresholds
    colorizeNumbersOnly: true,     // false => color + soft glow on icon
    align:               'left',   // 'left' | 'center' | 'right'
    endsAtFormat:        '24h',    // '24h' | '12h'
    endsAtBullet:        false,     // add " • " before “Ends at …”
  },

  /* Spacing/layout */
  spacing: {
    ratingsTopGapPx:     8,        // gap between first row and ratings row
  },

  /* Sorting (lower number = earlier) */
  priorities: {
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
    myanimelist:              11,
  },
};

/* 2) LOADER — fetch from your raw GitHub URL and execute */
(async function loadJellyfinRatings() {
  // Update this if you rename/move the file or pin to a tag/commit
  const RAW_URL = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js';
  const url     = `${RAW_URL}?t=${Date.now()}`; // quick cache-bust

  try {
    console.groupCollapsed('[jellyfin_ratings] loader');
    console.info('Fetching:', RAW_URL);

    const res = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${RAW_URL}`);

    const code = await res.text();

    // Prefer Function (slightly safer scope). Fallback to eval if blocked.
    try {
      new Function(code)();
    } catch {
      (0, eval)(code);
    }

    console.info('Loaded successfully.');
    console.groupEnd();
  } catch (err) {
    console.groupCollapsed('[jellyfin_ratings] loader ERROR');
    console.error(err);
    console.groupEnd();
  }
})();
