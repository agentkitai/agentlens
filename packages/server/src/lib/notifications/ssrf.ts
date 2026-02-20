/**
 * Consolidated SSRF protection (Feature 12, SEC-2)
 *
 * Single implementation used by all notification providers and both
 * AlertEngine and GuardrailEngine.
 */

const PRIVATE_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./,
];

export function validateExternalUrl(urlStr: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Disallowed protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
    return { valid: false, reason: 'Localhost URLs are not allowed' };
  }

  // Block private IP ranges
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(hostname))) {
    return { valid: false, reason: `Private IP range blocked: ${hostname}` };
  }

  return { valid: true };
}

/** Simple boolean check (backward compat with AlertEngine) */
export function isWebhookUrlAllowed(url: string): boolean {
  return validateExternalUrl(url).valid;
}
