let map;
let marker;
let currentPosition = null; // { lat, lng }
let sunOverlay;

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
  setupTableToggle();

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
  if (sunOverlay) sunOverlay.setDate(new Date());
  const months = getMonthlyOverview(lat, lng, new Date().getFullYear());
  if (sunOverlay) sunOverlay.setMonthlyOverview(months);
  renderMonthTable(months);
  updateClearButtonVisibility();
  updateTableToggleVisibility();
}

function clearPosition() {
  if (marker) {
    marker.map = null;
    marker = null;
  }
  currentPosition = null;
  if (sunOverlay) sunOverlay.clear();
  document.getElementById('month-table-container').innerHTML = '';
  updateClearButtonVisibility();
  updateTableToggleVisibility();
}

function updateClearButtonVisibility() {
  document.getElementById('clear-position-btn').classList.toggle('hidden', !currentPosition);
}

function updateTableToggleVisibility() {
  document.getElementById('table-toggle-btn').classList.toggle('hidden', !currentPosition);
}

function renderMonthTable(months) {
  const container = document.getElementById('month-table-container');
  const rows = months.map((mo) => `
    <tr>
      <td>${mo.name}</td>
      <td>${formatTime(mo.sunrise)}</td>
      <td>${formatTime(mo.sunset)}</td>
    </tr>
  `).join('');
  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Måned</th><th>Opp</th><th>Ned</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function setupTableToggle() {
  const toggleBtn = document.getElementById('table-toggle-btn');
  const container = document.getElementById('month-table-container');

  toggleBtn.addEventListener('click', () => {
    const collapsed = container.classList.toggle('collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });
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

