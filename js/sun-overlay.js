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
const SUN_OVERLAY_MARGIN = 52;
const SUN_OVERLAY_CANVAS = SUN_OVERLAY_SIZE + SUN_OVERLAY_MARGIN * 2;

function createSunPathOverlay() {
  class SunPathOverlay extends google.maps.OverlayView {
    constructor() {
      super();
      this.div = null;
      this.svg = null;
      this.position = null; // { lat, lng }
      this.month = null; // { name, points, sunrise, sunset, dayLengthMs, color }, set via setMonth()
      this.heading = null; // degrees, 0=north/clockwise, set via setHeading()
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

    setHeading(headingDeg) {
      this.heading = headingDeg;
      this.render();
    }

    clear() {
      this.position = null;
      this.month = null;
      this.heading = null;
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

        this.svg.appendChild(buildSunMarker(offsetPoints[0], this.month.sunrise, true, this.month.timeZone));
        this.svg.appendChild(buildSunMarker(offsetPoints[offsetPoints.length - 1], this.month.sunset, false, this.month.timeZone));
      }

      if (this.heading !== null) {
        this.svg.appendChild(buildHeadingArrow(center, this.heading));
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

  const labelRadius = SUN_OVERLAY_RADIUS + 38;
  const directions = [
    { label: 'N', dx: 0, dy: -1 },
    { label: '\u00D8', dx: 1, dy: 0 },
    { label: 'S', dx: 0, dy: 1 },
    { label: 'V', dx: -1, dy: 0 },
  ];
  const points = directions.map(({ dx, dy }) => ({
    x: center.x + dx * labelRadius,
    y: center.y + dy * labelRadius,
  }));

  // A thin white ring through N/\u00D8/S/V ties the four floating badges
  // together into one compass rose instead of leaving each adrift on
  // its own -- a circle (not a straight-edged polygon) since all four
  // sit at the same radius anyway, so it reads as a curved compass ring.
  const frame = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  frame.setAttribute('cx', String(center.x));
  frame.setAttribute('cy', String(center.y));
  frame.setAttribute('r', String(labelRadius));
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', '#e2574c');
  frame.setAttribute('stroke-width', '6');
  g.appendChild(frame);

  directions.forEach(({ label }, i) => {
    const { x, y } = points[i];

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
  });
  return g;
}

// Length of the arrow's pointing shaft, in px from the center -- kept
// shorter than labelRadius (SUN_OVERLAY_RADIUS + 38) so the arrowhead
// never overlaps the N/Ø/S/V ring.
const HEADING_ARROW_LENGTH = SUN_OVERLAY_RADIUS - 15;

// Draws a compass-needle-style pointer from the overlay's center,
// rotated to headingDeg (0=north=top, clockwise -- the same azimuth
// convention buildCompassLabels and the sun-path arc already use).
// Rotating the whole group with a single SVG rotate() around `center`
// keeps the shaft/tip/tail geometry simple (always drawn pointing
// straight up, i.e. toward north) while still ending up pointing the
// right way -- SVG's rotate() is clockwise for positive angles, which
// already matches this app's azimuth direction, so no sign flip needed.
function buildHeadingArrow(center, headingDeg) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `rotate(${headingDeg}, ${center.x}, ${center.y})`);

  // Short grey tail pointing opposite the heading, so the needle reads
  // as "pivoting around the center" rather than "starting from nothing."
  const tail = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  tail.setAttribute('x1', String(center.x));
  tail.setAttribute('y1', String(center.y));
  tail.setAttribute('x2', String(center.x));
  tail.setAttribute('y2', String(center.y + 20));
  tail.setAttribute('stroke', '#999');
  tail.setAttribute('stroke-width', '3');
  tail.setAttribute('stroke-linecap', 'round');
  g.appendChild(tail);

  const shaftTipY = center.y - HEADING_ARROW_LENGTH;
  const shaft = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  shaft.setAttribute('x1', String(center.x));
  shaft.setAttribute('y1', String(center.y));
  shaft.setAttribute('x2', String(center.x));
  shaft.setAttribute('y2', String(shaftTipY));
  shaft.setAttribute('stroke', '#e2574c');
  shaft.setAttribute('stroke-width', '3');
  shaft.setAttribute('stroke-linecap', 'round');
  g.appendChild(shaft);

  const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tip.setAttribute('d', `M ${center.x - 6},${shaftTipY + 10} L ${center.x},${shaftTipY} L ${center.x + 6},${shaftTipY + 10} Z`);
  tip.setAttribute('fill', '#e2574c');
  g.appendChild(tip);

  return g;
}

// Builds a small sunrise/sunset marker (white backdrop + line-art sun icon
// + time label) centered on one point (already offset for the overlay's
// own margin). isSunrise flips the arrow direction and swaps in
// "sunrise"/"sunset" for accessibility.
function buildSunMarker(point, time, isSunrise, timeZone) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${point.x}, ${point.y})`);

  // Sunrise gets a cool gold backdrop, sunset a warmer coral one -- so
  // the two badges read as distinct at a glance instead of looking
  // like identical white circles (and distinct from the plain-white
  // compass badges too).
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  backdrop.setAttribute('r', '11');
  backdrop.setAttribute('fill', isSunrise ? '#ffe29a' : '#ffab7a');
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
  text.textContent = formatTime(time, timeZone);
  g.appendChild(text);

  return g;
}
