"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Verify OTP request payload */
export interface VerifyOtpPayload {
  phoneNumber: string;
  countryCode: string;
  authToken: string;
  session: string;
  challengeName: string;
  otp: string;
  deviceType: string;
  appVersion: string;
  deviceModel: string;
  deviceToken: string;
  osVersion: string;
}

/** Auth tokens in verify response */
export interface AuthTokens {
  AccessToken: string;
  ExpiresIn: number;
  IdToken: string;
  RefreshToken: string;
  TokenType: string;
}

/** User in verify response */
export interface AuthUser {
  firstName: string;
  lastName: string;
  picture: string;
}

/** Verify API response body */
export interface VerifyResponseBody {
  status: string;
  message: string;
  data?: {
    auth: AuthTokens;
    user: AuthUser;
  };
}

export interface VerifyApiResponse {
  statusCode: number;
  body: VerifyResponseBody;
}

const SESSION_STORAGE_KEY = "cray_session";
const AUTH_TOKEN_KEY = "cray_auth_token";
const RESEND_COOLDOWN_SEC = 60;

export interface VerificationCodeBoxProps {
  phoneNumber: string;
  countryCode: string;
  session: string;
  challengeName?: string;
  authToken?: string;
  onVerified?: (data: VerifyResponseBody["data"]) => void;
  onResend?: () => Promise<void>;
  onBack?: () => void;
}

export default function VerificationCodeBox({
  phoneNumber,
  countryCode,
  session,
  challengeName = "CUSTOM_CHALLENGE",
  authToken: authTokenProp,
  onVerified,
  onResend,
  onBack,
}: VerificationCodeBoxProps) {
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(session ? RESEND_COOLDOWN_SEC : 0);
  const [verifySuccess, setVerifySuccess] = useState<VerifyResponseBody["data"] | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasSession = Boolean(session);

  useEffect(() => {
    if (!session) setResendSeconds(0);
  }, [session]);

  const authToken =
    authTokenProp ??
    (typeof window !== "undefined" ? localStorage.getItem(AUTH_TOKEN_KEY) : null) ??
    "";

  const otp = digits.join("");

  const focusInput = useCallback((index: number) => {
    inputRefs.current[index]?.focus();
  }, []);

  const handleDigitChange = (index: number, value: string) => {
    if (value.length > 1) {
      const chars = value.replace(/\D/g, "").slice(0, 4).split("");
      const next = [...digits];
      chars.forEach((c, i) => {
        if (index + i < 4) next[index + i] = c;
      });
      setDigits(next);
      const nextEmpty = next.findIndex((d) => !d);
      focusInput(nextEmpty === -1 ? 3 : nextEmpty);
      return;
    }
    const char = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < 3) focusInput(index + 1);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      focusInput(index - 1);
      const next = [...digits];
      next[index - 1] = "";
      setDigits(next);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    const next = pasted.split("").concat(Array(4).fill("")).slice(0, 4);
    setDigits(next);
    focusInput(Math.min(pasted.length, 3));
  };

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const t = setInterval(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [resendSeconds]);

  const handleResend = async () => {
    if (resendSeconds > 0) return;
    setError(null);
    try {
      await onResend?.();
      setResendSeconds(RESEND_COOLDOWN_SEC);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resend failed");
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 4) return;
    setError(null);
    setIsSubmitting(true);
    try {
      // Always call our API route; server proxies to real verify API when env is set.
      const payload: VerifyOtpPayload = {
        phoneNumber,
        countryCode,
        authToken,
        session,
        challengeName,
        otp,
        deviceType: "web",
        appVersion: "1.38",
        deviceModel: "web",
        deviceToken: "web",
        osVersion: "1.0",
      };
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as VerifyApiResponse;
      const body = data?.body;
      if (res.ok && data.statusCode === 200 && body?.status === "success" && body?.data) {
        setVerifySuccess(body.data);
        if (typeof window !== "undefined" && body.data.auth) {
          localStorage.setItem("cray_access_token", body.data.auth.AccessToken);
          localStorage.setItem("cray_id_token", body.data.auth.IdToken);
          localStorage.setItem("cray_refresh_token", body.data.auth.RefreshToken);
        }
        onVerified?.(body.data);
      } else {
        throw new Error(body?.message ?? `Verification failed (${data?.statusCode ?? res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (verifySuccess) {
    return (
      <div className="w-full max-w-[420px] rounded-2xl border-2 border-red-500 bg-white p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">🦊</div>
          <span className="text-xl font-bold tracking-tight text-red-600 [-webkit-text-stroke:1px_rgba(255,255,255,0.8)]">CRAY</span>
        </div>
        <p className="text-center text-lg font-semibold text-green-700">Logged in successfully</p>
        <p className="mt-2 text-center text-sm text-gray-600">
          Welcome, {verifySuccess.user?.firstName} {verifySuccess.user?.lastName}.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[420px] rounded-2xl border-2 border-red-500 bg-white p-8 shadow-lg">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>
      )}
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">🦊</div>
        <span className="text-xl font-bold tracking-tight text-red-600 [-webkit-text-stroke:1px_rgba(255,255,255,0.8)]">CRAY</span>
      </div>

      <h1 className="mb-1 text-center text-2xl font-bold text-black">Verification Code</h1>
      <p className="mb-6 text-center text-sm text-gray-500">
        A secure 4-digit code has been sent to your mobile{" "}
        <span className="font-medium text-gray-700">
          +{String(countryCode).replace(/\D/g, "")}{String(phoneNumber).replace(/\D/g, "")}
        </span>
      </p>

      {!hasSession && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-800">
          OTP could not be sent. Tap <strong>Resend Code</strong> to try again.
        </div>
      )}

      <form onSubmit={handleVerify} className="flex flex-col gap-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="flex justify-center gap-2">
          {[0, 1, 2, 3].map((i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={digits[i]}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              className="h-14 w-14 rounded-xl border border-gray-300 text-center text-xl font-semibold text-black focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500"
              aria-label={`Digit ${i + 1}`}
            />
          ))}
        </div>

        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="tabular-nums text-blue-600">
            {String(Math.floor(resendSeconds / 60)).padStart(2, "0")}:{String(resendSeconds % 60).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendSeconds > 0}
            className="font-medium text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline"
          >
            Resend Code
          </button>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || otp.length !== 4 || !hasSession}
          className="mt-2 h-12 w-full rounded-xl bg-red-600 font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "Verifying…" : "Verify"}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-gray-400">
        Didn&apos;t receive the code? Check SMS for {countryCode} {phoneNumber} or try Resend after the timer.
      </p>
    </div>
  );
}
