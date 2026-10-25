
// Each neighborhood has 5 ratings, estimated by hand from these public sources
// (simplified summaries, NOT official ratings):
//   coastalExposure    0–3  ocean flooding: FEMA flood maps, hurricane evacuation zones, where Sandy (2012) flooded
//                           https://msc.fema.gov/portal/home   https://maps.nyc.gov/hurricane/
//   stormwaterExposure 0–3  rain flooding: NYC Stormwater Flood Maps, where Ida (2021) flooded
//                           https://www.nyc.gov/stormwater-map
//   hvi                1–5  NYC Heat Vulnerability Index (fewer trees, less AC, more elderly residents = higher)
//                           https://a816-dohbesp.nyc.gov/IndicatorPublic/data-features/hvi/
//   asthma             1–5  asthma emergency room visits
//                           https://a816-dohbesp.nyc.gov/IndicatorPublic/
//   windExposure       1–3  1 = sheltered, 2 = waterfront or lots of big trees, 3 = right on the ocean

// Optional: a free NYC Open Data "app token" lets the site ask for 311 data more often.
// The site works without one. Get one here: https://data.cityofnewyork.us/profile/edit/developer_settings
export const NYC_OPEN_DATA_APP_TOKEN = '';

// The 4 NOAA tide gauges near NYC. id = NOAA's station number (the same one used in the API).
// greatDiurnalRangeFt = how many feet the water rises from low to high tide on a normal day.
// Each gauge's page: https://tidesandcurrents.noaa.gov/stationhome.html?id=8518750 (change the id)
export const TIDE_STATIONS = {
  battery: { id: '8518750', name: 'The Battery', lat: 40.7006, lon: -74.0142, greatDiurnalRangeFt: 5.1 },
  kingsPoint: { id: '8516945', name: 'Kings Point', lat: 40.8103, lon: -73.7649, greatDiurnalRangeFt: 7.7 },
  sandyHook: { id: '8531680', name: 'Sandy Hook', lat: 40.4669, lon: -74.0094, greatDiurnalRangeFt: 5.2 },
  bergenPoint: { id: '8519483', name: 'Bergen Point', lat: 40.6397, lon: -74.1464, greatDiurnalRangeFt: 5.4 },
};

// The 39 neighborhoods the site rates. lat/lon from any map; ratings explained at the top of this file.
export const AREAS = [
  // Manhattan
  { id: 'fidi', name: 'Financial District', borough: 'Manhattan', lat: 40.7075, lon: -74.0113, coastalExposure: 3, stormwaterExposure: 1, station: 'battery', hvi: 1, asthma: 1, windExposure: 2 },
  { id: 'bpc', name: 'Battery Park City', borough: 'Manhattan', lat: 40.7115, lon: -74.016, coastalExposure: 3, stormwaterExposure: 1, station: 'battery', hvi: 1, asthma: 1, windExposure: 2 },
  { id: 'les', name: 'Lower East Side', borough: 'Manhattan', lat: 40.7187, lon: -73.9786, coastalExposure: 2, stormwaterExposure: 1, station: 'battery', hvi: 4, asthma: 3, windExposure: 1 },
  { id: 'ues', name: 'Upper East Side', borough: 'Manhattan', lat: 40.7736, lon: -73.9566, coastalExposure: 1, stormwaterExposure: 1, station: 'battery', hvi: 1, asthma: 1, windExposure: 1 },
  { id: 'east-harlem', name: 'East Harlem', borough: 'Manhattan', lat: 40.7957, lon: -73.9389, coastalExposure: 2, stormwaterExposure: 2, station: 'battery', hvi: 5, asthma: 5, windExposure: 1 },
  { id: 'central-harlem', name: 'Central Harlem', borough: 'Manhattan', lat: 40.8116, lon: -73.9465, coastalExposure: 0, stormwaterExposure: 1, station: 'battery', hvi: 5, asthma: 5, windExposure: 1 },
  { id: 'washington-heights', name: 'Washington Heights', borough: 'Manhattan', lat: 40.8417, lon: -73.9394, coastalExposure: 0, stormwaterExposure: 1, station: 'battery', hvi: 4, asthma: 3, windExposure: 1 },
  { id: 'inwood', name: 'Inwood', borough: 'Manhattan', lat: 40.8677, lon: -73.9212, coastalExposure: 1, stormwaterExposure: 1, station: 'battery', hvi: 4, asthma: 3, windExposure: 1 },
  // Brooklyn
  { id: 'red-hook', name: 'Red Hook', borough: 'Brooklyn', lat: 40.6759, lon: -74.0107, coastalExposure: 3, stormwaterExposure: 2, station: 'battery', hvi: 4, asthma: 3, windExposure: 2 },
  { id: 'gowanus', name: 'Gowanus', borough: 'Brooklyn', lat: 40.6733, lon: -73.9903, coastalExposure: 2, stormwaterExposure: 3, station: 'battery', hvi: 3, asthma: 2, windExposure: 1 },
  { id: 'park-slope', name: 'Park Slope', borough: 'Brooklyn', lat: 40.671, lon: -73.9814, coastalExposure: 0, stormwaterExposure: 1, station: 'battery', hvi: 1, asthma: 1, windExposure: 1 },
  { id: 'greenpoint', name: 'Greenpoint / Williamsburg waterfront', borough: 'Brooklyn', lat: 40.723, lon: -73.958, coastalExposure: 2, stormwaterExposure: 2, station: 'battery', hvi: 3, asthma: 2, windExposure: 2 },
  { id: 'bushwick', name: 'Bushwick', borough: 'Brooklyn', lat: 40.6944, lon: -73.9213, coastalExposure: 0, stormwaterExposure: 2, station: 'battery', hvi: 4, asthma: 3, windExposure: 1 },
  { id: 'bed-stuy', name: 'Bedford-Stuyvesant', borough: 'Brooklyn', lat: 40.6872, lon: -73.9418, coastalExposure: 0, stormwaterExposure: 2, station: 'battery', hvi: 5, asthma: 4, windExposure: 1 },
  { id: 'brownsville', name: 'Brownsville', borough: 'Brooklyn', lat: 40.6627, lon: -73.9094, coastalExposure: 0, stormwaterExposure: 2, station: 'sandyHook', hvi: 5, asthma: 5, windExposure: 1 },
  { id: 'east-new-york', name: 'East New York', borough: 'Brooklyn', lat: 40.6664, lon: -73.8828, coastalExposure: 1, stormwaterExposure: 2, station: 'sandyHook', hvi: 5, asthma: 4, windExposure: 1 },
  { id: 'canarsie', name: 'Canarsie', borough: 'Brooklyn', lat: 40.6402, lon: -73.9006, coastalExposure: 2, stormwaterExposure: 2, station: 'sandyHook', hvi: 3, asthma: 2, windExposure: 2 },
  { id: 'gerritsen', name: 'Gerritsen Beach', borough: 'Brooklyn', lat: 40.5886, lon: -73.9214, coastalExposure: 3, stormwaterExposure: 1, station: 'sandyHook', hvi: 2, asthma: 2, windExposure: 3 },
  { id: 'coney-island', name: 'Coney Island', borough: 'Brooklyn', lat: 40.5755, lon: -73.9707, coastalExposure: 3, stormwaterExposure: 1, station: 'sandyHook', hvi: 4, asthma: 3, windExposure: 3 },
  // Queens
  { id: 'lic', name: 'Long Island City', borough: 'Queens', lat: 40.7447, lon: -73.9485, coastalExposure: 2, stormwaterExposure: 2, station: 'battery', hvi: 3, asthma: 2, windExposure: 2 },
  { id: 'woodside', name: 'Woodside', borough: 'Queens', lat: 40.7454, lon: -73.903, coastalExposure: 0, stormwaterExposure: 3, station: 'kingsPoint', hvi: 3, asthma: 2, windExposure: 1 },
  { id: 'corona', name: 'Corona', borough: 'Queens', lat: 40.7471, lon: -73.8603, coastalExposure: 1, stormwaterExposure: 3, station: 'kingsPoint', hvi: 4, asthma: 3, windExposure: 1 },
  { id: 'east-elmhurst', name: 'East Elmhurst', borough: 'Queens', lat: 40.764, lon: -73.87, coastalExposure: 2, stormwaterExposure: 3, station: 'kingsPoint', hvi: 3, asthma: 3, windExposure: 2 },
  { id: 'forest-hills', name: 'Forest Hills / Kew Gardens Hills', borough: 'Queens', lat: 40.726, lon: -73.821, coastalExposure: 0, stormwaterExposure: 3, station: 'kingsPoint', hvi: 1, asthma: 1, windExposure: 2 },
  { id: 'hollis', name: 'Hollis / Jamaica', borough: 'Queens', lat: 40.712, lon: -73.764, coastalExposure: 0, stormwaterExposure: 3, station: 'kingsPoint', hvi: 4, asthma: 3, windExposure: 2 },
  { id: 'howard-beach', name: 'Howard Beach', borough: 'Queens', lat: 40.6571, lon: -73.8364, coastalExposure: 3, stormwaterExposure: 2, station: 'sandyHook', hvi: 2, asthma: 2, windExposure: 2 },
  { id: 'broad-channel', name: 'Broad Channel', borough: 'Queens', lat: 40.604, lon: -73.819, coastalExposure: 3, stormwaterExposure: 1, station: 'sandyHook', hvi: 2, asthma: 2, windExposure: 3 },
  { id: 'rockaway', name: 'Rockaway Peninsula', borough: 'Queens', lat: 40.592, lon: -73.805, coastalExposure: 3, stormwaterExposure: 2, station: 'sandyHook', hvi: 4, asthma: 4, windExposure: 3 },
  // Bronx
  { id: 'mott-haven', name: 'Mott Haven / Port Morris', borough: 'Bronx', lat: 40.8091, lon: -73.9229, coastalExposure: 2, stormwaterExposure: 2, station: 'kingsPoint', hvi: 5, asthma: 5, windExposure: 1 },
  { id: 'hunts-point', name: 'Hunts Point', borough: 'Bronx', lat: 40.812, lon: -73.883, coastalExposure: 2, stormwaterExposure: 2, station: 'kingsPoint', hvi: 5, asthma: 5, windExposure: 2 },
  { id: 'soundview', name: 'Soundview / Castle Hill', borough: 'Bronx', lat: 40.82, lon: -73.857, coastalExposure: 2, stormwaterExposure: 2, station: 'kingsPoint', hvi: 5, asthma: 5, windExposure: 2 },
  { id: 'fordham', name: 'Fordham / University Heights', borough: 'Bronx', lat: 40.8615, lon: -73.8987, coastalExposure: 0, stormwaterExposure: 1, station: 'kingsPoint', hvi: 5, asthma: 5, windExposure: 1 },
  { id: 'throgs-neck', name: 'Throgs Neck / City Island', borough: 'Bronx', lat: 40.847, lon: -73.786, coastalExposure: 3, stormwaterExposure: 1, station: 'kingsPoint', hvi: 2, asthma: 2, windExposure: 3 },
  { id: 'riverdale', name: 'Riverdale', borough: 'Bronx', lat: 40.899, lon: -73.911, coastalExposure: 0, stormwaterExposure: 1, station: 'kingsPoint', hvi: 2, asthma: 2, windExposure: 2 },
  // Staten Island
  { id: 'st-george', name: 'St. George / Stapleton', borough: 'Staten Island', lat: 40.634, lon: -74.077, coastalExposure: 2, stormwaterExposure: 1, station: 'battery', hvi: 3, asthma: 3, windExposure: 2 },
  { id: 'mariners-harbor', name: 'Mariners Harbor', borough: 'Staten Island', lat: 40.638, lon: -74.16, coastalExposure: 2, stormwaterExposure: 1, station: 'bergenPoint', hvi: 4, asthma: 3, windExposure: 2 },
  { id: 'mid-island', name: 'Mid-Island (New Springville)', borough: 'Staten Island', lat: 40.585, lon: -74.158, coastalExposure: 0, stormwaterExposure: 1, station: 'bergenPoint', hvi: 1, asthma: 1, windExposure: 2 },
  { id: 'midland-beach', name: 'Midland Beach / South Beach', borough: 'Staten Island', lat: 40.573, lon: -74.096, coastalExposure: 3, stormwaterExposure: 2, station: 'sandyHook', hvi: 2, asthma: 2, windExposure: 3 },
  { id: 'oakwood-beach', name: 'Oakwood Beach', borough: 'Staten Island', lat: 40.553, lon: -74.115, coastalExposure: 3, stormwaterExposure: 2, station: 'sandyHook', hvi: 1, asthma: 2, windExposure: 3 },
];

// Weather Service alerts checks radio transmitters for counties throughout the city
// Source: https://www.weather.gov/nwr/counties
//We only takes Kings county, NY county, Queens county, Bronx county, and Queens county, not westchester or other counties
export const BOROUGH_SAME = {
  Manhattan: '036061',
  Brooklyn: '036047',
  Queens: '036081',
  Bronx: '036005',
  'Staten Island': '036085',
};

// How much rain NYC's sewers can drain, in inches per hour. More than this and streets flood.
// https://www.nyc.gov/site/dep/water/sewer-system.page
export const RAIN_BENCHMARKS = {
  sewerDesign: 1.75, // most of NYC's sewers are designed for roughly this intensity
};

// How much higher NYC's sea level is expected to be, in inches (compared with 2000–2004).
// low–high = the likely range, highEnd = the worst realistic case.
// From the NYC Panel on Climate Change (NPCC) 2019 report:
// https://news.climate.columbia.edu/2019/03/15/npcc-report-2019-climate-change-nyc/
export const SEA_LEVEL_PROJECTIONS = [
  { period: '2020s', low: 4, high: 8, highEnd: 10 },
  { period: '2050s', low: 11, high: 21, highEnd: 30 },
  { period: '2080s', low: 18, high: 39, highEnd: 58 },
  { period: '2100', low: 22, high: 50, highEnd: 75 },
];
