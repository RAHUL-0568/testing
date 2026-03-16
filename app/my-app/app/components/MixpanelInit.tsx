"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "../lib/analytics";

/** Fires App Launched once per session when the app loads in the browser. */
export default function MixpanelInit() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || typeof window === "undefined") return;
    fired.current = true;
    trackEvent("App Launched", {
      screen_name: "Welcome Screen",
      platform: "Web",
      device_type: "Browser",
      device_name: navigator.userAgent ?? "unknown",
      app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "web",
      os_version: navigator.userAgent ?? "unknown",
    });
  }, []);
  return null;
}
