/**
 * SHA-256 hex digest via Web Crypto API.
 *
 * Available in Node 19+ (globalThis.crypto.subtle), modern browsers, and
 * happy-dom test environment (which inherits Node's globalThis.crypto). The
 * CMS targets Node 20.19, so a single Web Crypto path is sufficient.
 *
 * Used by the draft gate: site.draftPassword is hashed at build time (in
 * the Vite plugin) so the plaintext never reaches the bundle. At runtime,
 * the user's input is hashed and compared against the stored hash.
 */

export async function sha256Hex(input) {
  const text = typeof input === 'string' ? input : String(input ?? '');
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
