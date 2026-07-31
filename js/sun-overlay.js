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
      // Always the same value regardless of position/month -- computed once
      // here so setHeading() can rotate the needle in place without paying
      // for a full render() on every single DeviceOrientationEvent (which
      // fires at ~60Hz while the compass is active).
      this.center = { x: SUN_OVERLAY_RADIUS + SUN_OVERLAY_MARGIN, y: SUN_OVERLAY_RADIUS + SUN_OVERLAY_MARGIN };
      this.headingArrowGroup = null; // the <g> built by render(), rotated directly by setHeading()'s fast path
      this.facadeRange = null; // { startAzimuthDeg, endAzimuthDeg, originalStartAzimuthDeg, originalEndAzimuthDeg } or null -- see activateFacadeRange()
      this._facadeRenderPending = false; // true while a scheduleFacadeRender() rAF callback is queued, so pointer moves don't stack up extra render() calls
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
      if (this.headingArrowGroup) {
        // Fast path: DeviceOrientationEvent fires continuously while the
        // compass is active, so this just rewrites one transform attribute
        // instead of tearing down and rebuilding the whole overlay (labels,
        // wedge, glow layers, sun markers) on every single event.
        this.headingArrowGroup.setAttribute('transform', `rotate(${headingDeg}, ${this.center.x}, ${this.center.y})`);
      } else {
        // No needle exists yet (compass just turned on) -- one full render()
        // creates it, after which every subsequent call takes the fast path.
        this.render();
      }
    }

    clear() {
      this.position = null;
      this.month = null;
      this.heading = null;
      this.headingArrowGroup = null;
      this.facadeRange = null;
      if (this.div) this.div.style.display = 'none';
    }

    // Seeds the facade range from the CURRENT month's own sunrise-to-sunset
    // azimuth sweep (its first and last arc point) -- the pie slice starts
    // exactly matching the visible arc's own reach, and the user narrows it
    // from there by dragging an edge inward. No-op if there's no month/arc
    // to seed from yet (button is hidden in that state anyway -- see
    // js/app.js -- but guard here too since this is a public method).
    activateFacadeRange() {
      if (!this.month || this.month.points.length < 2) return;
      const first = this.month.points[0].azimuthDeg;
      const second = this.month.points[1].azimuthDeg;
      const last = this.month.points[this.month.points.length - 1].azimuthDeg;
      // Signed shortest-angle delta (-180..180]: negative means the arc's azimuth
      // is actually sweeping counter-clockwise sample-to-sample (the sun passes
      // north of zenith -- true for the southern hemisphere and much of the
      // tropics), which is the opposite of isAzimuthInRange's clockwise-from-
      // start-to-end assumption. Swap start/end in that case so the seeded
      // range still covers the real daylight sweep instead of its complement.
      const signedDelta = ((second - first + 540) % 360) - 180;
      const start = signedDelta >= 0 ? first : last;
      const end = signedDelta >= 0 ? last : first;
      this.facadeRange = {
        startAzimuthDeg: start,
        endAzimuthDeg: end,
        originalStartAzimuthDeg: start,
        originalEndAzimuthDeg: end,
      };
      this.render();
    }

    clearFacadeRange() {
      this.facadeRange = null;
      this.render();
    }

    // Converts a pointer position (in page/client coordinates) into an
    // azimuth relative to this overlay's own center, updates the dragged
    // edge (clamped), and re-renders -- attached to window (not just the
    // handle) for the duration of the drag so fast pointer movement past
    // the thin handle itself doesn't drop the drag.
    startFacadeDrag(edge, pointerEvent, hitLine) {
      if (!this.facadeRange) return;
      const pointerId = pointerEvent.pointerId;
      hitLine.style.cursor = 'grabbing';

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!this.facadeRange) return; // other hand may have tapped the toggle/clear button mid-drag, clearing the range out from under this drag
        const rect = this.svg.getBoundingClientRect();
        const localX = moveEvent.clientX - rect.left;
        const localY = moveEvent.clientY - rect.top;
        const dx = localX - this.center.x;
        const dy = localY - this.center.y;
        const candidateAzimuthDeg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;

        const clamped = this.clampFacadeAzimuth(edge, candidateAzimuthDeg);
        if (edge === 'start') {
          this.facadeRange.startAzimuthDeg = clamped;
        } else {
          this.facadeRange.endAzimuthDeg = clamped;
        }
        this.scheduleFacadeRender();
      };

      const onUp = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        hitLine.style.cursor = 'grab';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }

    // Clamps a candidate azimuth for the given edge so it can only move
    // INWARD: never past its own original bound (activateFacadeRange()'s
    // starting position), never past the other edge's current position.
    // Delegates to clampAzimuthToArc() (js/sun-year.js), which clamps onto
    // the arc using true circular distance to each boundary -- an earlier
    // version of this method compared positions in one fixed clockwise
    // direction only, which wrapped a candidate that overshot backward past
    // its own bound by a small amount into a huge fixed-direction "distance",
    // clamping it to the FAR edge instead of holding it at its own bound.
    // Confirmed live: dragging 'start' backward past originalStartAzimuthDeg
    // by 40deg (July, 59.91N) used to jump the handle across the whole
    // circle to endAzimuthDeg; clampAzimuthToArc's true-circular-distance
    // comparison holds it at originalStartAzimuthDeg instead.
    clampFacadeAzimuth(edge, candidateAzimuthDeg) {
      const { originalStartAzimuthDeg, originalEndAzimuthDeg, startAzimuthDeg, endAzimuthDeg } = this.facadeRange;
      if (edge === 'start') {
        return clampAzimuthToArc(candidateAzimuthDeg, originalStartAzimuthDeg, endAzimuthDeg);
      }
      return clampAzimuthToArc(candidateAzimuthDeg, startAzimuthDeg, originalEndAzimuthDeg);
    }

    // Pointer moves fire far more often than a render() needs to happen --
    // batches to at most one render per animation frame instead of one per
    // event (same reasoning as js/app.js's playSunriseAnimation using rAF
    // rather than firing on every event source directly).
    scheduleFacadeRender() {
      if (this._facadeRenderPending) return;
      this._facadeRenderPending = true;
      requestAnimationFrame(() => {
        this._facadeRenderPending = false;
        this.render();
      });
    }

    render() {
      if (!this.svg || !this.position) return;
      while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

      const center = this.center;
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
        // its edges, rather than one flat-colored line. When a facade range
        // is active, drawn per facing/non-facing run instead of once for
        // the whole arc, so the non-facing runs can be a fraction of the
        // opacity -- the whole arc still reads as one continuous glow,
        // just fainter outside the facade's field of view.
        const GLOW_LAYERS = [
          { width: 16, opacity: 0.12 },
          { width: 10, opacity: 0.25 },
          { width: 5, opacity: 0.55 },
          { width: 2, opacity: 1 },
        ];
        const NON_FACING_OPACITY_MULTIPLIER = 0.25;

        if (this.facadeRange) {
          const runs = splitByFacing(this.month.points, this.facadeRange);
          for (const run of runs) {
            const runPoints = offsetPoints.slice(run.start, run.end + 1);
            if (runPoints.length < 2) continue;
            const runPointsAttr = runPoints.map((p) => `${p.x},${p.y}`).join(' ');
            const opacityMul = run.facing ? 1 : NON_FACING_OPACITY_MULTIPLIER;
            for (const layer of GLOW_LAYERS) {
              const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
              path.setAttribute('points', runPointsAttr);
              path.setAttribute('fill', 'none');
              path.setAttribute('stroke', this.month.color);
              path.setAttribute('stroke-width', String(layer.width));
              path.setAttribute('stroke-linecap', 'round');
              path.setAttribute('stroke-linejoin', 'round');
              path.setAttribute('opacity', String(layer.opacity * opacityMul));
              this.svg.appendChild(path);
            }
          }

          // Transparent pie-slice hugging the actual sun-path curve within
          // the facing range (not a plain circular sector) -- same
          // construction as the month-color wedge above, just filtered to
          // the facing points and drawn with a much lighter, near-white
          // fill so it reads as a boundary marker, not a second wedge
          // competing with the month's own color.
          const facingRun = runs.find((r) => r.facing);
          if (facingRun) {
            const facingPoints = offsetPoints.slice(facingRun.start, facingRun.end + 1);
            if (facingPoints.length > 1) {
              const facingD = `M ${center.x},${center.y} L ${facingPoints.map((p) => `${p.x},${p.y}`).join(' L ')} Z`;
              const facingSlice = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              facingSlice.setAttribute('d', facingD);
              facingSlice.setAttribute('fill', '#fff');
              facingSlice.setAttribute('fill-opacity', '0.18');
              facingSlice.setAttribute('stroke', 'none');
              this.svg.appendChild(facingSlice);
            }
          }
        } else {
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
        }

        this.svg.appendChild(buildSunMarker(offsetPoints[0], this.month.sunrise, true, this.month.timeZone));
        this.svg.appendChild(buildSunMarker(offsetPoints[offsetPoints.length - 1], this.month.sunset, false, this.month.timeZone));

        if (this.facadeRange) {
          const edgeTimes = { facadeRange: this.facadeRange, sunrise: this.month.sunrise, sunset: this.month.sunset };
          this.svg.appendChild(buildFacadeHandle(center, this.facadeRange.startAzimuthDeg, this.month.points, this.month.timeZone, (e, hitLine) => this.startFacadeDrag('start', e, hitLine), edgeTimes));
          this.svg.appendChild(buildFacadeHandle(center, this.facadeRange.endAzimuthDeg, this.month.points, this.month.timeZone, (e, hitLine) => this.startFacadeDrag('end', e, hitLine), edgeTimes));
        }
      }

      // computeNowPoint() (js/sun-year.js) already returns null for every
      // case where nothing should be drawn (not today's month, no
      // position, or night), so no extra guard is needed here. `now` is
      // captured once here and reused for the time label below so the dot's
      // position and its label can never disagree by straddling a minute
      // boundary across two separate `new Date()` calls.
      const now = new Date();
      const nowPoint = computeNowPoint(this.month, this.position, now);
      if (nowPoint) {
        const dotX = nowPoint.x + SUN_OVERLAY_MARGIN;
        const dotY = nowPoint.y + SUN_OVERLAY_MARGIN;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(dotX));
        dot.setAttribute('cy', String(dotY));
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', this.month.color);
        // A white stroke stops the dot from disappearing into the arc's own
        // same-colored glow layers underneath it (confirmed near-invisible
        // without this: same rgb() fill sitting on the same-hue wedge/glow).
        dot.setAttribute('stroke', '#fff');
        dot.setAttribute('stroke-width', '2');
        dot.setAttribute('class', 'sun-now-dot');
        this.svg.appendChild(dot);
        const tangent = { x: nowPoint.tangentX, y: nowPoint.tangentY };
        this.svg.appendChild(buildNowLabel({ x: dotX, y: dotY }, this.center, tangent, formatTime(now, this.month.timeZone)));
      }

      if (this.heading !== null) {
        this.headingArrowGroup = buildHeadingArrow(center, this.heading);
        this.svg.appendChild(this.headingArrowGroup);
      } else {
        this.headingArrowGroup = null;
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

// Same blue as the pinned-location dot (js/app.js's marker, #4285f4) so the
// needle reads as "an extension of that dot" rather than a competing color.
const HEADING_ARROW_COLOR = '#4285f4';

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
  // Reuses buildCompassLabels' own drop-shadow filter (already defined in
  // the SVG by the time this renders) so the needle floats above busy
  // satellite-map detail the same way the N/Ø/S/V badges already do,
  // instead of blending into whatever's underneath it.
  g.setAttribute('filter', 'url(#compass-shadow)');

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
  shaft.setAttribute('stroke', HEADING_ARROW_COLOR);
  shaft.setAttribute('stroke-width', '3');
  shaft.setAttribute('stroke-linecap', 'round');
  g.appendChild(shaft);

  const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tip.setAttribute('d', `M ${center.x - 6},${shaftTipY + 10} L ${center.x},${shaftTipY} L ${center.x + 6},${shaftTipY + 10} Z`);
  tip.setAttribute('fill', HEADING_ARROW_COLOR);
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

// Builds the small "HH:MM" pill shown next to the pulsing now-dot (see the
// `sun-now-dot` circle in render()). Two earlier approaches both missed:
// pushing the pill a fixed distance out FROM THE DOT along the center->dot
// direction only clears the wedge once the dot is already near the rim
// (confirmed live: still inside the wedge mid-afternoon, well before
// sunset). Pinning it to a fixed radius past the rim instead (matching
// buildCompassLabels()'s ring) cleared the wedge at every time of day, but
// left the pill looking disconnected from the dot when the dot itself
// sits far from the rim. Instead, offset perpendicular to the arc's own
// local direction of travel (`tangent`, from computeNowPoint() in
// js/sun-year.js) -- this only needs to clear the stroke's own width, not
// the whole wedge, so the pill can stay close to the dot at any time of
// day. `point` must already be offset by SUN_OVERLAY_MARGIN, same
// convention as the dot's own cx/cy; `center` disambiguates which of the
// two perpendicular directions points away from the wedge (outward).
function buildNowLabel(point, center, tangent, timeText) {
  const LABEL_GAP = 20; // px perpendicular to the arc -- clears the widest glow layer (16px stroke, 8px half-width) plus room for the pill itself
  const PILL_WIDTH = 34;
  const PILL_HEIGHT = 16;

  // Perpendicular to the direction of travel -- two candidates, rotated
  // +90 deg and -90 deg from the tangent. Pick whichever one points away
  // from center (same side as the dot already is), so the pill always
  // lands on the outward side of the curve, not back toward the wedge.
  let px = -tangent.y;
  let py = tangent.x;
  const outwardDot = (point.x - center.x) * px + (point.y - center.y) * py;
  if (outwardDot < 0) {
    px = -px;
    py = -py;
  }

  const labelX = point.x + px * LABEL_GAP;
  const labelY = point.y + py * LABEL_GAP;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${labelX}, ${labelY})`);

  const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  pill.setAttribute('x', String(-PILL_WIDTH / 2));
  pill.setAttribute('y', String(-PILL_HEIGHT / 2));
  pill.setAttribute('width', String(PILL_WIDTH));
  pill.setAttribute('height', String(PILL_HEIGHT));
  pill.setAttribute('rx', String(PILL_HEIGHT / 2));
  pill.setAttribute('fill', '#fff');
  g.appendChild(pill);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '0');
  text.setAttribute('y', '4');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '11');
  text.setAttribute('font-weight', '600');
  text.setAttribute('fill', '#333');
  text.textContent = timeText;
  g.appendChild(text);

  return g;
}

// Past the compass ring (SUN_OVERLAY_RADIUS + 38) so the facade handles
// have their own clear grab zone, not overlapping the ring visually.
const FACADE_HANDLE_RADIUS = SUN_OVERLAY_RADIUS + 45;

// Builds one draggable-looking edge of the facade field-of-view pie slice:
// a dashed line from center out past the rim (see FACADE_HANDLE_RADIUS),
// with a wide invisible hit-line underneath for a forgiving grab/touch
// target (the visible 2px dashed line is too thin to reliably grab,
// especially on mobile), and a time-label pill at the outer tip -- placed
// there deliberately (not at the arc crossing) so it lines up with the
// existing sunrise/sunset badges at first, before any dragging: same
// underlying measurement, same place, so the connection is obvious. To make
// that actually true (not just approximately true), `edgeTimes.facadeRange`
// is checked against its own ORIGINAL (undragged) bounds: when this handle
// sits exactly at its original azimuth, the exact `edgeTimes.sunrise`/
// `edgeTimes.sunset` crossing is used for the label instead of
// `findTimeForAzimuth`'s coarser interpolation over 10-minute samples --
// those two can disagree by up to ~10 minutes, which used to make the two
// "same measurement" badges show different times. Once the handle has been
// dragged away from its original bound, there's no exact reference time for
// that new azimuth, so it falls back to `findTimeForAzimuth` as before.
// `onPointerDown(event, hitLineElement)` is called on the hit-line's own
// pointerdown (Task 3 wires the actual drag there).
function buildFacadeHandle(center, azimuthDeg, points, timeZone, onPointerDown, edgeTimes) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'facade-handle');

  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const tipX = center.x + FACADE_HANDLE_RADIUS * Math.sin(azimuthRad);
  const tipY = center.y - FACADE_HANDLE_RADIUS * Math.cos(azimuthRad);

  const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  hitLine.setAttribute('x1', String(center.x));
  hitLine.setAttribute('y1', String(center.y));
  hitLine.setAttribute('x2', String(tipX));
  hitLine.setAttribute('y2', String(tipY));
  hitLine.setAttribute('stroke', 'transparent');
  hitLine.setAttribute('stroke-width', '24');
  hitLine.style.pointerEvents = 'auto'; // re-enables interaction under the div's own pointer-events:none (see onAdd())
  hitLine.style.cursor = 'grab';
  hitLine.style.touchAction = 'none'; // without this, the browser claims the first finger movement as a pan/zoom gesture and fires pointercancel, tearing down the drag before it starts
  hitLine.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); // stop the map underneath from starting its own drag/pan
    e.preventDefault();
    onPointerDown(e, hitLine);
  });
  g.appendChild(hitLine);

  const visibleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  visibleLine.setAttribute('x1', String(center.x));
  visibleLine.setAttribute('y1', String(center.y));
  visibleLine.setAttribute('x2', String(tipX));
  visibleLine.setAttribute('y2', String(tipY));
  visibleLine.setAttribute('stroke', '#333');
  visibleLine.setAttribute('stroke-width', '2');
  visibleLine.setAttribute('stroke-dasharray', '5 4');
  g.appendChild(visibleLine);

  let time;
  if (azimuthDeg === edgeTimes.facadeRange.originalStartAzimuthDeg) {
    time = edgeTimes.sunrise;
  } else if (azimuthDeg === edgeTimes.facadeRange.originalEndAzimuthDeg) {
    time = edgeTimes.sunset;
  } else {
    time = findTimeForAzimuth(points, azimuthDeg);
  }
  if (time) {
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    label.setAttribute('transform', `translate(${tipX}, ${tipY})`);

    const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    pill.setAttribute('x', '-17');
    pill.setAttribute('y', '-8');
    pill.setAttribute('width', '34');
    pill.setAttribute('height', '16');
    pill.setAttribute('rx', '8');
    pill.setAttribute('fill', '#fff');
    label.appendChild(pill);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '0');
    text.setAttribute('y', '4');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-weight', '600');
    text.setAttribute('fill', '#333');
    text.textContent = formatTime(time, timeZone);
    label.appendChild(text);

    g.appendChild(label);
  }

  return g;
}
