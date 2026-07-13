const KARTVERKET_ADDRESS_SEARCH_URL = 'https://ws.geonorge.no/adresser/v1/sok';
const KARTVERKET_REVERSE_GEOCODE_URL = 'https://ws.geonorge.no/adresser/v1/punktsok';
const ADDRESS_SEARCH_RESULT_LIMIT = 5;
const REVERSE_GEOCODE_RADIUS_M = 200;
// Kartverket's address endpoints intermittently return HTTP 500 under normal
// operation (observed repeatedly during development, unrelated to query
// content) — one retry after a short pause smooths over most of these
// transient blips instead of surfacing them to the user as "no results".
const KARTVERKET_MAX_ATTEMPTS = 3;
const KARTVERKET_RETRY_DELAY_MS = 400;

async function fetchKartverketJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= KARTVERKET_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Kartverket-kall feilet (${res.status})`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < KARTVERKET_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, KARTVERKET_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

function toAddressResult(a) {
  return {
    label: `${a.adressetekst}, ${a.postnummer} ${a.poststed}`,
    lat: a.representasjonspunkt.lat,
    lon: a.representasjonspunkt.lon
  };
}

async function searchAddresses(query) {
  const params = new URLSearchParams({
    sok: query,
    fuzzy: 'true',
    treffPerSide: String(ADDRESS_SEARCH_RESULT_LIMIT),
    asciiKompatibel: 'true'
  });
  const url = `${KARTVERKET_ADDRESS_SEARCH_URL}?${params.toString()}`;
  const data = await fetchKartverketJson(url);
  return data.adresser.map(toAddressResult);
}

async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: String(REVERSE_GEOCODE_RADIUS_M),
    treffPerSide: '1'
  });
  const url = `${KARTVERKET_REVERSE_GEOCODE_URL}?${params.toString()}`;
  const data = await fetchKartverketJson(url);
  if (data.adresser.length === 0) return null;
  return toAddressResult(data.adresser[0]);
}
