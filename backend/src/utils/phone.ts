/**
 * Indian phone number utilities.
 *
 * normalizeIndianPhone: strips country-code prefixes, whitespace and punctuation,
 * and validates that the result is a 10-digit number starting with 6–9.
 * Returns the 10-digit string on success, null on failure.
 *
 * buildWhatsAppUrl: composes a wa.me deep-link.  Returns null when the phone is
 * invalid so callers can hide the button instead of showing a broken link.
 */

/**
 * Strips formatting and country-code prefixes from an Indian mobile number and
 * returns the bare 10-digit number, or null if it cannot be normalised.
 *
 * Accepted inputs (all yield '9876543210'):
 *   '9876543210'
 *   '+919876543210'
 *   '00919876543210'
 *   '919876543210'   (12 digits starting with 91)
 *   '09876543210'    (11 digits starting with 0)
 *   ' 98765-43210 '  (spaces, dashes)
 */
export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Remove every character that is not a digit or a leading '+'
  let s = raw.trim();
  // Drop a leading + so that +91… becomes 91…
  if (s.startsWith('+')) s = s.slice(1);
  // Now strip all non-digit characters (spaces, dashes, dots, parens, …)
  const digits = s.replace(/\D/g, '');

  if (!digits) return null;

  let local = digits;

  // Strip country-code prefixes
  if (local.startsWith('0091') && local.length === 14) {
    local = local.slice(4);            // 0091 XXXXXXXXXX → XXXXXXXXXX
  } else if (local.startsWith('91') && local.length === 12) {
    local = local.slice(2);            // 91 XXXXXXXXXX → XXXXXXXXXX
  } else if (local.startsWith('0') && local.length === 11) {
    local = local.slice(1);            // 0 XXXXXXXXXX → XXXXXXXXXX
  }

  // Must be exactly 10 digits starting with 6–9
  if (local.length !== 10 || !/^[6-9]\d{9}$/.test(local)) return null;

  return local;
}

/**
 * Returns a wa.me URL with a pre-filled message for the given Indian phone number,
 * or null when the number is invalid.
 */
export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string
): string | null {
  const normalized = normalizeIndianPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/91${normalized}?text=${encodeURIComponent(message)}`;
}

