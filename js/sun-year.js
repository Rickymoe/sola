const SUN_OVERLAY_SIZE = 240; // px, diameter of the overlay circle (shared with js/sun-overlay.js)
const SUN_OVERLAY_RADIUS = SUN_OVERLAY_SIZE / 2;
const SUN_SAMPLE_STEP_MINUTES = 10;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH_REPRESENTATIVE_DAY = 15;
const WINTER_COLOR = { r: 92, g: 107, b: 192 };
const SUMMER_COLOR = { r: 255, g: 111, b: 0 };

// Maps a sun position (azimuth/altitude, degrees) to a point on the
// SUN_OVERLAY_SIZE-diameter circle: angle = azimuth (0°=north, clockwise),
// radius = altitude mapped so 90° (zenith) is the center and 0° (horizon)
// is the outer rim. Lives here (not in js/sun-overlay.js) because this
// file's own sampleDayArc() needs it too, and this file loads before
// sun-overlay.js in index.html.
function sunPolarToXY(azimuthDeg, altitudeDeg) {
  const r = SUN_OVERLAY_RADIUS * (1 - Math.min(altitudeDeg, 90) / 90);
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  return {
    x: SUN_OVERLAY_RADIUS + r * Math.sin(azimuthRad),
    y: SUN_OVERLAY_RADIUS - r * Math.cos(azimuthRad),
  };
}

// Finds the Date where altitude crosses 0° between two consecutive
// samples, by linear interpolation. Used for both sunrise (altitude going
// negative -> positive) and sunset (positive -> negative).
function interpolateCrossing(prev, cur) {
  const span = cur.altitudeDeg - prev.altitudeDeg;
  const frac = span === 0 ? 0 : (0 - prev.altitudeDeg) / span;
  const ms = prev.t.getTime() + frac * (cur.t.getTime() - prev.t.getTime());
  return new Date(ms);
}

// Samples one full local day (midnight to midnight) in
// SUN_SAMPLE_STEP_MINUTES steps, returning the above-horizon path points
// (for drawing) plus sunrise/sunset found by interpolating the altitude=0
// crossings. Both null if the sun never crosses 0° that day (polar
// day/night) -- a real possibility at high latitudes, must not crash.
function sampleDayArc(date, lat, lng) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const samples = [];
  for (let m = 0; m <= 24 * 60; m += SUN_SAMPLE_STEP_MINUTES) {
    const t = new Date(dayStart.getTime() + m * 60000);
    const { azimuthDeg, altitudeDeg } = getSunPosition(t, lat, lng);
    samples.push({ t, azimuthDeg, altitudeDeg });
  }

  const points = samples
    .filter((s) => s.altitudeDeg >= 0)
    .map((s) => sunPolarToXY(s.azimuthDeg, s.altitudeDeg));

  let sunrise = null;
  let sunset = null;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev.altitudeDeg < 0 && cur.altitudeDeg >= 0 && !sunrise) {
      sunrise = interpolateCrossing(prev, cur);
    }
    if (prev.altitudeDeg >= 0 && cur.altitudeDeg < 0) {
      sunset = interpolateCrossing(prev, cur);
    }
  }

  return { points, sunrise, sunset };
}

function monthColor(fraction) {
  const r = Math.round(WINTER_COLOR.r + (SUMMER_COLOR.r - WINTER_COLOR.r) * fraction);
  const g = Math.round(WINTER_COLOR.g + (SUMMER_COLOR.g - WINTER_COLOR.g) * fraction);
  const b = Math.round(WINTER_COLOR.b + (SUMMER_COLOR.b - WINTER_COLOR.b) * fraction);
  return `rgb(${r}, ${g}, ${b})`;
}

// Computes all 12 months' day-arcs + sunrise/sunset for a given location
// (15th of each month, local noon as the reference moment), colored along
// a gradient from indigo (shortest day of the 12) to deep orange (longest
// day of the 12) based on each month's own day length relative to the
// other 11 at this specific latitude. Returns an array of 12 objects in
// January-to-December order.
function getMonthlyOverview(lat, lng, year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const date = new Date(year, m, MONTH_REPRESENTATIVE_DAY, 12, 0, 0);
    const { points, sunrise, sunset } = sampleDayArc(date, lat, lng);
    const dayLengthMs = sunrise && sunset ? sunset.getTime() - sunrise.getTime() : null;
    months.push({ name: MONTH_NAMES[m], points, sunrise, sunset, dayLengthMs, color: null });
  }

  const lengths = months.map((mo) => mo.dayLengthMs).filter((v) => v !== null);
  const minLen = lengths.length ? Math.min(...lengths) : 0;
  const maxLen = lengths.length ? Math.max(...lengths) : 0;
  const span = maxLen - minLen;

  for (const mo of months) {
    const fraction = mo.dayLengthMs === null || span === 0
      ? 0.5
      : (mo.dayLengthMs - minLen) / span;
    mo.color = monthColor(fraction);
  }

  return months;
}

function formatTime(date) {
  if (!date) return '–';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
