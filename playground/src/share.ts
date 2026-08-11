// encodes the editor's source into the url so a program can be shared.
//
// the code lives in the fragment rather than the query string: fragments are
// never sent to the server, and github pages would ignore a query anyway.

const PREFIX = "#code=";

/**
 * base64url encoding of the utf-8 bytes, so the payload survives a url without
 * escaping and non-ascii source round trips intact.
 */
export function encodeSource(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSource(encoded: string): string | null {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    // btoa output is padded to a multiple of four
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    // a hand-edited or truncated link should fall back to the sample
    return null;
  }
}

/** reads shared source out of the current url, if any. */
export function readSourceFromUrl(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(PREFIX)) return null;
  return decodeSource(hash.slice(PREFIX.length));
}

// --- routing -------------------------------------------------------------

// the guide lives at #guide. everything else is the playground, so a shared
// #code= link keeps working exactly as before.
const GUIDE_HASH = "#guide";

export type Route = "playground" | "guide";

export function readRoute(): Route {
  return window.location.hash.startsWith(GUIDE_HASH) ? "guide" : "playground";
}

/** navigates, adding a history entry so the back button works. */
export function goToRoute(route: Route): void {
  if (route === "guide") {
    window.location.hash = GUIDE_HASH.slice(1);
    return;
  }
  // returning to the playground drops the fragment entirely
  const { origin, pathname } = window.location;
  window.history.pushState(null, "", `${origin}${pathname}`);
  // pushState does not fire hashchange, so tell the app ourselves
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** the shareable url for a given source. */
export function buildShareUrl(source: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${PREFIX}${encodeSource(source)}`;
}

/**
 * updates the address bar without adding a history entry, so sharing does not
 * fill the back button with every keystroke.
 */
export function updateUrl(source: string): void {
  window.history.replaceState(null, "", buildShareUrl(source));
}
