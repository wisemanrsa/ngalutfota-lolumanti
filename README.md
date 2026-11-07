# Ngalutfota Lolumanti tracker

Static web app, no dependencies, no build step.

- `index.html`: page and styles (light/dark follow the system setting)
- `app.js`: UI, in-app audio player, saves listening position
- `catalogue.js`: Omny fetch, title parser, grouping, progress/undo logic
- `verify.js`: checks the parser, grouping and persistence against the live API (`node verify.js`)

## Run

```
python -m http.server 8000
```

Then open http://localhost:8000. Always use the same address, because progress is
saved in that browser's localStorage, and a different host or port gets separate storage.

## Phone

Upload `index.html`, `app.js`, `catalogue.js`, `manifest.json` and the `icons/` folder to a static host
(e.g. GitHub Pages), then open the URL on the phone and choose **Add to Home Screen**
(iPhone: Safari > Share; Android: Chrome menu). It opens full-screen with its own icon.

- Audio keeps playing with the screen locked or the app in the background.
- Lock screen / notification / Bluetooth / car controls: play, pause, −15s, +30s, seek bar.
- When an episode ends it is marked finished. The **Auto-play next** switch (Up next card and player bar,
  off by default, saved per device) decides whether the next unfinished episode then starts or playback stops.
- Progress is per device. Move it with **Back up progress** (PC) and **Restore backup** (phone).
  On iPhone, restore inside the home-screen app, since it has its own storage separate from Safari.

## Data rules

- Episode number = first standalone 3–4 digit number in the title after `(dd.mm.yyyy)` dates are removed.
  URL slugs are ignored.
- Clips with no number are excluded and listed on the page.
- Several uploads of one number are grouped. "Listen" plays the longest one, and each upload has its own Play link.
- The main sequence runs from 1140 to the latest episode. Missing numbers show as "not online".
  Numbers below 1140 (episode 1050) are listed under "Older short clips".
- Progress is stored by episode number (`nl.progress.v1`), so a catalogue refresh never shifts it.
