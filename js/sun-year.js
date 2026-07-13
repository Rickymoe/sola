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

// UTC offset (minutes, local-minus-UTC) for the given instant in the given
// IANA time zone -- resolves DST correctly since Intl looks up the actual
// rule in effect at that specific date, not just a fixed offset.
function getUtcOffsetMinutes(date, timeZone) {
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)) {
    parts[type] = value;
  }
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

// UTC instant (ms) of local midnight for the given calendar date in the
// given time zone. Guesses the offset from a UTC-midnight anchor, then
// applies it -- accurate except right at a DST transition, which is an
// acceptable rare edge case here.
function zonedMidnightUtcMs(year, month, day, timeZone) {
  const guessMs = Date.UTC(year, month, day, 0, 0, 0);
  const offsetMin = getUtcOffsetMinutes(new Date(guessMs), timeZone);
  return guessMs - offsetMin * 60000;
}

// Samples one full local day (midnight to midnight, in the given IANA time
// zone) in SUN_SAMPLE_STEP_MINUTES steps, returning the above-horizon path
// points (for drawing) plus sunrise/sunset found by interpolating the
// altitude=0 crossings. Both null if the sun never crosses 0° that day
// (polar day/night) -- a real possibility at high latitudes, must not crash.
function sampleDayArc(year, month, day, lat, lng, timeZone) {
  const dayStartMs = zonedMidnightUtcMs(year, month, day, timeZone);

  const samples = [];
  for (let m = 0; m <= 24 * 60; m += SUN_SAMPLE_STEP_MINUTES) {
    const t = new Date(dayStartMs + m * 60000);
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
// (15th of each month, in the LOCATION's own time zone -- not the
// browser's), colored along a gradient from indigo (shortest day of the
// 12) to deep orange (longest day of the 12) based on each month's own day
// length relative to the other 11 at this specific latitude. Returns an
// array of 12 objects in January-to-December order.
function getMonthlyOverview(lat, lng, year, timeZone) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const { points, sunrise, sunset } = sampleDayArc(year, m, MONTH_REPRESENTATIVE_DAY, lat, lng, timeZone);
    const dayLengthMs = sunrise && sunset ? sunset.getTime() - sunrise.getTime() : null;
    months.push({ name: MONTH_NAMES[m], points, sunrise, sunset, dayLengthMs, color: null, timeZone });
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

// Formats as "HH:MM" in the given IANA time zone -- the location's own
// local time, not the browser's.
function formatTime(date, timeZone) {
  if (!date) return '–';
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(date)) {
    parts[type] = value;
  }
  return `${parts.hour}:${parts.minute}`;
}
