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

// Solar position at an arbitrary instant, mapped into the overlay's own
// polar coordinate space (same convention as sunPolarToXY: origin at the
// overlay's center, not yet offset by SUN_OVERLAY_MARGIN -- the caller in
// js/sun-overlay.js applies that same offset it already applies to every
// other point). Returns null if the sun is below the horizon at that
// instant. Pure function of position+date -- no month/"is this today"
// gating, unlike computeNowPoint() below, which layers that gating on top
// of this for the live "now" dot. Used directly by the day-scrubbing time
// slider (js/app.js), which has no such gating -- any month, any day, any
// time is valid there.
function computeSunPointAt(position, date) {
  if (!position) return null;
  const { azimuthDeg, altitudeDeg } = getSunPosition(date, position.lat, position.lng);
  if (altitudeDeg < 0) return null;
  const point = sunPolarToXY(azimuthDeg, altitudeDeg);

  // Direction of travel at `date`, used by buildNowLabel() (js/sun-overlay.js)
  // to offset the time label perpendicular to the curve itself rather than
  // radially from the overlay's center -- a radial offset only clears the
  // wedge once the sun is already low, and a fixed radius past the rim
  // looks disconnected from the dot when the dot itself is far from the
  // rim (both confirmed live during the "now" dot's own earlier iteration).
  const TANGENT_STEP_MINUTES = 5;
  const later = new Date(date.getTime() + TANGENT_STEP_MINUTES * 60000);
  const laterSun = getSunPosition(later, position.lat, position.lng);
  const laterPoint = sunPolarToXY(laterSun.azimuthDeg, laterSun.altitudeDeg);
  const tangentDx = laterPoint.x - point.x;
  const tangentDy = laterPoint.y - point.y;
  const tangentLen = Math.hypot(tangentDx, tangentDy) || 1;

  return {
    x: point.x,
    y: point.y,
    tangentX: tangentDx / tangentLen,
    tangentY: tangentDy / tangentLen,
  };
}

// Solar position "right now" mapped into the overlay's own polar
// coordinate space -- returns null whenever there's nothing to draw:
// `month` isn't the one representing today (see isToday in
// getMonthlyOverview above), no position is pinned yet, or the sun is
// currently below the horizon (night). Takes `now` as a parameter
// (defaulting to the real clock) purely so it can be tested with a fixed
// instant instead of depending on wall-clock time.
function computeNowPoint(month, position, now = new Date()) {
  if (!month || !month.isToday || !position) return null;
  return computeSunPointAt(position, now);
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

// True if azimuthDeg falls within the clockwise arc from startAzimuthDeg to
// endAzimuthDeg (wrapping past 360° if endAzimuthDeg < startAzimuthDeg) --
// used by the facade field-of-view feature (js/sun-overlay.js) to decide
// whether a given point on the day's arc faces the user-defined facade.
function isAzimuthInRange(azimuthDeg, startAzimuthDeg, endAzimuthDeg) {
  const span = ((endAzimuthDeg - startAzimuthDeg) % 360 + 360) % 360;
  const offset = ((azimuthDeg - startAzimuthDeg) % 360 + 360) % 360;
  return offset <= span;
}

// Shortest angular distance between two azimuths (0-180 deg), independent of
// direction -- used by clampAzimuthToArc() to decide which of two boundary
// azimuths a candidate is actually closer to, rather than assuming one fixed
// clockwise direction (which is what caused the wraparound bug: a candidate
// just behind the lower bound looks, in a single fixed direction, like it's
// most of the way around the OTHER side of the circle).
function circularDistanceDeg(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Clamps candidateAzimuthDeg onto the clockwise arc from startAzimuthDeg to
// endAzimuthDeg (naming matches isAzimuthInRange's own -- these are arc
// endpoints along a clockwise sweep that can wrap past 360deg, not numeric
// lower/upper bounds). If the candidate already falls on that arc, returns
// it unchanged; otherwise returns whichever boundary is angularly CLOSER
// (true circular distance, not a linear pos-space comparison) -- this is
// what clampFacadeAzimuth() (js/sun-overlay.js) needs instead of the buggy
// pos-space-only clamp: a candidate that overshoots backward past
// startAzimuthDeg by a small amount must clamp to startAzimuthDeg, not jump
// to endAzimuthDeg just because a fixed-direction "distance from start"
// measurement wraps it to a large value.
function clampAzimuthToArc(candidateAzimuthDeg, startAzimuthDeg, endAzimuthDeg) {
  if (isAzimuthInRange(candidateAzimuthDeg, startAzimuthDeg, endAzimuthDeg)) {
    return candidateAzimuthDeg;
  }
  const distToStart = circularDistanceDeg(candidateAzimuthDeg, startAzimuthDeg);
  const distToEnd = circularDistanceDeg(candidateAzimuthDeg, endAzimuthDeg);
  return distToStart <= distToEnd ? startAzimuthDeg : endAzimuthDeg;
}

// Index of the point closest to the overlay's own center (== lowest
// radius == highest altitude, per sunPolarToXY's own mapping) -- i.e.
// solar noon for that day, found geometrically rather than by comparing
// azimuth to a fixed value like 180, so it works regardless of hemisphere
// or which way the day's azimuth sweep wraps. Shared by
// findTimeForAzimuth() (splits its rising/setting-half search at this
// point) and findPeakTime() below (the day slider's default time-of-day).
function findPeakIndex(points) {
  let peakIndex = 0;
  let peakDistSq = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - SUN_OVERLAY_RADIUS;
    const dy = points[i].y - SUN_OVERLAY_RADIUS;
    const distSq = dx * dx + dy * dy;
    if (distSq < peakDistSq) {
      peakDistSq = distSq;
      peakIndex = i;
    }
  }
  return peakIndex;
}

// The Date of solar noon for one day's sampled points -- used as the
// day-scrubbing time slider's default position (js/app.js) whenever the
// day slider moves, since sunrise/sunset shift day to day and a fraction
// carried over from the previous day wouldn't necessarily still land on
// solar noon.
function findPeakTime(points) {
  return points[findPeakIndex(points)].t;
}

// Finds the Date the sun crosses a given azimuth along one day's arc, by
// linearly interpolating between the two chronologically-adjacent points
// (in `points`, as returned by sampleDayArc -- already time-ordered) whose
// azimuths bracket it. Returns null if azimuthDeg never occurs that day
// (outside the arc's own sunrise-to-sunset azimuth sweep). `span`/`target`
// use the signed shortest-angle delta (wrapped into (-180, 180]) rather than
// a raw subtraction, so a sample pair that crosses the 359°->0° seam (the
// sun passing north of zenith -- true for the southern hemisphere and much
// of the tropics) still interpolates correctly instead of producing a wildly
// wrong fraction.
//
// `edge` ('start'/'end'/omitted) restricts which half of the day is
// searched: 'start' only the rising portion (sunrise to solar noon), 'end'
// only the setting portion (solar noon to sunset). Without this, a facade
// handle's FIXED bearing, re-mapped onto a different month's much narrower
// arc, could end up crossed only on the chronologically WRONG side of the
// day for that handle's role -- confirmed live: dragging the sunset-side
// handle onto a bearing that new month only crosses in the MORNING showed
// a morning time in the sunset-colored pill, which reads as backwards
// regardless of it being a technically real crossing. Restricting the
// search to the matching half means that "wrong side" case correctly
// finds no crossing and falls back to null ("-") instead. The solar-noon
// split point is found as whichever point sits CLOSEST TO THE OVERLAY'S
// OWN CENTER (== lowest radius == highest altitude, per sunPolarToXY's own
// mapping) rather than by comparing azimuth to a fixed value like 180 --
// this works regardless of hemisphere or which way the day's azimuth
// sweep wraps.
function findTimeForAzimuth(points, azimuthDeg, edge) {
  const peakIndex = findPeakIndex(points);
  const searchStart = edge === 'end' ? Math.max(peakIndex, 1) : 1;
  const searchEnd = edge === 'start' ? peakIndex : points.length - 1;

  for (let i = searchStart; i <= searchEnd; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const span = ((cur.azimuthDeg - prev.azimuthDeg + 540) % 360) - 180;
    if (span === 0) continue;
    const target = ((azimuthDeg - prev.azimuthDeg + 540) % 360) - 180;
    const frac = target / span;
    if (frac >= 0 && frac <= 1) {
      const ms = prev.t.getTime() + frac * (cur.t.getTime() - prev.t.getTime());
      return new Date(ms);
    }
  }
  return null;
}

// Splits `points` (with azimuthDeg per point, as returned by
// sampleDayArc()) into contiguous runs of facing/non-facing relative to
// facadeRange ({ startAzimuthDeg, endAzimuthDeg }), for rendering each run
// with different emphasis (js/sun-overlay.js). Runs are index ranges
// [start, end] (both inclusive) into the same points array; adjacent runs
// share their boundary index on purpose, so polylines built from
// consecutive runs connect with no visual gap at the transition.
function splitByFacing(points, facadeRange) {
  const runs = [];
  let runStart = 0;
  let runFacing = isAzimuthInRange(points[0].azimuthDeg, facadeRange.startAzimuthDeg, facadeRange.endAzimuthDeg);
  for (let i = 1; i < points.length; i++) {
    const facing = isAzimuthInRange(points[i].azimuthDeg, facadeRange.startAzimuthDeg, facadeRange.endAzimuthDeg);
    if (facing !== runFacing) {
      runs.push({ start: runStart, end: i, facing: runFacing });
      runStart = i;
      runFacing = facing;
    }
  }
  runs.push({ start: runStart, end: points.length - 1, facing: runFacing });
  return runs;
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

// Calendar date (year/month-index/day) for `now` as seen in the given IANA
// time zone -- reused so "is this month today?" and "which day of the
// month is today?" both mean the pinned LOCATION's calendar day, not the
// browser's, matching every other zoned-day computation in this file (see
// zonedMidnightUtcMs above).
function todayInTimeZone(now, timeZone) {
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)) {
    parts[type] = value;
  }
  return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day) };
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
    .map((s) => ({ ...sunPolarToXY(s.azimuthDeg, s.altitudeDeg), t: s.t, azimuthDeg: s.azimuthDeg }));

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
// browser's -- EXCEPT for whichever month is today's real calendar month,
// which uses today's actual day-of-month instead and is marked
// isToday: true, so a "sun's position right now" marker can be placed
// exactly on that one arc), colored along a gradient from indigo (shortest
// day of the 12) to deep orange (longest day of the 12) based on each
// month's own day length relative to the other 11 at this specific
// latitude. Returns an array of 12 objects in January-to-December order.
function getMonthlyOverview(lat, lng, year, timeZone, now = new Date()) {
  const today = todayInTimeZone(now, timeZone);
  const months = [];
  for (let m = 0; m < 12; m++) {
    const isToday = year === today.year && m === today.month;
    const day = isToday ? today.day : MONTH_REPRESENTATIVE_DAY;
    const { points, sunrise, sunset } = sampleDayArc(year, m, day, lat, lng, timeZone);
    const dayLengthMs = sunrise && sunset ? sunset.getTime() - sunrise.getTime() : null;
    months.push({ name: MONTH_NAMES[m], points, sunrise, sunset, dayLengthMs, color: null, timeZone, isToday });
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
