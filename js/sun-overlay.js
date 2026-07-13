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

// Extra canvas space around the SUN_OVERLAY_SIZE circle so the
// sunrise/sunset icons + time labels (drawn right at the rim, where the
// arc starts/ends) have room to render without being clipped by the SVG's
// own viewport.
const SUN_OVERLAY_MARGIN = 34;
const SUN_OVERLAY_CANVAS = SUN_OVERLAY_SIZE + SUN_OVERLAY_MARGIN * 2;

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
      this.div.style.width = `${SUN_OVERLAY_CANVAS}px`;
      this.div.style.height = `${SUN_OVERLAY_CANVAS}px`;
      this.div.style.pointerEvents = 'none';
      this.div.style.display = 'none';

      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('width', String(SUN_OVERLAY_CANVAS));
      this.svg.setAttribute('height', String(SUN_OVERLAY_CANVAS));
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
      this.div.style.left = `${point.x - SUN_OVERLAY_RADIUS - SUN_OVERLAY_MARGIN}px`;
      this.div.style.top = `${point.y - SUN_OVERLAY_RADIUS - SUN_OVERLAY_MARGIN}px`;
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

      const center = { x: SUN_OVERLAY_RADIUS + SUN_OVERLAY_MARGIN, y: SUN_OVERLAY_RADIUS + SUN_OVERLAY_MARGIN };
      this.svg.appendChild(buildCompassLabels(center));

      if (this.month && this.month.points.length > 1) {
        const offsetPoints = this.month.points.map((p) => ({
          x: p.x + SUN_OVERLAY_MARGIN,
          y: p.y + SUN_OVERLAY_MARGIN,
        }));
        const pointsAttr = offsetPoints.map((p) => `${p.x},${p.y}`).join(' ');

        // Filled wedge between the marker (center), the two horizon
        // points, and the arc itself -- drawn first so the glow strokes
        // and icons layer on top of it, not the other way round.
        const wedgeD = `M ${center.x},${center.y} L ${pointsAttr.split(' ').join(' L ')} Z`;
        const wedge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        wedge.setAttribute('d', wedgeD);
        wedge.setAttribute('fill', this.month.color);
        wedge.setAttribute('fill-opacity', '0.45');
        wedge.setAttribute('stroke', 'none');
        this.svg.appendChild(wedge);

        // Layered strokes from wide/faint to thin/opaque fake a soft glow:
        // the color reads strong in the center of the arc and fades toward
        // its edges, rather than one flat-colored line.
        const GLOW_LAYERS = [
          { width: 16, opacity: 0.12 },
          { width: 10, opacity: 0.25 },
          { width: 5, opacity: 0.55 },
          { width: 2, opacity: 1 },
        ];
        for (const layer of GLOW_LAYERS) {
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          path.setAttribute('points', pointsAttr);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', this.month.color);
          path.setAttribute('stroke-width', String(layer.width));
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          path.setAttribute('opacity', String(layer.opacity));
          this.svg.appendChild(path);
        }

        this.svg.appendChild(buildSunMarker(offsetPoints[0], this.month.sunrise, true));
        this.svg.appendChild(buildSunMarker(offsetPoints[offsetPoints.length - 1], this.month.sunset, false));
      }
    }
  }

  return new SunPathOverlay();
}

// Builds the N/Ø/S/V compass labels around the rim, matching the same
// azimuth mapping as sunPolarToXY (0°=north=top, clockwise) so a label's
// position always lines up with the direction it names.
function buildCompassLabels(center) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  // Drop shadow so the badges read as floating above the map instead of
  // sitting flush on it -- without this they camouflage against busy
  // hybrid-map detail (roads, place icons, other labels).
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', 'compass-shadow');
  filter.setAttribute('x', '-50%');
  filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%');
  filter.setAttribute('height', '200%');
  const dropShadow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
  dropShadow.setAttribute('dx', '0');
  dropShadow.setAttribute('dy', '1.5');
  dropShadow.setAttribute('stdDeviation', '1.5');
  dropShadow.setAttribute('flood-opacity', '0.5');
  filter.appendChild(dropShadow);
  defs.appendChild(filter);
  g.appendChild(defs);

  const rimRadius = SUN_OVERLAY_RADIUS;
  const labelRadius = SUN_OVERLAY_RADIUS + 20;
  const directions = [
    { label: 'N', dx: 0, dy: -1 },
    { label: '\u00D8', dx: 1, dy: 0 },
    { label: 'S', dx: 0, dy: 1 },
    { label: 'V', dx: -1, dy: 0 },
  ];
  for (const { label, dx, dy } of directions) {
    const x = center.x + dx * labelRadius;
    const y = center.y + dy * labelRadius;

    // A thin spoke connects the rim to the floating badge, running
    // straight through its center -- ties the badge visually back to
    // the sun-path circle instead of leaving it adrift on the map.
    const spoke = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    spoke.setAttribute('x1', String(center.x + dx * rimRadius));
    spoke.setAttribute('y1', String(center.y + dy * rimRadius));
    spoke.setAttribute('x2', String(x + dx * 10));
    spoke.setAttribute('y2', String(y + dy * 10));
    spoke.setAttribute('stroke', '#fff');
    spoke.setAttribute('stroke-width', '2');
    g.appendChild(spoke);

    const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    backdrop.setAttribute('cx', String(x));
    backdrop.setAttribute('cy', String(y));
    backdrop.setAttribute('r', '10');
    backdrop.setAttribute('fill', '#fff');
    backdrop.setAttribute('filter', 'url(#compass-shadow)');
    g.appendChild(backdrop);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(y));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-size', '16');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', '#333');
    text.textContent = label;
    g.appendChild(text);
  }
  return g;
}

// Builds a small sunrise/sunset marker (white backdrop + line-art sun icon
// + time label) centered on one point (already offset for the overlay's
// own margin). isSunrise flips the arrow direction and swaps in
// "sunrise"/"sunset" for accessibility.
function buildSunMarker(point, time, isSunrise) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${point.x}, ${point.y})`);

  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  backdrop.setAttribute('r', '11');
  backdrop.setAttribute('fill', '#fff');
  backdrop.setAttribute('opacity', '0.9');
  g.appendChild(backdrop);

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  icon.setAttribute('stroke', '#333');
  icon.setAttribute('stroke-width', '1.3');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('fill', 'none');

  const horizon = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  horizon.setAttribute('x1', '-6');
  horizon.setAttribute('y1', '3');
  horizon.setAttribute('x2', '6');
  horizon.setAttribute('y2', '3');
  icon.appendChild(horizon);

  const dome = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dome.setAttribute('d', 'M-3.5 3a3.5 3.5 0 0 1 7 0');
  icon.appendChild(dome);

  // A gap is kept between the arrow and the dome's apex (y=-0.5) so the
  // two read as separate shapes instead of merging into one triangle.
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', isSunrise ? 'M0 -8V-2M-2 -5l2 -3 2 3' : 'M0 -8V-2M-2 -5l2 3 2 -3');
  icon.appendChild(arrow);

  g.appendChild(icon);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '0');
  text.setAttribute('y', '22');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '11');
  text.setAttribute('font-weight', '600');
  text.setAttribute('fill', '#333');
  text.setAttribute('stroke', '#fff');
  text.setAttribute('stroke-width', '3');
  text.setAttribute('paint-order', 'stroke');
  text.textContent = formatTime(time);
  g.appendChild(text);

  return g;
}
