/**
 * Case/whitespace-insensitive key used both for geocode cache lookups
 * (`GeocodeService`) and curated distillery-name matching
 * (`DistilleryLocationsService`). Pulled out on its own so the two services
 * can share it without importing each other.
 */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}
