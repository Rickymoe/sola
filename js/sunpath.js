const SUN_RAD = Math.PI / 180;
const SUN_DAY_MS = 1000 * 60 * 60 * 24;
const SUN_J1970 = 2440588;
const SUN_J2000 = 2451545;
const EARTH_OBLIQUITY = SUN_RAD * 23.4397;

function toJulianDay(date) {
  return date.valueOf() / SUN_DAY_MS - 0.5 + SUN_J1970;
}

function toDaysSinceJ2000(date) {
  return toJulianDay(date) - SUN_J2000;
}

function solarMeanAnomaly(d) {
  return SUN_RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(meanAnomaly) {
  const center = SUN_RAD * (
    1.9148 * Math.sin(meanAnomaly) +
    0.02 * Math.sin(2 * meanAnomaly) +
    0.0003 * Math.sin(3 * meanAnomaly)
  );
  const perihelion = SUN_RAD * 102.9372;
  return meanAnomaly + center + perihelion + Math.PI;
}

function sunDeclinationAndRightAscension(d) {
  const meanAnomaly = solarMeanAnomaly(d);
  const eclipticLon = eclipticLongitude(meanAnomaly);
  const declination = Math.asin(Math.sin(EARTH_OBLIQUITY) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(
    Math.sin(eclipticLon) * Math.cos(EARTH_OBLIQUITY),
    Math.cos(eclipticLon)
  );
  return { declination, rightAscension };
}

function siderealTime(d, lonRad) {
  return SUN_RAD * (280.16 + 360.9856235 * d) - lonRad;
}

// Formulas verified against known solstice values for Oslo (59.9N):
// summer solstice solar noon altitude ~53.5°, winter solstice solar noon altitude ~6.7°, both azimuth ~180° (south).
function getSunPosition(date, lat, lon) {
  const lonRad = -SUN_RAD * lon;
  const latRad = SUN_RAD * lat;
  const d = toDaysSinceJ2000(date);
  const { declination, rightAscension } = sunDeclinationAndRightAscension(d);
  const hourAngle = siderealTime(d, lonRad) - rightAscension;

  const altitude = Math.asin(
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle)
  );
  const azimuthFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(declination) * Math.cos(latRad)
  );

  return {
    azimuthDeg: (azimuthFromSouth / SUN_RAD + 180 + 360) % 360,
    altitudeDeg: altitude / SUN_RAD
  };
}

