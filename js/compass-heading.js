// Wraps the browser's DeviceOrientationEvent API to expose a single
// compass heading in degrees (0=north, clockwise -- the same convention
// used everywhere else in this app for azimuth). Two real-world
// complications this file exists to hide from the rest of the app:
//
// 1. iOS Safari gates DeviceOrientationEvent behind an explicit
//    permission prompt that can only be triggered from a user gesture
//    (DeviceOrientationEvent.requestPermission()) -- Android has no such
//    gate and the method doesn't exist there at all.
// 2. The two platforms hand back heading in different shapes: iOS's
//    `deviceorientation` event carries a ready-made, already-calibrated
//    `webkitCompassHeading`; Android's `deviceorientationabsolute` event
//    (or a plain `deviceorientation` as an uncalibrated last resort) only
//    gives `alpha`, which increases counter-clockwise from the device's
//    own arbitrary reference and has to be flipped to match this app's
//    clockwise-from-true-north convention.

// Pure -- no DOM/window access -- so this piece alone is Node-testable.
function headingFromOrientationEvent(event) {
  if (typeof event.webkitCompassHeading === 'number') {
    return event.webkitCompassHeading;
  }
  if (typeof event.alpha === 'number') {
    return (360 - event.alpha) % 360;
  }
  return null;
}

// Starts listening for compass heading changes, calling onHeading(deg)
// on every update. Returns a Promise that resolves to a stop() function
// once a listener is attached (permission granted, or not needed on this
// platform), or rejects with an Error('unsupported') / Error('denied').
function startCompassHeading(onHeading) {
  return new Promise((resolve, reject) => {
    if (typeof DeviceOrientationEvent === 'undefined') {
      reject(new Error('unsupported'));
      return;
    }

    function attach() {
      const eventName = 'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation';

      function handleOrientation(event) {
        const heading = headingFromOrientationEvent(event);
        if (heading !== null) onHeading(heading);
      }

      window.addEventListener(eventName, handleOrientation);
      resolve(() => window.removeEventListener(eventName, handleOrientation));
    }

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then((state) => (state === 'granted' ? attach() : reject(new Error('denied'))))
        .catch(() => reject(new Error('denied')));
    } else {
      attach();
    }
  });
}
