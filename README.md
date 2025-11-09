Jellyfin Ratings Overlay

A lightweight userscript/JS-injector add-on that overlays rich ratings and quick links on Jellyfin item pages. It pulls scores from multiple sources, lets you reorder sources via drag & drop, and includes an in-app settings panel.

Community script — not an official Jellyfin plugin.

Features

Multiple rating sources with per-source toggles. Pulls from:

IMDb

TMDb

Trakt

Letterboxd

Rotten Tomatoes (Critic)

Rotten Tomatoes (Audience)

Roger Ebert

Metacritic (Critic)

Metacritic (User)

AniList

MyAnimeList

Clean visuals: compact ratings with clickable icons and numbers.
Tip: clicking a source icon opens the provider’s page for that title. Clicking a rating number opens the settings panel.

Easy reordering: drag & drop sources in the settings menu.

Smart hiding: ratings are hidden when not found (no more NaN).

Screenshots

Replace the paths below with the image paths in your repo (e.g., ./docs/… or ./assets/…).




Requirements

Jellyfin Web Interface (desktop browser)

One of the following install methods:

Jellyfin JS Injector plugin (recommended)

Userscript manager (Tampermonkey/Violentmonkey) — optional alternative

API keys

MDBList API key (required)
No other API keys are required.

Installation
Option A — JS Injector (Recommended)

Install a JS Injector plugin for Jellyfin (via Admin Dashboard).

Open this repo’s JS-Injector-code.js and copy its entire contents.

Paste that code into your Jellyfin JS Injector. Put your MDBList API key in the key field at the top (inside JS-Injector-code.js).

Save, reload Jellyfin, open any movie/show page.

Click any rating number to open the settings panel.

Click a source icon to jump to that title on the provider’s site.

Your key stays local in the injector and is read by the script at runtime.
Important: MDBList API key is required. TMDb is not required.

Configuration

You can configure the script in two places:

Injector Config (window.__JFR_INJECTOR_CONFIG__) — preferred for secrets

Set your MDBList key & any toggles in the injector file/snippet.

The script reads these values at startup.

MDBList API key is mandatory; no other keys are required.

In-App Settings Panel

Open it by clicking a rating number on an item page

Toggle sources on/off and drag to reorder their display

Persisted to localStorage so settings stick across reloads

How it works

The injector (or userscript) defines window.__JFR_INJECTOR_CONFIG__.

ratings.js loads, merges config with defaults, then mounts UI elements:

Rating icons injected into the item header area

Click a rating number → opens the settings dialog

Click a source icon → opens that provider’s page for the title

Requests use MDBList (and others as applicable). Missing ratings are hidden gracefully.

Privacy & Security

API keys are used client-side only. Keep your MDBList key in the Injector so you don’t commit secrets.

No analytics, no tracking. Requests go directly to providers (with a small, open proxy fallback only where necessary for CORS).

License

MIT

Credits

Thanks to the Jellyfin community and to the public APIs/providers used by this script.
