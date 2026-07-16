let map;
let marker;
let currentPosition = null; // { lat, lng }
let sunOverlay;
let months = null; // array of 12 { name, points, sunrise, sunset, dayLengthMs, color }
let selectedMonthIndex = new Date().getMonth();

const DEFAULT_CENTER = { lat: 59.9139, lng: 10.7522 }; // Oslo

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
    mapId: 'DEMO_MAP_ID',
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
    marker.map = null;
  }
  const dot = document.createElement('div');
  dot.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4285f4;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)';
  marker = new google.maps.marker.AdvancedMarkerElement({
    position: { lat, lng },
    map,
    content: dot,
  });

  map.panTo({ lat, lng });
  if (sunOverlay) sunOverlay.setPosition(lat, lng);
  const timeZone = tzlookup(lat, lng);
  months = getMonthlyOverview(lat, lng, new Date().getFullYear(), timeZone);
  renderMonthButtons();
  if (sunOverlay) sunOverlay.setMonth(months[selectedMonthIndex]);
  updateClearButtonVisibility();
  updateTimezoneLabel(months[selectedMonthIndex]);
  playSunriseAnimation();
}

// Flags that the displayed times are the PINNED LOCATION's own local
// time, not the viewer's -- otherwise e.g. "06:43" for a Miami pin looks
// like an ordinary clock reading with no hint it isn't your own time.
function updateTimezoneLabel(month) {
  const label = document.getElementById('timezone-label');
  const referenceDate = month.sunrise || month.sunset || new Date();
  const offsetMin = Math.round(getUtcOffsetMinutes(referenceDate, month.timeZone));
  const sign = offsetMin >= 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(offsetMin) / 60);
  const mins = Math.abs(offsetMin) % 60;
  const offsetStr = mins === 0 ? `${hours}` : `${hours}:${String(mins).padStart(2, '0')}`;
  label.textContent = `Tider vist i stedets lokale tid (UTC${sign}${offsetStr})`;
  label.classList.remove('hidden');
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
    marker.map = null;
    marker = null;
  }
  currentPosition = null;
  months = null;
  if (sunOverlay) sunOverlay.clear();
  document.getElementById('month-buttons-container').innerHTML = '';
  document.getElementById('timezone-label').classList.add('hidden');
  document.getElementById('sunrise-anim').classList.add('hidden');
  if (sunriseAnimFrame) {
    cancelAnimationFrame(sunriseAnimFrame);
    sunriseAnimFrame = null;
  }
  updateClearButtonVisibility();
}

function updateClearButtonVisibility() {
  document.getElementById('clear-position-btn').classList.toggle('hidden', !currentPosition);
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
  if (months) updateTimezoneLabel(months[i]);
}

function setupLocationControls() {
  const geolocateBtn = document.getElementById('geolocate-btn');
  const clearBtn = document.getElementById('clear-position-btn');

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
}

