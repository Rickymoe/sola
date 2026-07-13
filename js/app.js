let map;
let marker;
let currentPosition = null; // { lat, lng }

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
