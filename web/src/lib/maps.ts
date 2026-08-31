/** Google Maps search link for a place name — the fallback used when a
 * location doesn't have a custom maps URL set. */
export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The maps link to open for a location: a custom URL if one was set,
 * otherwise a search link built from its name. `null` when there's neither
 * a name nor a custom URL to link to. */
export function mapsUrlFor(
  name: string | null | undefined,
  customUrl: string | null | undefined,
): string | null {
  const trimmedUrl = customUrl?.trim();
  if (trimmedUrl) return trimmedUrl;
  const trimmedName = name?.trim();
  if (trimmedName) return googleMapsSearchUrl(trimmedName);
  return null;
}
