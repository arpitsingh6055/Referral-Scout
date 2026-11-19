/**
 * Low-level failures (a schema mismatch, a severed extension context, a page element that moved) reach the person as
 * one plain sentence: what happened and what to do. Messages that are already written for people pass through.
 */
export function friendlyError(raw: string): string {
  const m = (raw ?? '').trim();
  if (!m) return 'Something went wrong. Try again.';
  if (/Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(m))
    return 'The extension was just updated or reloaded. Refresh the LinkedIn tab and try again. Nothing was sent.';
  if (/^\s*\[\s*\{[\s\S]*"(?:code|expected)"\s*:/.test(m) || /\bexpected \w+, received \w+\b|\binvalid_type\b|\bZodError\b/i.test(m))
    return 'An answer came back in an unexpected format, so it was not used. Try again; nothing was sent.';
  if (/Cannot read properties of (?:undefined|null)|\bis not a function\b/i.test(m))
    return 'Something on the page was not where it was expected, probably after a LinkedIn update. Refresh the page and try again.';
  if (/Failed to fetch|NetworkError|net::ERR_/i.test(m)) return 'The connection dropped. Check your internet and try again.';
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}
