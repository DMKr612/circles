import type { LatLng } from "@/lib/location";

type GeocodeResult = {
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
};

export type CitySuggestion = {
  name: string;
  label: string;
  lat: number | null;
  lng: number | null;
};

const searchCache = new Map<string, GeocodeResult | null>();
const reverseCache = new Map<string, { city: string | null; country: string | null } | null>();
const citySuggestCache = new Map<string, CitySuggestion[]>();

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function parseGeocodeRow(row: any): GeocodeResult | null {
  const lat = Number(row?.lat);
  const lng = Number(row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = row?.address || {};
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    null;
  const country = address.country || null;

  return { lat, lng, city, country };
}

export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  const key = normalize(query);
  if (!key) return null;
  if (searchCache.has(key)) return searchCache.get(key) || null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      searchCache.set(key, null);
      return null;
    }
    const data = await res.json();
    const parsed = Array.isArray(data) && data.length ? parseGeocodeRow(data[0]) : null;
    searchCache.set(key, parsed);
    return parsed;
  } catch {
    searchCache.set(key, null);
    return null;
  }
}

export async function reverseGeocodeCity(coords: LatLng): Promise<{ city: string | null; country: string | null } | null> {
  const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
  if (reverseCache.has(key)) return reverseCache.get(key) || null;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${coords.lat}&lon=${coords.lng}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      reverseCache.set(key, null);
      return null;
    }
    const data = await res.json();
    const address = data?.address || {};
    const city =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      null;
    const country = address.country || null;
    const result = { city, country };
    reverseCache.set(key, result);
    return result;
  } catch {
    reverseCache.set(key, null);
    return null;
  }
}

export async function searchGermanCitySuggestions(query: string, limit = 10): Promise<CitySuggestion[]> {
  const key = `${normalize(query)}::${limit}`;
  if (!normalize(query)) return [];
  if (citySuggestCache.has(key)) return citySuggestCache.get(key) || [];

  try {
    const safeLimit = Math.max(1, Math.min(20, Math.round(limit)));
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1` +
      `&countrycodes=de&limit=${safeLimit}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      citySuggestCache.set(key, []);
      return [];
    }

    const data = await res.json();
    const seen = new Set<string>();
    const out: CitySuggestion[] = [];

    if (Array.isArray(data)) {
      data.forEach((row: any) => {
        const lat = Number(row?.lat);
        const lng = Number(row?.lon);
        const address = row?.address || {};
        const cityName =
          address.city ||
          address.town ||
          address.village ||
          address.municipality ||
          address.county ||
          String(row?.display_name || "").split(",")[0]?.trim() ||
          "";
        if (!cityName) return;
        const state = address.state || address.region || address.county || "";
        const label = state && String(state).toLowerCase() !== String(cityName).toLowerCase()
          ? `${cityName}, ${state}`
          : cityName;
        const dedupeKey = label.toLowerCase();
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        out.push({
          name: String(cityName),
          label: String(label),
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
        });
      });
    }

    citySuggestCache.set(key, out);
    return out;
  } catch {
    citySuggestCache.set(key, []);
    return [];
  }
}
