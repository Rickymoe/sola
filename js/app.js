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
    disableDefaultUI: false,
    mapId: 'DEMO_MAP_ID',
  });

  map.addListener('click', (e) => {
    setPosition(e.latLng.lat(), e.latLng.lng());
  });

  setupLocationControls();
  setupDateTimeControls();

  sunOverlay = createSunPathOverlay();
  sunOverlay.setMap(map);
}

function setPosition(lat, lng) {
  currentPosition = { lat, lng };

  if (marker) {
    marker.map = null;
  }
  const dot = document.createElement('div');
  dot.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#ff9800;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)';
  marker = new google.maps.marker.AdvancedMarkerElement({
    position: { lat, lng },
    map,
    content: dot,
  });

  map.panTo({ lat, lng });
  updateSunReadout();
  if (sunOverlay) sunOverlay.setPosition(lat, lng);
}

const ADDRESS_SEARCH_DEBOUNCE_MS = 300;
let addressSearchTimer = null;

function setupLocationControls() {
  const input = document.getElementById('address-input');
  const suggestions = document.getElementById('address-suggestions');
  const geolocateBtn = document.getElementById('geolocate-btn');

  input.addEventListener('input', () => {
    clearTimeout(addressSearchTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      suggestions.classList.add('hidden');
      suggestions.innerHTML = '';
      return;
    }
    addressSearchTimer = setTimeout(async () => {
      let results;
      try {
        results = await searchAddresses(query);
      } catch (err) {
        suggestions.classList.add('hidden');
        return;
      }
      renderAddressSuggestions(results);
    }, ADDRESS_SEARCH_DEBOUNCE_MS);
  });

  document.addEventListener('click', (e) => {
    if (!suggestions.contains(e.target) && e.target !== input) {
      suggestions.classList.add('hidden');
    }
  });

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

  function renderAddressSuggestions(results) {
    suggestions.innerHTML = '';
    if (results.length === 0) {
      suggestions.classList.add('hidden');
      return;
    }
    for (const r of results) {
      const li = document.createElement('li');
      li.textContent = r.label;
      li.addEventListener('click', () => {
        input.value = r.label;
        suggestions.classList.add('hidden');
        setPosition(r.lat, r.lon);
        map.setZoom(16);
      });
      suggestions.appendChild(li);
    }
    suggestions.classList.remove('hidden');
  }
}

let currentDate = new Date();

function formatDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setupDateTimeControls() {
  const input = document.getElementById('datetime-input');
  input.value = formatDatetimeLocal(currentDate);

  input.addEventListener('input', () => {
    if (!input.value) return;
    currentDate = new Date(input.value);
    updateSunReadout();
  });
}

function updateSunReadout() {
  const readout = document.getElementById('sun-readout');
  if (!currentPosition) {
    readout.classList.add('hidden');
    return;
  }
  if (sunOverlay) sunOverlay.setDate(currentDate);
  readout.classList.remove('hidden');

  const { azimuthDeg, altitudeDeg } = getSunPosition(currentDate, currentPosition.lat, currentPosition.lng);
  document.getElementById('altitude-value').textContent = altitudeDeg.toFixed(1);
  document.getElementById('azimuth-value').textContent = azimuthDeg.toFixed(1);
}
