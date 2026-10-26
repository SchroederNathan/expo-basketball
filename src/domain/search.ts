export type SearchQuery = string & { readonly __brand: 'SearchQuery' };

export const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_LENGTH = 60;

function isSearchQuery(value: string): value is SearchQuery {
  return value.length >= MIN_SEARCH_LENGTH && value.length <= MAX_SEARCH_LENGTH;
}

// Search requests carry the trimmed text with inner whitespace collapsed, so
// "  curry " and "curry" share one cached answer.
export function toSearchQuery(raw: string): SearchQuery | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  return isSearchQuery(value) ? value : null;
}
