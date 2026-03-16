import CryptoJS from "crypto-js";

/**
 * AES encrypt with MY_KEY + IV (must match backend).
 * Encrypts a string and returns Base64 ciphertext.
 */
export function encrypt(text: string): string {
  const keyStr = process.env.MY_KEY;
  const ivStr = process.env.IV_VALUE;
  if (!keyStr || !ivStr) {
    throw new Error("MY_KEY and IV_VALUE must be set in .env.local");
  }
  const secretKey = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  const encrypted = CryptoJS.AES.encrypt(text, secretKey, { iv });
  return encrypted.toString();
}

/**
 * AES decrypt with MY_KEY + IV. Returns plain text or null if decryption fails.
 */
export function decrypt(cipherText: string): string | null {
  try {
    const keyStr = process.env.MY_KEY;
    const ivStr = process.env.IV_VALUE;
    if (!keyStr || !ivStr) return null;
    const secretKey = CryptoJS.enc.Utf8.parse(keyStr);
    const iv = CryptoJS.enc.Utf8.parse(ivStr);
    const bytes = CryptoJS.AES.decrypt(cipherText, secretKey, { iv });
    const str = bytes.toString(CryptoJS.enc.Utf8);
    return str || null;
  } catch {
    return null;
  }
}
