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
