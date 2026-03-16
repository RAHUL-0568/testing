import { parsePhoneNumberFromString } from "libphonenumber-js";

export interface NormalizedPhone {
  /** E.164 format, e.g. +14155552671 */
  e164: string;
  /** National format, e.g. (415) 555-2671 */
  national: string;
  /** ISO country code, e.g. US, IN, GB (if detected) */
  country?: string;
  /** Country calling code without +, e.g. 1, 91 */
  countryCallingCode?: string;
}

/**
 * Normalize and validate a phone number using the selected country code.
 *
 * - `countryCode` is a calling code like "+1", "+91"
 * - `rawPhone` is whatever the user typed into the phone input
 *
 * Returns `null` if the number is not valid for that country code.
 */
export function normalizePhoneWithCountry(
  rawPhone: string,
  countryCode: string
): NormalizedPhone | null {
  const nationalDigits = String(rawPhone ?? "").replace(/\D/g, "");
  const codeDigits = String(countryCode ?? "").replace(/\D/g, "");

  if (!nationalDigits || !codeDigits) return null;

  const full = `+${codeDigits}${nationalDigits}`;
  const phone = parsePhoneNumberFromString(full);
  if (!phone || !phone.isValid()) return null;

  return {
    e164: phone.number,
    national: phone.formatNational(),
    country: phone.country,
    countryCallingCode: phone.countryCallingCode,
  };
}

