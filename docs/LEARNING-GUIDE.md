# DrainWatch: Learning Guide

The goal: know this project **as if you made it**. That means you can:
1. explain what every file does and why it's built that way,
2. trace any number on screen back to the API it came from,
3. rebuild any small piece from memory and have the tests pass.

**Three documents work together:**
| Doc | Use it for |
| --- | --- |
| this guide | the order to learn things in, and what to practice |
| [APIS.md](APIS.md) | where every piece of data comes from, with real sample responses |
| [rename-sheet.csv](rename-sheet.csv) | every file, function, variable, HTML id and CSS class: what it is, plus a column for **your** name. Opens in Numbers or Excel |

**Run it**
```bash
cd ~/DrainWatch
python3 -m http.server 8000
```
Open <http://localhost:8000> with DevTools open (Cmd+Option+I → Console + Network).
Try: `#heat`, `#air/smoke-2023`, `#floods/sandy/2080s`.

**Suggested pace:** Part A in week 1, Parts B + C in week 2, Part E (rebuild from memory) after that. Part D (the story) is last.

---

## Lesson 0: The big picture

```
index.html, css/style.css        the page and how it looks
js/app.js                        the boss: holds state, handles clicks, calls everything else
│
├── js/facts/      plain data      config.js (39 neighborhoods), content.js (checklist text)
├── js/apis/       the internet    data.js (8 APIs, see APIS.md)
├── js/models/     pure math       risk.js, heat-risk.js, air-risk.js, storm-risk.js   ← 4 risk models
│                                  hazards.js (runs a model citywide), scenarios.js (replays),
│                                  terrain.js (elevation)
├── js/page/       what you see    map.js, panels.js, sections.js, ui.js
└── js/story/      the story       stories.js, controller.js + small helpers

data/          2 data files made once (shapes + elevation)        see APIS.md
vendor/        another person's library: Leaflet (the map). Don't read it
scripts/build/ one-time tools that made data/ and vendor/
tests/         node --test
```

**Data flows one way:**
```
APIs ──▶ apis/data.js ──▶ state.live ──▶ models/hazards.js ──▶ results ──▶ page/*.js ──▶ screen
                           (or a replay from models/scenarios.js)
```

**What happens when the page loads** (bottom of [js/app.js:982](../js/app.js:982)):
1. Read the URL hash (`#heat`) → pick a hazard.
2. Draw the map and empty cards (`renderApp()`).
3. `loadLive()` fetches tides, weather, air, alerts and 311 **all at once**.
4. `hazards.js` scores all 39 neighborhoods → Low / Elevated / High / Severe.
5. `renderApp()` redraws everything from the results.
6. Every 15 minutes (only if the tab is visible), repeat.

**The two rules the whole project follows**
- **Pure vs. not pure.** Everything in `facts/` and `models/`, and most of `page/`, is *pure*: same input → same output,
  no `fetch`, no `document`. That's why 77 tests can check them without a browser.
- **One `state` object, redraw from it.** ([js/app.js:74](../js/app.js:74)) When anything changes: update `state`,
  call `renderApp()`. You never patch one card by hand.

---

# Part A: The core

## Lesson 1: `index.html`

Read: [index.html](../index.html). Skim it, noticing each section and its `id`.
For any id you don't understand, look it up in the rename sheet (filter `kind` = `html id`).

- `<a class="skip" href="#check">`: a hidden "skip link" for keyboard users.
- The dashboard: `right-now-card` (Right now), `#check` (address), `dash-map` (map), `#time-machine`, `#explore` (tabs).
- Two pop-ups, hidden at first: the story (`#story`) and Compare (`<dialog id="compare">`).
- Most boxes are empty (`id="details"`, `id="ranking"`); JS fills them.

**Try it:** search `index.html` for `id="now-headline"`, then search `js/app.js` for `'now-headline'`.

## Lesson 2: `js/facts/config.js`

Read: [js/facts/config.js](../js/facts/config.js) (101 lines)

- `TIDE_STATIONS`: 4 NOAA tide gauges as an **object keyed by name**, so code can do `TIDE_STATIONS[area.station]`.
- `AREAS`: 39 neighborhoods, each with five hand-made ratings:

| Rating | Range | Hazard |
| --- | --- | --- |
| `coastalExposure` | 0–3 | ocean flooding (Sandy) |
| `stormwaterExposure` | 0–3 | rain flooding (Ida) |
| `hvi` | 1–5 | heat (NYC Heat Vulnerability Index) |
| `asthma` | 1–5 | air quality |
| `windExposure` | 1–3 | wind |

**Try it:** pick 3 neighborhoods you know. Do their numbers make sense to you? If not, you can change them; that's your call as the author.

## Lesson 3: The flood model, `js/models/risk.js` ⭐

Read: [js/models/risk.js](../js/models/risk.js) (182 lines). **The most important file.** The other three models copy its shape.

```
hazard    = how bad is it about to get?      0–4   (live data)
exposure  = how vulnerable is this place?    0–3   (config.js)
score     = hazard × exposure ÷ 3  (+ alerts, + 311 reports), kept between 0 and 4
```
It's done twice, once for **coastal** and once for **stormwater** flooding, and the **bigger one wins**.

| Score | 0–1 | 1–2 | 2–3 | 3–4 |
| --- | --- | --- | --- | --- |
| Level | Low | Elevated | High | Severe |

Example: water forecast at moderate flood stage → coastal hazard 3.
Red Hook (exposure 3): 3 × 3 ÷ 3 = **3 → Severe**. Woodside (exposure 0): **0 → Low**.

Read in this order:
1. `LEVELS` [7](../js/models/risk.js:7) + `levelFor` [92](../js/models/risk.js:92): score → level
2. `thresholdsFromGreatDiurnalRange` [20](../js/models/risk.js:20): NOAA's formula for flood stages (~1.8 / 2.8 / 4.0 ft at the Battery)
3. `coastalHazard` [31](../js/models/risk.js:31), `rainfallHazard` [46](../js/models/risk.js:46): data → 0–4
4. `alertSeverity` [61](../js/models/risk.js:61), `classifyAlert` [70](../js/models/risk.js:70): alert name → kind + severity (regex)
5. `assess` [115](../js/models/risk.js:115): everything combined, plus the `reasons` sentences you see in popups

**Try it** (browser Console on the running site):
```js
const r = await import('./js/models/risk.js');
r.levelFor(2.5);
r.rainfallHazard(0.6);
r.rainfallHazard(0.6, 2.0);   // soaked ground → one step higher
r.classifyAlert('Coastal Flood Warning');
```

## Lesson 4: The other three models

[heat-risk.js](../js/models/heat-risk.js), [air-risk.js](../js/models/air-risk.js), [storm-risk.js](../js/models/storm-risk.js). Same recipe:
**hazard 0–4 from data → × vulnerability → + alert boost → clamp → level + reasons.**

| Model | Hazard from | Vulnerability |
| --- | --- | --- |
| Heat | peak **heat index** (`heatIndexF`, the official NWS formula), + warm nights | HVI 1–5 |
| Air | peak **AQI** (EPA categories) | asthma 1–5 |
| Wind | peak **gust** vs NWS limits 46 / 58 / 74 mph, + thunderstorms | windExposure 1–3 |

**Try it:** put `assessHeat` ([heat-risk.js:74](../js/models/heat-risk.js:74)) next to `assess` in `risk.js` and list what's the same.

## Lesson 5: `js/models/hazards.js` (the switchboard)

Read: [js/models/hazards.js](../js/models/hazards.js) (240 lines)

- `assessPlace(hazard, place, inputs, i)` [43](../js/models/hazards.js:43): one `if` per hazard, picks the right model and feeds it.
- `assessAll` [89](../js/models/hazards.js:89): runs it for all 39 neighborhoods.
- `citySummary` [123](../js/models/hazards.js:123): the headline sentence and stat tiles.

`inputs` can be live data **or** a replay. `hazards.js` can't tell the difference, and that's the whole trick behind the Time Machine.

## Lesson 6: Tests

Read [tests/risk.test.js](../tests/risk.test.js), then skim the other files in `tests/`.
```bash
node --test
```
77 tests. Each one sets up a situation and checks `assert.equal(actual, expected)`.

**Try it:** in `rainfallHazard`, change `>= 1.75` to `>= 2.5`. Run the tests and see which fail. Change it back.

## Lesson 7: `js/apis/data.js` (the internet)

Read it **side by side with [APIS.md](APIS.md)**. For each API, open the sample URL in your browser first, then read the function.

- `fetchJson` [24](../js/apis/data.js:24): every call goes through it (20 s timeout, throws on errors).
- `fetchTides` [83](../js/apis/data.js:83), `fetchWeather` [199](../js/apis/data.js:199), `fetchAirQuality` [246](../js/apis/data.js:246),
  `fetchAlerts` [265](../js/apis/data.js:265), `fetchRecent311` [301](../js/apis/data.js:301), `geocode` [332](../js/apis/data.js:332),
  `fetchFemaZone` [386](../js/apis/data.js:386), `fetchEvacZone` [428](../js/apis/data.js:428)
- **fetch vs. summarize:** `fetchWeather` downloads; `summarizeWeather` [151](../js/apis/data.js:151) (pure) boils 72 hours down to
  "peak rain, peak gust, overnight low…". Replays reuse the summarizers.

## Lesson 8: `js/app.js` (the boss)

Read [js/app.js](../js/app.js) section by section (find the `// ------` lines):

| Line | Section | What to understand |
| --- | --- | --- |
| 1–100 | setup | imports, `state` [74](../js/app.js:74), the `$` shortcut |
| [101](../js/app.js:101) | inputs | `baseInputs`: live or replay. `inputsFor`: adds sea level rise (floods only) |
| [169](../js/app.js:169) | dashboard | `renderApp`: **the** redraw. Read every line |
| [243](../js/app.js:243) | Time Machine | which neighborhoods get worse as the sea rises |
| [402](../js/app.js:402) | routing | `readHash`/`writeHash`: URL ↔ state, so links are shareable |
| [444](../js/app.js:444) | live data | `track` (try/catch per source) + `loadLive` with `Promise.all` |
| [490](../js/app.js:490) | address check | `checkPoint`: geocode → FEMA + 311 + weather + evac zone + elevation → report |
| [631](../js/app.js:631) | Compare | the side-by-side dialog |
| | story | `openStory`/`closeStory`, and `onStoryPosition` moves the slider and chapter tabs |
| [770](../js/app.js:770) | events | every `addEventListener` |
| [982](../js/app.js:982) | start | the start-up sequence |

**Try it**
- Add `console.log(state)` at the end of `loadLive()` and explore the object.
- Turn off Wi-Fi and reload: each card fails on its own.
- Visit `#wind/isaias` and watch `readHash` pick it up.

---

# Part B: Drawing the page

## Lesson 9: HTML builders (`js/page/`)
- [ui.js](../js/page/ui.js): `esc()` makes text safe for HTML; `level()` shows a **word** plus a color, never color alone.
- [panels.js](../js/page/panels.js): pure functions, data in → HTML string out. The pattern everywhere:
  `list.map((x) => \`<li>${esc(x.name)}</li>\`).join('')`
- [sections.js](../js/page/sections.js): sections below the dashboard; the checklist is saved in `localStorage`.
- [js/facts/content.js](../js/facts/content.js): just words, easy to edit.

## Lesson 10: Forecast tables
In [panels.js](../js/page/panels.js), `hourlyTable()` turns 48 hourly numbers into a table with one row every
6 hours (a `for` loop with `i += 6`), and `highTidesTable()` finds each high tide: a reading higher than the one
before and after it.

## Lesson 11: The map
[map.js](../js/page/map.js): Leaflet, like your first project: `drawAreas()` puts one `L.circleMarker` per
neighborhood, colored by its risk level. Toggleable layers: flooded land, FEMA zones, 311 dots, tide gauges.
Dark mode is just a CSS `filter` on the tiles.

## Lesson 12: CSS
[css/style.css](../css/style.css): read the top ~80 lines carefully, then skim.
- **Tokens** at the top: `--paper`, `--ink`, and a 5-step color ramp `--r0`…`--r4` **per hazard** (`[data-hazard='heat'] { … }`).
  `app.js` sets `<body data-hazard="heat">`, so the whole page recolors itself.
- `.lvl-low` … `.lvl-severe` set `--lvl` to a ramp color; badges, map shapes and charts all read `var(--lvl)`.
- Dark mode both ways: automatic (`prefers-color-scheme`) and manual (`data-theme`).
- Layout: grid dashboard, sticky map, `@media` for phones.

---

# Part C: The clever features

## Lesson 13: Replays + sea level rise ([scenarios.js](../js/models/scenarios.js))
- `SCENARIOS` [19](../js/models/scenarios.js:19): Sandy 2012, Ida 2021, heat wave 2019, smoke 2023, Isaias 2020.
- Each replay **builds fake raw data in exactly the API's format**, so the real summarizers and models run on it unchanged.
- `withSeaLevelRise` [128](../js/models/scenarios.js:128) adds inches to every tide reading. The Time Machine is *the same storm on a higher sea*.

## Lesson 14: Elevation ([terrain.js](../js/models/terrain.js))
`data/nyc-elevation.png` stores **height as pixel color** (see APIS.md).
- `elevationAt` [80](../js/models/terrain.js:80): height at any lat/lon
- `findHigherGround` [116](../js/models/terrain.js:116): searches outward for land ≥ 6 m
- `floodRaster` [204](../js/models/terrain.js:204): colors every pixel below the water ("bathtub" estimate)

---

# Part D: The story (last)

| File | Job |
| --- | --- |
| [stories.js](../js/story/stories.js) | the 4 stories: replay, sentences, neighborhoods to zoom into, and the color cutoffs (`levelAt`). Every number in the text is computed |
| [controller.js](../js/story/controller.js) | the player: a list of frames (each hour, then each neighborhood), a Leaflet map, Play with `setTimeout`, zoom with `flyTo` |
| [geo.js](../js/story/geo.js) | map math: point-in-polygon, distance (used by `terrain.js` and the scripts) |
| [elevation.js](../js/story/elevation.js) | how to read the elevation picture |

---

# Part E: Build it yourself, in order

This is how you'd have built DrainWatch from an empty folder. Each milestone lists the real files,
**what you must be able to explain**, and a **prove it** task. Do the task from memory first, then compare with the real code.

| # | Milestone | Real files | Explain | Prove it |
| --- | --- | --- | --- | --- |
| 1 | A page with a map | `index.html`, `js/page/map.js` (`createMap`) | Leaflet tiles, `setView`, why `type="module"` needs a server | In a blank file, show a Leaflet map of NYC with one marker |
| 2 | Neighborhood facts | `js/facts/config.js` | why ratings are numbers, why `TIDE_STATIONS` is an object | Add a 40th neighborhood; it shows up everywhere |
| 3 | One API | `js/apis/data.js` (`fetchJson`, `fetchWeather`) | fetch / await / `.json()`, URLSearchParams, the response shape | Fetch Open-Meteo for 2 places in one URL and log the peak rain |
| 4 | Turn data into a level | `js/models/risk.js` | hazard × exposure ÷ 3, why clamp, why two flood types | Delete `rainfallHazard`, rewrite it, and `node --test` passes |
| 5 | Color the map | `app.js` (`renderApp`), `map.js` (`drawAreas`), CSS `--lvl` | state → render, CSS variables | Change the Severe color in one place only |
| 6 | Many APIs at once | `app.js` (`loadLive`, `track`) | `Promise.all`, failing one source without failing all | Explain what the page does when NOAA is down |
| 7 | More hazards | `heat-risk.js`, `air-risk.js`, `storm-risk.js`, `hazards.js` | the shared recipe, the switchboard | Write `windHazard` from memory; tests pass |
| 8 | Address check | `app.js` (`checkPoint`), `data.js` (`geocode`, `fetchFemaZone`, `fetchEvacZone`) | form submit, `preventDefault`, chaining lookups | Trace one address through every API it touches (use APIS.md) |
| 9 | Tabs and tables | `panels.js`, `sections.js` | building HTML strings safely (`esc`), `for` loops | Add a column to the neighborhood table |
| 10 | Replays + Time Machine | `scenarios.js`, `terrain.js` | fake raw data → same pipeline; sea level as inches on tides | Add a made-up storm replay to `SCENARIOS` |
| 11 | Shareable links, themes | `readHash`/`writeHash`, theme toggle, CSS dark mode | `location.hash`, `localStorage`, `prefers-color-scheme` | Add `#heat` style links for one more setting |
| 12 | The story | `js/story/*` | frames, `setTimeout` for Play, `flyTo` to zoom | Change a story beat's sentence |

When you can do all the "prove it" tasks, you know this project like its author.

---

## Renaming things to your own names

1. Open [rename-sheet.csv](rename-sheet.csv) in Numbers or Excel.
2. As you learn each lesson, fill in **MY NAME** for anything whose name doesn't make sense to you. Leave the rest blank.
3. Read the **rename notes** column first: some names are shared across files, used by tests, or built in code (`lvl-${level}`).
4. Send me the sheet (or tell me the names). I'll rename everywhere at once (JS, HTML, CSS, tests, docs) and run the tests.

Tip: rename a few at a time, after the lesson that covers them. Renaming 700 names at once means relearning the project from scratch.

---

## JavaScript you'll meet that's not in your notes yet

| Code | Means |
| --- | --- |
| `import { a } from './x.js'` / `export function a` | share code between files |
| `await import('./x.js')` | load a file only when needed |
| `const { a, b } = obj` / `const [x, y] = arr` | destructuring: pull values out |
| `a?.b` | `a.b`, but no crash if `a` is null |
| `a ?? b` | `a`, unless null/undefined → `b` |
| `{ ...obj, x: 1 }` | copy an object, change one field |
| `Promise.all` / `Promise.allSettled` | run fetches together; *allSettled* survives one failing |
| `new Map()` / `new Set()` | dictionary / list without duplicates |
| `/flood/i.test(text)` | regex: does text contain "flood", any case? |
| `.reduce`, `.find`, `.some` | one value from a list / first match / is any true? |
| `el.dataset.hazard` | read/write `data-hazard="…"` |
| `localStorage.setItem(k, v)` | save small things in this browser |
| `history.replaceState(null, '', '#heat')` | change the URL without reloading |
| `clearTimeout(t); t = setTimeout(…)` | "debounce": wait until the user stops |

---

## Final check: could you defend this project?

Answer out loud, as if someone asked you about *your* project:
1. What happens between opening the page and seeing colored neighborhoods?
2. How does Red Hook go from "storm surge coming" to "Severe"? How is heat in the Bronx different?
3. How can the same code show live data *and* Hurricane Sandy?
4. What happens when NOAA's API is down?
5. Name every API the address check uses, and what each one adds.
6. What does the Time Machine slider actually change in the data?
7. How does the story's Play button move from hour to hour?
8. Where do the 39 neighborhood ratings come from, and what are their limits?
