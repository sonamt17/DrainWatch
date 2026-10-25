# Where every piece of data comes from

DrainWatch uses **9 outside services** and **2 data files that ship with the site**. None of the services needs an
API key. Every live call is in [`js/apis/data.js`](../js/apis/data.js), except the map tiles ([`js/page/map.js`](../js/page/map.js)).

The sample responses below are **real**. They were fetched on October 23, 2026 and trimmed with `...`.
Paste any URL into your browser to see the full answer yourself.

| # | Service | Who runs it | Used for | Function |
| --- | --- | --- | --- | --- |
| 1 | NOAA Tides & Currents | US government (NOAA) | water level, tide forecast, storm surge | `fetchTides` |
| 2 | Open-Meteo Forecast | Open-Meteo (Swiss nonprofit) | rain, temperature, humidity, wind | `fetchWeather` |
| 3 | Open-Meteo Air Quality | Open-Meteo | AQI, smoke (PM2.5), ozone | `fetchAirQuality` |
| 4 | NWS Alerts | US government (National Weather Service) | warnings, watches, advisories | `fetchAlerts` |
| 5 | NYC 311 | NYC Open Data | street flooding complaints | `fetchRecent311`, `fetch311History` |
| 6 | NYC Evacuation Zones | NYC Open Data (NYC Emergency Management) | hurricane evacuation zone of an address | `fetchEvacZone` |
| 7 | NYC GeoSearch | NYC Planning Labs | address → lat/lon, and back | `geocode`, `reverseGeocode` |
| 8 | FEMA Flood Hazard Layer | US government (FEMA) | official flood zone; the map's flood-zone layer | `fetchFemaZone`, `makeFemaLayer` |
| 9 | OpenStreetMap tiles | OpenStreetMap volunteers | the map background images | `addBasemap` |
| — | `data/nyc-ntas.geojson` | made once from NYC City Planning data | neighborhood shapes in the story's map | `loadNtas` |
| — | `data/nyc-elevation.png` | made once from USGS elevation data | ground height everywhere in NYC | `loadTerrain` |

### Words you'll see
- **API**: a web address that returns data (usually JSON) instead of a web page.
- **Query string**: everything after `?` in a URL: `?station=8518750&datum=MHHW`. Each `key=value` is one setting; `&` separates them.
  The code builds these with `new URLSearchParams({...})`.
- **JSON**: text that looks like JavaScript objects and arrays. `await res.json()` turns it into real objects.
- **GeoJSON**: JSON for maps. A `FeatureCollection` holds `features`; each has `geometry` (the shape or point) and `properties` (facts about it).
  **Careful: GeoJSON coordinates are `[longitude, latitude]`**, the opposite order from Leaflet's `[lat, lon]`.
- **Socrata / SoQL**: the system behind NYC Open Data. Its settings start with `$`: `$select` (which columns), `$where` (filter, like SQL), `$order`, `$limit`.

---

## 1. NOAA Tides & Currents

**Docs:** <https://api.tidesandcurrents.noaa.gov/api/prod/>
**Called twice per tide gauge** (4 gauges, listed in `TIDE_STATIONS` in [`js/facts/config.js`](../js/facts/config.js)).

**a) What the water is doing right now**
```
https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8518750&datum=MHHW&units=english&time_zone=lst_ldt&format=json&product=water_level&date=latest
```
**b) What the tide is predicted to do for the next 49 hours** (`product=predictions&begin_date=20261023 00:00&range=49`)

| Setting | Means |
| --- | --- |
| `station=8518750` | which gauge (8518750 = The Battery, the tip of Manhattan) |
| `datum=MHHW` | measure heights from **Mean Higher High Water**, the average high tide. So `0` = a normal high tide, `+1.8` = minor flooding |
| `units=english` | feet, not meters |
| `time_zone=lst_ldt` | local time, with daylight saving |
| `product=` | `water_level` = measured, `predictions` = astronomical tide forecast |

**Sample answer (a)**
```json
{
  "metadata": { "id": "8518750", "name": "The Battery", "lat": "40.7006", "lon": "-74.0142" },
  "data": [ { "t": "2026-10-22 23:54", "v": "-3.445", "s": "0.039", "f": "1,0,0,0", "q": "p" } ]
}
```
**Sample answer (b)**
```json
{ "predictions": [ { "t": "2026-10-23 00:00", "v": "-4.554" }, { "t": "2026-10-23 00:06", "v": "-4.582" }, "..." ] }
```

| Field | Means | We turn it into |
| --- | --- | --- |
| `t` | time, local | `latest.t`, `predictions[].t` |
| `v` | water height in ft above MHHW. **It's a string**, so the code does `parseFloat(v)` | `latest.v`, `predictions[].v` |
| `s`, `f`, `q` | data-quality flags | not used |

**What `fetchTides` returns:** `{ station, stationKey, thresholds, latest, surge, predictions, peak }`
- `surge` = measured − predicted at the same moment. Positive = wind and storm pushing extra water in.
- `peak` = highest predicted tide in the next 48 h, plus the surge.
- `thresholds` = minor / moderate / major flood heights, computed by NOAA's formula in `risk.js`.

---

## 2. Open-Meteo Forecast

**Docs:** <https://open-meteo.com/en/docs>. Free for non-commercial use, no key.
**One request for all 39 neighborhoods**: the latitudes and longitudes are comma-separated lists.
```
https://api.open-meteo.com/v1/forecast?latitude=40.6759&longitude=-74.0107&hourly=precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code&precipitation_unit=inch&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&past_days=1&forecast_days=3
```

| Setting | Means |
| --- | --- |
| `hourly=` | which numbers to get, one value per hour |
| `*_unit=` | inches, °F, mph instead of metric |
| `past_days=1` | include yesterday, so we can total the last 24 h of rain (soaked ground) |
| `forecast_days=3` | enough to cover the next 48 h from any time of day |

**Sample answer** (for 39 points you get a list of 39 of these)
```json
{
  "latitude": 40.684258, "longitude": -74.00207, "timezone": "America/New_York", "elevation": 7.0,
  "hourly_units": { "time": "iso8601", "precipitation": "inch", "temperature_2m": "°F", "relative_humidity_2m": "%",
                    "wind_speed_10m": "mp/h", "wind_gusts_10m": "mp/h", "weather_code": "wmo code" },
  "hourly": {
    "time":                 ["2026-10-23T00:00", "2026-10-23T01:00", "..."],
    "precipitation":        [0.0, 0.0, "..."],
    "temperature_2m":       [54.4, 52.7, "..."],
    "relative_humidity_2m": [54, 63, "..."],
    "wind_speed_10m":       [7.7, 7.4, "..."],
    "wind_gusts_10m":       [17.9, 25.9, "..."],
    "weather_code":         [0, 0, "..."]
  }
}
```
Notice the shape: **one array per variable**, all lined up by position. `hourly.temperature_2m[5]` is the temperature at `hourly.time[5]`.

| Field | Means | Feeds |
| --- | --- | --- |
| `precipitation` | rain that hour, inches | flood model (sewers handle ~1.75 in/hr) |
| `temperature_2m` | air temp 2 m above ground | heat model |
| `relative_humidity_2m` | humidity % | heat index = temp + humidity (`heatIndexF`) |
| `wind_speed_10m`, `wind_gusts_10m` | steady wind and gusts, 10 m up | wind model |
| `weather_code` | WMO weather code: 95 = thunderstorm, 96/99 = thunderstorm with hail | wind model |

`summarizeWeather` boils all of that down to: `maxHourly`, `past24`, `next48Total`, `maxHeatIndex`, `overnightLow`, `maxGust`, `maxWind`, `weatherCodes`.

---

## 3. Open-Meteo Air Quality

**Docs:** <https://open-meteo.com/en/docs/air-quality-api>
```
https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.6759&longitude=-74.0107&hourly=us_aqi,us_aqi_pm2_5,us_aqi_ozone,pm2_5,ozone&timezone=America/New_York&forecast_days=3
```
**Sample answer**: same shape as the forecast.
```json
{
  "hourly_units": { "us_aqi": "USAQI", "us_aqi_pm2_5": "USAQI", "us_aqi_ozone": "USAQI", "pm2_5": "μg/m³", "ozone": "μg/m³" },
  "hourly": {
    "time": ["2026-10-23T00:00", "..."],
    "us_aqi": [39, "..."], "us_aqi_pm2_5": [39, "..."], "us_aqi_ozone": [19, "..."],
    "pm2_5": [8.1, "..."], "ozone": [33.0, "..."]
  }
}
```
| Field | Means |
| --- | --- |
| `us_aqi` | the EPA Air Quality Index, 0–500 (0–50 Good, 151+ Unhealthy) |
| `us_aqi_pm2_5`, `us_aqi_ozone` | the AQI from each pollutant alone. The bigger one is "dominant" |
| `pm2_5` | tiny particles (wildfire smoke), micrograms per m³ |
| `ozone` | ozone (summer smog) |

`summarizeAir` → `{ currentAqi, peakAqi, peakAqiTime, pm25, ozone, dominant }`.

---

## 4. National Weather Service alerts

**Docs:** <https://www.weather.gov/documentation/services-web-api>
```
https://api.weather.gov/alerts/active?area=NY
```
Every active alert in New York **State**. The code keeps only the ones that cover an NYC borough.

**Sample answer** (GeoJSON, trimmed to the parts we use)
```json
{
  "type": "FeatureCollection",
  "features": [
    { "properties": {
        "event": "Coastal Flood Statement",
        "headline": "Coastal Flood Statement issued October 22 at 3:00PM EDT until October 23 at 8:00AM EDT by NWS Upton NY",
        "severity": "Minor",
        "areaDesc": "Southern Nassau",
        "ends": "2026-10-23T08:00:00-04:00",
        "expires": "2026-10-22T23:00:00-04:00",
        "geocode": { "SAME": ["036059"], "UGC": ["NYZ179"] }
    } }
  ]
}
```
| Field | Means |
| --- | --- |
| `event` | the alert's name. `classifyAlert` reads words in it ("Flood", "Warning", "Heat", "Air Quality"…) |
| `geocode.SAME` | county codes the alert covers. NYC's 5 are in `BOROUGH_SAME` in config.js (`036047` = Kings County = Brooklyn). This sample is `036059` = Nassau, **not NYC**, so it's dropped |
| `ends` / `expires` | when it's over |

`parseAlerts` → a list of `{ event, headline, ends, boroughs }`.

---

## 5. NYC 311 (flooding complaints)

**Dataset page:** <https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9>
**Endpoint:** `https://data.cityofnewyork.us/resource/erm2-nwe9.json` (`erm2-nwe9` is the dataset's id)

**a) Every flooding report in the last 7 days** (dots on the map)
```
...erm2-nwe9.json?$select=unique_key,created_date,descriptor,incident_address,borough,latitude,longitude
  &$where=complaint_type='Sewer' AND (descriptor like '%Flood%' OR descriptor like '%Backup%') AND created_date > '2026-10-16T00:00:00' AND latitude IS NOT NULL
  &$order=created_date DESC&$limit=3000
```
```json
[
  { "unique_key": "69878533", "created_date": "2026-07-28T21:45:00.000", "descriptor": "Street Flooding (SJ)",
    "incident_address": "1425 KINGS HIGHWAY", "borough": "BROOKLYN",
    "latitude": "40.608508194435615", "longitude": "-73.9588815646739" }
]
```
**b) How many reports within 500 m of an address in the past year** (address check)
```
...erm2-nwe9.json?$select=count(*) as n&$where=... AND within_circle(location, 40.6759, -74.0107, 500)
```
```json
[{ "n": "17" }]
```
Numbers come back as **strings** here too, so the code does `parseFloat` / `parseInt`.
An optional free "app token" (`NYC_OPEN_DATA_APP_TOKEN` in config.js) raises the rate limit. It's fine to leave empty.

---

## 6. NYC Hurricane Evacuation Zones

**Dataset:** <https://data.cityofnewyork.us/d/epne-qv9x>. Same Socrata system as 311.
```
https://data.cityofnewyork.us/resource/epne-qv9x.json?$select=hurricane_&$where=intersects(the_geom, 'POINT (-74.010700 40.675900)')&$limit=1
```
"Which evacuation-zone shape contains this point?"
```json
[{ "hurricane_": "1" }]
```
Zones 1–6 (1 = evacuate first). `X` or no row = not in a zone. `parseEvacZone` → `{ zone: '1' }` or `{ zone: null }`.

---

## 7. NYC GeoSearch (addresses)

**Docs:** <https://geosearch.planninglabs.nyc/>
```
https://geosearch.planninglabs.nyc/v2/search?text=160 Van Brunt St&size=5
https://geosearch.planninglabs.nyc/v2/reverse?point.lat=40.6759&point.lon=-74.0107&size=1
```
```json
{
  "type": "FeatureCollection",
  "features": [ {
    "geometry": { "type": "Point", "coordinates": [-74.006762, 40.683108] },
    "properties": { "label": "160 VAN BRUNT STREET, Brooklyn, NY, USA", "borough": "Brooklyn",
                    "name": "160 VAN BRUNT STREET", "postalcode": "11231", "neighbourhood": "Red Hook" }
  } ]
}
```
`geocode` → list of `{ label, borough, lat, lon }`. Note `coordinates[0]` is **longitude**.
`reverse` does the opposite: a clicked map point → "29 WOLCOTT STREET, Brooklyn".

---

## 8. FEMA National Flood Hazard Layer

**About:** <https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS>. Uses an ArcGIS map server; layer **28** = flood zones.

**a) The flood zone at one point** (address check)
```
https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=-74.0107,40.6759&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,STATIC_BFE&returnGeometry=false&f=json
```
```json
{ "features": [ { "attributes": { "FLD_ZONE": "X", "ZONE_SUBTY": "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", "STATIC_BFE": -9999.0 } } ] }
```
| Field | Means |
| --- | --- |
| `FLD_ZONE` | `A…` or `V…` = the 100-year floodplain (V = also hit by waves). `X` = outside it |
| `ZONE_SUBTY` | for X: "0.2 PCT" = the 500-year floodplain |
| `STATIC_BFE` | "base flood elevation" (how high the 100-year flood reaches). `-9999` = none |

`inSR=4326` means "my point is in normal GPS lat/lon".

**b) The map layer:** `map.js` asks the same server's `/export` endpoint for transparent PNG images of the zones, tile by tile.

---

## 9. OpenStreetMap tiles (the map background)

```
https://tile.openstreetmap.org/{z}/{x}/{y}.png                 main
https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png           backup (Humanitarian style), used if the main one refuses
```
Not JSON: each URL is a 256×256 picture. Leaflet fills in `{z}` (zoom), `{x}` (column) and `{y}` (row).
The "© OpenStreetMap contributors" credit is required for free use.

---

## The two data files in `data/`

These were made **once** by the scripts in `scripts/build/`, then saved into the project. The page just loads them; it never rebuilds them.

### `data/nyc-ntas.geojson`: neighborhood shapes
- **Source:** NYC Department of City Planning's 195 **Neighborhood Tabulation Areas** (NTAs, 2010), simplified and published by the
  NYC Health Department: <https://github.com/nycehs/NYC_geography>
- **Made by:** `scripts/build/build-geodata.mjs` (rounds coordinates, adds a center point, marks parks/airports).
- **One feature:**
```json
{ "type": "Feature",
  "properties": { "code": "BK09", "name": "Brooklyn Heights-Cobble Hill", "boro": "Brooklyn", "park": false,
                  "cx": -73.99482, "cy": 40.69546, "areas": [] },
  "geometry": { "type": "Polygon", "coordinates": [[[-73.99237, 40.6897], [-73.99055, 40.68918], "..."]] } }
```
| Field | Means |
| --- | --- |
| `code` | NTA id: borough letters + number (BK = Brooklyn, MN, QN, BX, SI) |
| `park` | true for parks, cemeteries, airports (almost nobody lives there) |
| `cx`, `cy` | center point (lon, lat) |
| `areas` | which of DrainWatch's 39 rated neighborhoods (ids from config.js) sit inside this shape. Usually empty |

**Note:** the site's 39 rated neighborhoods (`AREAS` in config.js) and these 195 shapes are **different lists**.
The 39 are points with ratings; the 195 are outlines for drawing.

### `data/nyc-elevation.png`: ground height, stored as colors
- **Source:** AWS Terrain Tiles (<https://registry.opendata.aws/terrain-tiles/>), which in the US come from the
  **USGS 3D Elevation Program**.
- **Made by:** `scripts/build/bake-elevation.mjs`.
- **What it is:** a 448 × 448 image covering NYC. It's not meant to be looked at; **each pixel is a number**:
  - `height in meters = (Red × 256 + Green) ÷ 100 − 100`
  - `Blue` = which NTA the pixel is in (1 + its position in the GeoJSON), or 0 for water.
- **Decoded by:** `decodeElevation` in [`js/story/elevation.js`](../js/story/elevation.js), used by [`js/models/terrain.js`](../js/models/terrain.js).

---

## Numbers typed by hand (not from an API)

Everything in [`js/facts/config.js`](../js/facts/config.js) and the replays in [`js/models/scenarios.js`](../js/models/scenarios.js):
- **Neighborhood ratings** (`coastalExposure`, `stormwaterExposure`, `hvi`, `asthma`, `windExposure`): simplified by hand from
  FEMA maps, NYC DEP stormwater maps, the NYC Heat Vulnerability Index and the Environment & Health Data Portal.
- **Sea level projections:** NYC Panel on Climate Change (NPCC 2015/2019).
- **Replays** (Sandy, Ida, heat wave, smoke, Isaias): rebuilt by formulas from NOAA, NWS and EPA records, not downloaded.
