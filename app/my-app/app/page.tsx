"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import LoginSignUpBox, { type OtpSentData } from "./components/LoginSignUpBox";
import VerificationCodeBox from "./components/VerificationCodeBox";
import ProfileSetup from "./components/ProfileSetup";
import type { VerifyResponseBody } from "./components/VerificationCodeBox";
import { getStoredProfilePicture } from "./lib/profilePicture";
import { identifyUser, trackEvent } from "./lib/analytics";

type AuthData = NonNullable<VerifyResponseBody["data"]>;

const AUTH_STORAGE_KEY = "cray_auth_data";
const BOOT_ID_KEY = "cray_boot_id";
const PROFILE_COMPLETE_KEY = "cray_profile_complete";
const OTP_SENT_STORAGE_KEY = "cray_otp_sent_data";

export default function Home() {
  const router = useRouter();
  const [otpSentData, setOtpSentData] = useState<OtpSentData | null>(null);
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // On server restart: clear session so flow is login → verify → profile. Same server: restore Profile Setup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/boot");
        const { bootId } = (await res.json()) as { bootId?: string };
        const savedBootId = sessionStorage.getItem(BOOT_ID_KEY);
        if (bootId && savedBootId && bootId !== savedBootId) {
          localStorage.removeItem(AUTH_STORAGE_KEY);
          localStorage.removeItem(PROFILE_COMPLETE_KEY);
          sessionStorage.removeItem(OTP_SENT_STORAGE_KEY);
        }
        if (bootId) sessionStorage.setItem(BOOT_ID_KEY, bootId);
        if (cancelled) return;
        const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
        if (savedAuth) {
          const parsed = JSON.parse(savedAuth) as AuthData;
          if (parsed?.user) {
            setAuthData(parsed);
            if (localStorage.getItem(PROFILE_COMPLETE_KEY) === "true") {
              router.replace("/home");
              return;
            }
          }
        }
        if (!savedAuth) {
          const savedOtp = sessionStorage.getItem(OTP_SENT_STORAGE_KEY);
          if (savedOtp) {
            try {
              const parsed = JSON.parse(savedOtp) as OtpSentData;
              if (parsed?.session) setOtpSentData(parsed);
            } catch {}
          }
        }
      } catch {
        const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
        if (savedAuth) {
          try {
            const parsed = JSON.parse(savedAuth) as AuthData;
            if (parsed?.user) {
              setAuthData(parsed);
              if (localStorage.getItem(PROFILE_COMPLETE_KEY) === "true") {
                router.replace("/home");
                return;
              }
            }
          } catch {}
        }
        if (!savedAuth) {
          const savedOtp = sessionStorage.getItem(OTP_SENT_STORAGE_KEY);
          if (savedOtp) {
            try {
              const parsed = JSON.parse(savedOtp) as OtpSentData;
              if (parsed?.session) setOtpSentData(parsed);
            } catch {}
          }
        }
      }
      if (!cancelled) setHasRestoredSession(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Page Viewed for auth flow screens
  useEffect(() => {
    if (!hasRestoredSession) return;
    const screenName = authData
      ? "Profile Setup Screen"
      : otpSentData
        ? "Verification Screen"
        : "Login Screen";
    trackEvent("Page Viewed", { screen_name: screenName }, authData ?? undefined);
  }, [hasRestoredSession, !!authData, !!otpSentData]);

  const handleAuthData = useCallback((data: AuthData | null | undefined) => {
    let value = data ?? null;
    if (value?.user && !value.user.picture) {
      const stored = getStoredProfilePicture(value.auth);
      if (stored) value = { ...value, user: { ...value.user, picture: stored } };
    }
    if (value) {
      identifyUser(value as any);
      const hasProfile = Boolean(
        (value.user?.firstName ?? "").trim() || (value.user?.lastName ?? "").trim()
      );
      if (hasProfile) {
        trackEvent("Logged In", {}, value as any);
        localStorage.setItem(PROFILE_COMPLETE_KEY, "true");
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
        sessionStorage.removeItem(OTP_SENT_STORAGE_KEY);
        router.replace("/home");
        return;
      }
      trackEvent("Account Created", {}, value as any);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
      sessionStorage.removeItem(OTP_SENT_STORAGE_KEY);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    setAuthData(value);
  }, [router]);

  const handleOtpSent = useCallback((data: OtpSentData | null) => {
    setOtpSentData(data);
    if (data?.session) sessionStorage.setItem(OTP_SENT_STORAGE_KEY, JSON.stringify(data));
    else sessionStorage.removeItem(OTP_SENT_STORAGE_KEY);
  }, []);

  const handleBackToLogin = useCallback(() => {
    setOtpSentData(null);
    sessionStorage.removeItem(OTP_SENT_STORAGE_KEY);
  }, []);

  const handleResend = useCallback(async () => {
    if (!otpSentData) return;
    const res = await fetch("/api/auth/resend-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: otpSentData.phoneNumber,
        countryCode: otpSentData.countryCode,
      }),
    });
    const data = await res.json();
    const body = data?.body;
    if (!res.ok || data?.statusCode !== 200 || body?.status !== "success") {
      throw new Error(body?.message ?? "Resend failed");
    }
    trackEvent("Resent Verification Code", {
      country_code: otpSentData.countryCode,
      phone_number: otpSentData.phoneNumber,
    });
    const next = otpSentData
      ? { ...otpSentData, session: body.session, challengeName: body.challengeName ?? otpSentData.challengeName }
      : null;
    setOtpSentData(next);
    if (next?.session) sessionStorage.setItem(OTP_SENT_STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined" && body.session) {
      localStorage.setItem("cray_session", body.session);
    }
  }, [otpSentData]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 px-6 py-4">
        <span className="font-semibold text-gray-800">Cray App</span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative flex flex-1 flex-col justify-center bg-gradient-to-br from-pink-500 via-red-500 to-red-600 px-8 py-12 md:px-12">
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `repeating-linear-gradient(
                45deg,
                transparent,
                transparent 12px,
                rgba(255,255,255,0.08) 12px,
                rgba(255,255,255,0.08) 24px
              )`,
            }}
          />
          <div className="relative text-white">
            <p className="text-5xl font-bold md:text-6xl">70+</p>
            <p className="mt-1 text-4xl font-bold md:text-5xl">Red Flags</p>
            <p className="mt-6 max-w-sm text-lg opacity-95">
              Private dating for red flags. Navigate every situation with
              categories.
            </p>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center bg-gray-50 px-6 py-12 md:px-12">
          {!hasRestoredSession ? null : authData ? (
            <ProfileSetup
              isSubmitting={isUpdating}
              error={updateError}
              onComplete={async (data) => {
                setUpdateError(null);
                setIsUpdating(true);
                try {
                  const accessToken = authData.auth.AccessToken;
                  const selectedPicture =
                    typeof data.picture === "string" && data.picture.startsWith("data:")
                      ? data.picture
                      : "";
                  const res = await fetch("/api/auth/update-user", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      accessToken,
                      firstName: data.firstName,
                      lastName: data.lastName,
                      // Backend expects empty picture for this call.
                      picture: "",
                    }),
                  });
                  const result = await res.json();
                  const body = result?.body;
                  if (!res.ok || result?.statusCode !== 200 || body?.status !== "success") {
                    throw new Error(body?.message ?? "Update failed");
                  }
                  const updatedAuth: AuthData = {
                    ...authData,
                    user: {
                      ...authData.user,
                      firstName: data.firstName,
                      lastName: data.lastName,
                      picture: selectedPicture || (authData.user.picture ?? ""),
                    },
                  };
                  setAuthData(updatedAuth);
                  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedAuth));
                  localStorage.setItem(PROFILE_COMPLETE_KEY, "true");
                  trackEvent(
                    "Profile Created",
                    { is_picture_uploaded: Boolean(selectedPicture) },
                    updatedAuth as any
                  );
                  router.push("/home");
                } catch (err) {
                  setUpdateError(err instanceof Error ? err.message : "Update failed");
                } finally {
                  setIsUpdating(false);
                }
              }}
            />
          ) : otpSentData ? (
            <VerificationCodeBox
              phoneNumber={otpSentData.phoneNumber}
              countryCode={otpSentData.countryCode}
              session={otpSentData.session}
              challengeName={otpSentData.challengeName}
              authToken={otpSentData.authToken}
              onResend={handleResend}
              onVerified={handleAuthData}
              onBack={handleBackToLogin}
            />
          ) : (
            <LoginSignUpBox onOtpSent={handleOtpSent} />
          )}
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 px-6 py-4 text-sm text-gray-500">
        <button type="button" className="hover:underline">
          Manage cookies or opt out
        </button>
        <span>© Copyright 2026</span>
      </footer>
    </div>
  );
}
