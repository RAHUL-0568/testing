import mixpanel from "mixpanel-browser";

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "web";

let initialized = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  if (!MIXPANEL_TOKEN || MIXPANEL_TOKEN === "your_actual_token") {
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      console.warn(
        "[Mixpanel] Token missing or placeholder. Add NEXT_PUBLIC_MIXPANEL_TOKEN to .env.local and restart the dev server."
      );
    }
    return;
  }
  mixpanel.init(MIXPANEL_TOKEN, {
    api_host: "https://api.mixpanel.com",
  });
  initialized = true;
}

function getBaseProps(auth?: {
  user?: {
    id?: string;
    userId?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    countryCode?: string;
    countryFlag?: string;
  };
}) {
  const user = auth?.user ?? {};
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined;

  return {
    platform: "Web",
    device_type: "Browser",
    device_name:
      typeof navigator !== "undefined" ? navigator.userAgent ?? "unknown" : "unknown",
    app_version: APP_VERSION,
    os_version:
      typeof navigator !== "undefined" ? navigator.userAgent ?? "unknown" : "unknown",
    country_code: user.countryCode,
    country_flag: user.countryFlag,
    phone_number: user.phone,
    user_id: user.id ?? user.userId,
    full_name: fullName,
  };
}

export function trackEvent(
  eventName: string,
  props: Record<string, unknown> = {},
  auth?: { user?: unknown }
) {
  if (typeof window === "undefined") return;
  ensureInit();
  if (!initialized) return;
  const base = getBaseProps(auth as any);
  const payload = { ...base, ...props };
  mixpanel.track(eventName, payload);
  if (process.env.NODE_ENV === "development") {
    console.log("[Mixpanel] track:", eventName, payload);
  }
}

export function identifyUser(auth?: {
  user?: {
    id?: string;
    userId?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    countryCode?: string;
    countryFlag?: string;
  };
}) {
  if (typeof window === "undefined") return;
  ensureInit();
  if (!initialized) return;
  const user = auth?.user ?? {};
  const userId = (user.id ?? user.userId) as string | undefined;
  if (!userId) return;
  mixpanel.identify(userId);
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined;
  mixpanel.people.set({
    full_name: fullName,
    phone_number: user.phone,
    country_code: user.countryCode,
    country_flag: user.countryFlag,
  });
}

