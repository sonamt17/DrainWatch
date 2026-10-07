# DrainWatch

A website that tracks environmental risks across New York City, with a focus on how climate change is making
natural disasters more likely. **Floods come first.** Heat, air quality and storms are on the roadmap.

It's plain **HTML, CSS and JavaScript**, with no build step and no frameworks to learn. The map uses
[Leaflet](https://leafletjs.com/), loaded from a CDN.

## What it shows

- **Flood risk right now** for 28 flood-prone and comparison neighborhoods, rated Low / Elevated / High / Severe
  for the next 48 hours.
- **Coastal flooding:** live water levels and storm surge from NOAA tide gauges, compared with NOAA's
  minor / moderate / major flood thresholds.
- **Stormwater flooding:** forecast rainfall intensity compared with the ~1.75 in/hr most NYC sewers can drain.
- **National Weather Service alerts** for flooding, coastal floods and tropical storms.
- **311 reports** of street flooding and sewer backups from the past week, shown on the map.
- **Check an address:** looks up the FEMA flood zone and the past year of 311 flooding reports for any NYC address,
  or for any spot you click on the map.
- **Climate outlook:** sea level rise projections for NYC from the NYC Panel on Climate Change.

## Run it on your computer

You need Python 3, which is already installed on most Macs and Linux machines.

```bash
cd DrainWatch
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Press `Ctrl+C` in the terminal to stop the server.

> Why not just double-click `index.html`? The JavaScript files use `import`, and browsers block that for files
> opened straight from disk. The tiny Python server fixes it.

## API keys

**You don't need any API keys.** Every data source this site uses is free and public:

| Source | What it gives us | Key needed? |
| --- | --- | --- |
| [NOAA Tides & Currents](https://api.tidesandcurrents.noaa.gov/api/prod/) | Water levels, tide predictions | No |
| [Open-Meteo](https://open-meteo.com/) | Hourly rainfall forecast | No (free for non-commercial use) |
| [National Weather Service](https://www.weather.gov/documentation/services-web-api) | Active alerts | No |
| [NYC Open Data — 311](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9) | Flooding complaints | Optional "app token" |
| [NYC GeoSearch](https://geosearch.planninglabs.nyc/) | Address lookup | No |
| [FEMA National Flood Hazard Layer](https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS) | Flood zones | No |

### A quick primer on API keys

An **API** is a web address that returns data instead of a web page. Some APIs ask for an **API key**, a long
password-like string, so they know who is calling and can limit how often. Two rules of thumb:

1. **Keys that are secret must never go in front-end code** (HTML/JS/CSS). Anyone can open the page and read
   them. Secret keys belong on a server, for example a small Python backend.
2. **Some "keys" are designed to be public**, like NYC Open Data's app token. It only identifies your app for rate
   limits and can't be used to do damage, so it's fine to put in `js/config.js`.

### Optional: NYC Open Data app token

Without a token, NYC Open Data allows a limited number of requests per hour from each visitor's IP address. That's
plenty for personal use. If the site gets popular:

1. Create a free account at <https://data.cityofnewyork.us/signup>.
2. Go to your profile → **Developer Settings** → **Create New App Token**.
3. Copy the **App Token**, not the secret, into `js/config.js`:
   ```js
   export const NYC_OPEN_DATA_APP_TOKEN = 'paste-your-token-here';
   ```

## How the risk level is calculated

Everything lives in [`js/risk.js`](js/risk.js):

1. **Hazard (0–4)** from live data:
   - Coastal: peak water level over the next 48 h (predicted tide + current storm surge) vs. NOAA's flood thresholds.
   - Stormwater: the heaviest forecast hour of rain, bumped up if the ground is already soaked.
2. **Exposure (0–3)**, which says how vulnerable the place is:
   - Neighborhoods: a simplified rating in [`js/config.js`](js/config.js), based on FEMA flood maps, NYC DEP
     stormwater flood maps, and damage from Sandy (2012) and Ida (2021).
   - Address checks: the actual FEMA flood zone, plus 311 flooding history as a proxy for stormwater problems.
3. **Score** = hazard × exposure ÷ 3, taking the higher of coastal and stormwater. Active NWS alerts and recent
   311 reports within 1 km add to it. The result is capped at 4.

| Score | Level |
| --- | --- |
| 0 – 1 | Low |
| 1 – 2 | Elevated |
| 2 – 3 | High |
| 3 – 4 | Severe |

This is an educational tool, **not an official warning system**. In an emergency, follow
[Notify NYC](https://www.nyc.gov/notifynyc) and the [NWS](https://www.weather.gov/okx/).

## Project layout

```
index.html          page structure
css/style.css       all styling (light + dark mode)
js/config.js        neighborhoods, tide stations, reference numbers — easy to edit
js/risk.js          the risk model (pure functions, no network)
js/data.js          code that calls each public API
js/tide-chart.js    the little tide graph
js/app.js           ties it together: map, sidebar, address search
tests/risk.test.js  tests for the risk model
```

## Tests

If you have [Node.js](https://nodejs.org/) installed:

```bash
node --test
```

Nothing to install; it uses Node's built-in test runner.

## Ideas for next steps

- **Heat:** heat index forecasts + NYC's Heat Vulnerability Index by neighborhood.
- **Air quality:** AirNow / NYC Community Air Survey data, wildfire smoke alerts.
- Use NYC's official Stormwater Flood Map polygons instead of neighborhood ratings.
- A small Python backend to cache API responses and hold any future secret keys.
