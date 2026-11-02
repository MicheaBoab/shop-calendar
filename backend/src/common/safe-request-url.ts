// Native EventSource credentials must not reach logs or error response paths.
export function safeRequestUrl(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex < 0) return url;
  const query = new URLSearchParams(url.slice(queryIndex + 1));
  if (!query.has('accessToken')) return url;
  query.delete('accessToken');
  const remaining = query.toString();
  return `${url.slice(0, queryIndex)}${remaining ? `?${remaining}` : ''}`;
}
