/**
 * Persist profile picture by user (JWT sub) so it survives logout and re-login.
 */

const PROFILE_PICTURE_KEY_PREFIX = "cray_profile_picture_";

function getSubFromToken(token: string): string | null {
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    ) as { sub?: string };
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

export function getStoredProfilePicture(auth: {
  AccessToken?: string;
  accessToken?: string;
}): string | null {
  if (typeof window === "undefined") return null;
  const token = auth?.AccessToken ?? auth?.accessToken ?? "";
  const sub = getSubFromToken(token);
  if (!sub) return null;
  return localStorage.getItem(PROFILE_PICTURE_KEY_PREFIX + sub);
}

export function setStoredProfilePicture(
  auth: { AccessToken?: string; accessToken?: string },
  dataUrl: string
): void {
  if (typeof window === "undefined" || !dataUrl) return;
  const token = auth?.AccessToken ?? auth?.accessToken ?? "";
  const sub = getSubFromToken(token);
  if (!sub) return;
  localStorage.setItem(PROFILE_PICTURE_KEY_PREFIX + sub, dataUrl);
}
