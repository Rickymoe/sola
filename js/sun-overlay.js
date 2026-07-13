// Renders the sun's path across the sky for the current date as a
// polar-style overlay centered on the observer's marker: angle = azimuth
// (0°=north, clockwise), radius = altitude mapped so 90° (zenith) is the
// center and 0° (horizon) is the outer rim. This is NOT a geographic path
// on the map's own lat/lng grid — the sun's position is a direction+angle
// from the observer, so it's drawn as a fixed-size overlay pinned to one
// point, the same way a compass rose would be, not as a route polyline.
//
// Must be called only after google.maps has loaded (i.e. from inside
// initMap() or later) -- this is wrapped in a factory function rather than
// a top-level class declaration because this script loads synchronously,
// before the Google Maps API's own async/deferred script tag has
// necessarily finished loading. A top-level `class X extends
// google.maps.OverlayView` would evaluate google.maps.OverlayView
// immediately when parsed, throwing "google is not defined" regardless of
// whether anything constructs the class yet. Wrapping it in a function
// defers that evaluation until createSunPathOverlay() is actually called
// from initMap(), by which point google.maps genuinely exists.
function createSunPathOverlay() {
  class SunPathOverlay extends google.maps.OverlayView {
    constructor() {
      super();
      this.div = null;
      this.svg = null;
      this.position = null; // { lat, lng }
      this.month = null; // { name, points, sunrise, sunset, dayLengthMs, color }, set via setMonth()
    }

    onAdd() {
      this.div = document.createElement('div');
      this.div.style.position = 'absolute';
      this.div.style.width = `${SUN_OVERLAY_SIZE}px`;
      this.div.style.height = `${SUN_OVERLAY_SIZE}px`;
      this.div.style.pointerEvents = 'none';
      this.div.style.display = 'none';

      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('width', String(SUN_OVERLAY_SIZE));
      this.svg.setAttribute('height', String(SUN_OVERLAY_SIZE));
      this.div.appendChild(this.svg);

      this.getPanes().overlayLayer.appendChild(this.div);
      this.render();
    }

    draw() {
      if (!this.div) return;
      if (!this.position) { this.div.style.display = 'none'; return; }

      const projection = this.getProjection();
      const point = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(this.position.lat, this.position.lng)
      );
      this.div.style.display = 'block';
      this.div.style.left = `${point.x - SUN_OVERLAY_RADIUS}px`;
      this.div.style.top = `${point.y - SUN_OVERLAY_RADIUS}px`;
    }

    onRemove() {
      if (this.div && this.div.parentNode) {
        this.div.parentNode.removeChild(this.div);
      }
      this.div = null;
      this.svg = null;
    }

    setPosition(lat, lng) {
      this.position = { lat, lng };
      this.render();
    }

    setMonth(month) {
      this.month = month;
      this.render();
    }

    clear() {
      this.position = null;
      this.month = null;
      if (this.div) this.div.style.display = 'none';
    }

    render() {
      if (!this.svg || !this.position) return;
      while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

      if (this.month && this.month.points.length > 1) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        path.setAttribute('points', this.month.points.map((p) => `${p.x},${p.y}`).join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', this.month.color);
        path.setAttribute('stroke-width', '3');
        this.svg.appendChild(path);
      }

      const rim = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      rim.setAttribute('cx', String(SUN_OVERLAY_RADIUS));
      rim.setAttribute('cy', String(SUN_OVERLAY_RADIUS));
      rim.setAttribute('r', String(SUN_OVERLAY_RADIUS - 2));
      rim.setAttribute('fill', 'none');
      rim.setAttribute('stroke', 'rgba(255,255,255,0.6)');
      rim.setAttribute('stroke-width', '1');
      this.svg.appendChild(rim);
    }
  }

  return new SunPathOverlay();
}
