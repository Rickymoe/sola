let map;
let marker;
let currentPosition = null; // { lat, lng }
let sunOverlay;
let months = null; // array of 12 { name, points, sunrise, sunset, dayLengthMs, color }
let selectedMonthIndex = new Date().getMonth();
let compassActive = false;
let stopCompassHeading = null;
let facadeActive = false; // mirrors whether sunOverlay.facadeRange is set -- tracked as a top-level flag to match the existing compassActive convention
let selectedDay = 15; // 1-31, day-of-month for the day slider (non-current months only) -- always resets to 15 when a new month is selected, matching the app's existing "representative day" default
let selectedTimeFraction = 0.5; // 0-1, position between that day's sunrise/sunset (or full 24h span on a polar day) for the time slider -- reset to that day's own solar noon whenever the day slider moves
let currentDayMonth = null; // the day-specific month-like object (points/sunrise/sunset recomputed for selectedDay via sampleDayArc()), set by applySelectedDay() -- read by the time slider's own input handler and by applySelectedTime() for the current sunrise/sunset bounds; null for the current month (sliders hidden, not used) or when no position is pinned

const DEFAULT_CENTER = { lat: 59.9139, lng: 10.7522 }; // Oslo

// Compass heading only makes sense on a device with an actual magnetometer —
// desktop browsers may or may not expose DeviceOrientationEvent but the
// sensor data is absent or nonsense, so hide the button there.
// Wrapped in a function (lazy check) rather than a top-level constant so
// that even in weird browser setups where navigator isn't available yet
// (unlikely, but defensive), it won't prevent the rest of app.js from
// parsing — a parse failure here would mean initMap is never defined and
// the entire map silently fails.
function supportsCompass() {
  try {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
      typeof DeviceOrientationEvent !== 'undefined';
  } catch (_) {
    return false;
  }
}

// Last day-of-month for the given 0-indexed month/year -- day 0 of the
// FOLLOWING month is the last day of THIS month, a standard JS Date trick.
function daysInMonth(monthIndex, year) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// The time slider's [start, end] Date bounds for one day-specific month-like
// object: that day's own sunrise-to-sunset window normally, or the full
// sampled range (close to a full 24h local day) on a polar day (sunrise/
// sunset both null, matching sampleDayArc()'s own convention). Returns null
// if there aren't even 2 points to bound a range with (deep polar night --
// no daylight at all that day).
function timeSliderBounds(dayMonth) {
  if (dayMonth.sunrise && dayMonth.sunset) {
    return { start: dayMonth.sunrise, end: dayMonth.sunset };
  }
  if (dayMonth.points.length > 1) {
    return { start: dayMonth.points[0].t, end: dayMonth.points[dayMonth.points.length - 1].t };
  }
  return null;
}

// Called by Google Maps if the API key is rejected (billing, referrer, etc.).
// Surfaces the exact cause so the user can screenshot it instead of seeing
// only the generic "noe gikk galt" message with no hint about what's wrong.
function gm_authFailure() {
  var el = document.getElementById('map');
  if (el) {
    el.innerHTML = '<div style="background:#fff;padding:20px;margin:20px;border-radius:8px;font-family:sans-serif;text-align:center;color:#d93025;font-size:14px">' +
      '<strong>Google Maps API-nøkkel avvist</strong><br>' +
      '<span style="color:#5f6368">Sjekk Google Cloud Console → Credentials:<br>' +
      'HTTP-referrer, API-restriksjoner, og at Maps JavaScript API er aktivert.</span></div>';
  }
}

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: DEFAULT_CENTER,
    zoom: 14,
    mapTypeId: 'hybrid',
    mapTypeControl: false,
    streetViewControl: false,
    zoomControl: false,
    fullscreenControl: false,
    rotateControl: false,
    disableDefaultUI: false,
  });

  map.addListener('click', (e) => {
    setPosition(e.latLng.lat(), e.latLng.lng());
  });

  setupLocationControls();
  centerOnUserLocation();

  sunOverlay = createSunPathOverlay();
  sunOverlay.setMap(map);

  // Keeps the time slider in sync when the user drags the scrub dot/pill
  // directly instead of moving the slider -- does NOT call setScrubDate()
  // again (the overlay already holds the authoritative, exactly-snapped
  // scrubDate from the drag itself; re-deriving a date from the slider's
  // own rounded 0-1000 fraction and setting it back would risk a tiny
  // mismatch with the dot's real position, plus a redundant render).
  sunOverlay.onScrubDrag = (date) => {
    const bounds = timeSliderBounds(currentDayMonth);
    if (!bounds) return;
    selectedTimeFraction = (date.getTime() - bounds.start.getTime()) /
      (bounds.end.getTime() - bounds.start.getTime());
    document.getElementById('time-slider').value = String(Math.round(selectedTimeFraction * 1000));
    document.getElementById('time-slider-value').textContent = formatTime(date, currentDayMonth.timeZone);
  };
}

// Just recenters the view on load -- does not drop a pin, so the
// month picker/sun overview only appear once the user deliberately
// picks a point (click or the "min posisjon" button).
function centerOnUserLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      map.setZoom(16);
    },
    () => {} // denied/unavailable -- keep the Oslo default
  );
}

function setPosition(lat, lng) {
  currentPosition = { lat, lng };

  if (sunOverlay) sunOverlay.clearFacadeRange();
  facadeActive = false;

  if (marker) {
    marker.setMap(null);
  }
  marker = new google.maps.Marker({
    position: { lat, lng },
    map,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#4285f4',
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 2,
    },
  });

  map.panTo({ lat, lng });
  if (sunOverlay) sunOverlay.setPosition(lat, lng);
  const timeZone = tzlookup(lat, lng);
  months = getMonthlyOverview(lat, lng, new Date().getFullYear(), timeZone);
  renderMonthButtons();
  selectMonth(selectedMonthIndex);
  updateClearButtonVisibility();
  updateCompassButtonVisibility();
  updateFacadeButtonVisibility();
  playSunriseAnimation();
}

const SUNRISE_ANIM_RISE_MS = 1400;
const SUNRISE_ANIM_GLOW_MS = 600;
const SUNRISE_ANIM_ORBIT_MS = 1600;
const SUNRISE_ANIM_ORBIT_RADIUS = 4;
let sunriseAnimFrame = null;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Quadratic bezier from (0,0) via (-8,-10) to (0,-18) -- the dot's rise
// from the horizon to its resting peak.
function sunriseRisePoint(t) {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: -8, y: -10 };
  const p2 = { x: 0, y: -18 };
  return {
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  };
}

// Driven via requestAnimationFrame rather than SMIL: begin="indefinite"
// animateMotion/animate elements triggered with beginElement() stopped
// animating reliably in Chrome once nested more than one level below
// the <svg> root (confirmed with several isolated repros) -- rAF sidesteps
// that entirely and gives full control over the rise-then-orbit sequence.
function playSunriseAnimation() {
  document.getElementById('sunrise-anim').classList.remove('hidden');
  if (sunriseAnimFrame) cancelAnimationFrame(sunriseAnimFrame);

  const dot = document.getElementById('sunrise-anim-dot');
  const glow = document.getElementById('sunrise-anim-glow');
  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    let point;

    if (elapsed < SUNRISE_ANIM_RISE_MS) {
      point = sunriseRisePoint(easeInOutCubic(Math.min(elapsed / SUNRISE_ANIM_RISE_MS, 1)));
      glow.setAttribute('opacity', '0');
    } else {
      const afterRise = elapsed - SUNRISE_ANIM_RISE_MS;
      glow.setAttribute('opacity', String(Math.min(afterRise / SUNRISE_ANIM_GLOW_MS, 1) * 0.6));

      // Orbits the peak like a lighthouse beam: a circle of radius
      // SUNRISE_ANIM_ORBIT_RADIUS centered on (4,-18) -- the same point
      // the glow sits on -- starting at (0,-18) (the rise's landing
      // spot) so there's no jump when the orbit kicks in.
      const orbitT = (afterRise % SUNRISE_ANIM_ORBIT_MS) / SUNRISE_ANIM_ORBIT_MS;
      const angle = Math.PI + orbitT * Math.PI * 2;
      point = {
        x: 4 + SUNRISE_ANIM_ORBIT_RADIUS * Math.cos(angle),
        y: -18 + SUNRISE_ANIM_ORBIT_RADIUS * Math.sin(angle),
      };
    }

    dot.setAttribute('transform', `translate(${point.x},${point.y})`);
    sunriseAnimFrame = requestAnimationFrame(tick);
  }

  sunriseAnimFrame = requestAnimationFrame(tick);
}

function clearPosition() {
  if (marker) {
    marker.setMap(null);
    marker = null;
  }
  currentPosition = null;
  months = null;
  selectedMonthIndex = new Date().getMonth();
  if (sunOverlay) sunOverlay.clear();
  facadeActive = false;
  currentDayMonth = null;
  document.getElementById('day-slider-row').classList.add('hidden');
  document.getElementById('time-slider-row').classList.add('hidden');
  document.getElementById('month-buttons-container').innerHTML = '';
  document.getElementById('sunrise-anim').classList.add('hidden');
  if (sunriseAnimFrame) {
    cancelAnimationFrame(sunriseAnimFrame);
    sunriseAnimFrame = null;
  }
  if (stopCompassHeading) {
    stopCompassHeading();
    stopCompassHeading = null;
  }
  compassActive = false;
  updateClearButtonVisibility();
  updateCompassButtonVisibility();
  updateFacadeButtonVisibility();
}

function updateClearButtonVisibility() {
  document.getElementById('clear-position-btn').classList.toggle('hidden', !currentPosition);
}

// Hidden whenever the device doesn't support it or there's no pinned point
// to show a needle at -- but stays visible (not hidden) once compass
// tracking is on, styled with an .active state instead, so the user can
// toggle it back off. Previously hid itself once active, leaving no way to
// turn the needle off short of clearing the whole position.
function updateCompassButtonVisibility() {
  const btn = document.getElementById('compass-btn');
  if (!btn) return;
  btn.classList.toggle('hidden', !supportsCompass() || !currentPosition);
  btn.classList.toggle('active', compassActive);
}

function updateFacadeButtonVisibility() {
  const btn = document.getElementById('facade-btn');
  if (!btn) return;
  btn.classList.toggle('hidden', !currentPosition);
  btn.classList.toggle('active', facadeActive);
}

function renderMonthButtons() {
  const container = document.getElementById('month-buttons-container');
  container.innerHTML = '';
  months.forEach((mo, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'month-btn' + (i === selectedMonthIndex ? ' active' : '');
    btn.style.backgroundColor = mo.color;
    btn.textContent = mo.name;
    btn.addEventListener('click', () => selectMonth(i));
    container.appendChild(btn);
  });
}

function selectMonth(i) {
  selectedMonthIndex = i;
  if (!months) return;
  for (const btn of document.querySelectorAll('.month-btn')) {
    btn.classList.remove('active');
  }
  document.querySelectorAll('.month-btn')[i].classList.add('active');

  const mo = months[i];
  const dayRow = document.getElementById('day-slider-row');
  const timeRow = document.getElementById('time-slider-row');

  if (mo.isToday) {
    // Current month: completely unaffected by this feature -- no sliders,
    // the existing live "now" dot (js/sun-overlay.js's own isToday check)
    // takes over entirely.
    dayRow.classList.add('hidden');
    timeRow.classList.add('hidden');
    currentDayMonth = null;
    if (sunOverlay) sunOverlay.clearScrubDate();
    if (sunOverlay) sunOverlay.setMonth(mo);
    return;
  }

  dayRow.classList.remove('hidden');
  timeRow.classList.remove('hidden');

  selectedDay = 15;
  const daySlider = document.getElementById('day-slider');
  daySlider.max = String(daysInMonth(i, new Date().getFullYear()));
  daySlider.value = '15';

  applySelectedDay();
}

// Re-samples the arc for `selectedDay` within the currently selected
// month (via sampleDayArc(), the same function getMonthlyOverview() already
// uses for the fixed 15th) and hands the result to the overlay exactly like
// any other month -- render() doesn't know or care that this "month" only
// represents one specific day instead of the whole month. Also resets the
// time slider to that new day's own solar noon, since sunrise/sunset shift
// day to day and a fraction carried over from the previous day wouldn't
// necessarily still land on solar noon. No-op for the current month --
// sliders are hidden there and this should never be reachable.
function applySelectedDay() {
  if (!currentPosition || !months) return;
  const mo = months[selectedMonthIndex];
  if (mo.isToday) return;

  const year = new Date().getFullYear();
  const { points, sunrise, sunset } = sampleDayArc(
    year, selectedMonthIndex, selectedDay,
    currentPosition.lat, currentPosition.lng, mo.timeZone
  );
  currentDayMonth = { ...mo, points, sunrise, sunset };

  document.getElementById('day-slider-value').textContent = `${selectedDay}.`;
  if (sunOverlay) sunOverlay.setMonth(currentDayMonth);

  const bounds = timeSliderBounds(currentDayMonth);
  if (bounds && points.length > 1) {
    const peak = findPeakTime(points);
    selectedTimeFraction = (peak.getTime() - bounds.start.getTime()) / (bounds.end.getTime() - bounds.start.getTime());
  } else {
    selectedTimeFraction = 0.5;
  }
  document.getElementById('time-slider').value = String(Math.round(selectedTimeFraction * 1000));
  applySelectedTime();
}

// Places the scrub dot at `selectedTimeFraction`'s position between
// currentDayMonth's own time-slider bounds. Safe to call with no bounds
// (deep polar night) or no overlay -- just does nothing visible.
function applySelectedTime() {
  if (!currentDayMonth || !sunOverlay) return;
  const bounds = timeSliderBounds(currentDayMonth);
  if (!bounds) {
    document.getElementById('time-slider-value').textContent = '–';
    sunOverlay.clearScrubDate();
    return;
  }
  const date = new Date(bounds.start.getTime() + selectedTimeFraction * (bounds.end.getTime() - bounds.start.getTime()));
  document.getElementById('time-slider-value').textContent = formatTime(date, currentDayMonth.timeZone);
  sunOverlay.setScrubDate(date);
}

function setupLocationControls() {
  const geolocateBtn = document.getElementById('geolocate-btn');
  const clearBtn = document.getElementById('clear-position-btn');
  const compassBtn = document.getElementById('compass-btn');

  geolocateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Enheten din støtter ikke geolokasjon.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition(pos.coords.latitude, pos.coords.longitude);
        map.setZoom(16);
      },
      () => {
        alert('Fikk ikke tilgang til posisjonen din.');
      }
    );
  });

  clearBtn.addEventListener('click', () => {
    clearPosition();
  });

  compassBtn.addEventListener('click', () => {
    if (compassActive) {
      if (stopCompassHeading) {
        stopCompassHeading();
        stopCompassHeading = null;
      }
      compassActive = false;
      if (sunOverlay) sunOverlay.clearHeading();
      updateCompassButtonVisibility();
      return;
    }

    startCompassHeading((heading) => {
      if (sunOverlay) sunOverlay.setHeading(heading);
    }).then((stopFn) => {
      compassActive = true;
      stopCompassHeading = stopFn;
      updateCompassButtonVisibility();
    }).catch(() => {
      alert('Fikk ikke tilgang til retningssensoren.');
    });
  });

  const facadeBtn = document.getElementById('facade-btn');
  facadeBtn.addEventListener('click', () => {
    if (!sunOverlay) return;
    if (facadeActive) {
      sunOverlay.clearFacadeRange();
      facadeActive = false;
    } else {
      sunOverlay.activateFacadeRange(months);
      // activateFacadeRange() silently no-ops during polar night (no daylight
      // arc to seed from -- see its own guard in js/sun-overlay.js), so read
      // back the overlay's actual resulting state instead of assuming
      // success: otherwise this flag would desync from reality (the button
      // would think it's "on" while sunOverlay.facadeRange stays null, so the
      // next click would call clearFacadeRange(), itself a no-op, instead of
      // turning anything on).
      facadeActive = !!sunOverlay.facadeRange;
    }
    updateFacadeButtonVisibility();
  });

  const daySlider = document.getElementById('day-slider');
  daySlider.addEventListener('input', () => {
    selectedDay = Number(daySlider.value);
    applySelectedDay();
  });

  const timeSlider = document.getElementById('time-slider');
  timeSlider.addEventListener('input', () => {
    selectedTimeFraction = Number(timeSlider.value) / 1000;
    applySelectedTime();
  });
}

