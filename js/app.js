let map;
let marker;
let currentPosition = null; // { lat, lng }
let sunOverlay;
let months = null; // array of 12 { name, points, sunrise, sunset, dayLengthMs, color }
let selectedMonthIndex = new Date().getMonth();
let compassActive = false;
let stopCompassHeading = null;

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
  if (sunOverlay) sunOverlay.setMonth(months[selectedMonthIndex]);
  updateClearButtonVisibility();
  updateCompassButtonVisibility();
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
  if (sunOverlay) sunOverlay.clear();
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
}

function updateClearButtonVisibility() {
  document.getElementById('clear-position-btn').classList.toggle('hidden', !currentPosition);
}

// Hidden once compass tracking is already on (no point re-prompting for
// permission), and whenever there's no pinned point to show a needle at.
function updateCompassButtonVisibility() {
  const btn = document.getElementById('compass-btn');
  if (!btn) return;
  btn.classList.toggle('hidden', !supportsCompass() || !currentPosition || compassActive);
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
  for (const btn of document.querySelectorAll('.month-btn')) {
    btn.classList.remove('active');
  }
  document.querySelectorAll('.month-btn')[i].classList.add('active');
  if (sunOverlay && months) sunOverlay.setMonth(months[i]);
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
}

