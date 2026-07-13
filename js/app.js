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
    mapTypeId: 'satellite',
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

  sunOverlay = createSunPathOverlay();
  sunOverlay.setMap(map);
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
  months = getMonthlyOverview(lat, lng, new Date().getFullYear());
  renderMonthButtons();
  if (sunOverlay) sunOverlay.setMonth(months[selectedMonthIndex]);
  updateClearButtonVisibility();
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

