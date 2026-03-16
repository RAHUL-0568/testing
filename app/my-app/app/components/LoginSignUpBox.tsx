"use client";

import { useState } from "react";
import { normalizePhoneWithCountry } from "../lib/phone";

export interface LoginSignUpFormData {
  countryCode: string;
  phoneNumber: string;
  consent: boolean;
}

/** API response body when OTP is sent (Cognito custom challenge) */
export interface SendOtpResponseBody {
  status: string;
  message: string;
  session: string;
  challengeName: string;
  /** Set by local mock: no SMS was sent */
  demoMode?: boolean;
}

/** Full API response when you submit phone and continue */
export interface SendOtpApiResponse {
  statusCode: number;
  body: SendOtpResponseBody;
}

const DEFAULT_COUNTRY = { code: "+1", flag: "🇺🇸", label: "United States" };

const COUNTRY_OPTIONS = [
  { code: "+1", flag: "🇺🇸", label: "United States" },
  { code: "+44", flag: "🇬🇧", label: "United Kingdom" },
  { code: "+91", flag: "🇮🇳", label: "India" },
  { code: "+49", flag: "🇩🇪", label: "Germany" },
  { code: "+33", flag: "🇫🇷", label: "France" },
  { code: "+81", flag: "🇯🇵", label: "Japan" },
  { code: "+86", flag: "🇨🇳", label: "China" },
  { code: "+61", flag: "🇦🇺", label: "Australia" },
];

const SESSION_STORAGE_KEY = "cray_session";
const AUTH_TOKEN_KEY = "cray_auth_token";

export interface OtpSentData {
  session: string;
  phoneNumber: string;
  countryCode: string;
  challengeName: string;
  authToken?: string;
}

export interface LoginSignUpBoxProps {
  onOtpSent?: (data: OtpSentData) => void;
}

export default function LoginSignUpBox({ onOtpSent }: LoginSignUpBoxProps) {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiResponse, setApiResponse] = useState<SendOtpResponseBody | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) return;
    setError(null);

    // Validate phone number for the selected country using libphonenumber-js.
    const normalized = normalizePhoneWithCountry(phoneNumber, country.code);
    if (!normalized) {
      setError("Please enter a valid phone number for the selected country.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: LoginSignUpFormData = {
        countryCode: country.code,
        // Keep sending the original trimmed number so backend contract stays the same.
        phoneNumber: phoneNumber.trim(),
        consent,
      };
      // Always call our API route (avoids CORS). Server proxies to real API when env is set.
      const res = await fetch("/api/auth/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: payload.phoneNumber,
          countryCode: payload.countryCode,
        }),
      });
      const data = (await res.json()) as SendOtpApiResponse;
      const body = data?.body;
      if (res.ok && data.statusCode === 200 && body?.status === "success") {
        const bodyWithDemo = body as SendOtpResponseBody & { demoMode?: boolean };
        setApiResponse({ ...body, demoMode: bodyWithDemo.demoMode ?? false });
        if (typeof window !== "undefined") {
          if (body.session) localStorage.setItem(SESSION_STORAGE_KEY, body.session);
          const token = (body as SendOtpResponseBody & { authToken?: string }).authToken;
          if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
        }
        onOtpSent?.({
          session: body.session,
          phoneNumber: payload.phoneNumber,
          countryCode: payload.countryCode,
          challengeName: body.challengeName ?? "CUSTOM_CHALLENGE",
          authToken: (body as SendOtpResponseBody & { authToken?: string }).authToken,
        });
      } else {
        const msg = body?.message ?? (data as { message?: string }).message ?? `Request failed (${data?.statusCode ?? res.status})`;
        setError(msg);
        onOtpSent?.({
          session: "",
          phoneNumber: payload.phoneNumber,
          countryCode: payload.countryCode,
          challengeName: "CUSTOM_CHALLENGE",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      onOtpSent?.({
        session: "",
        phoneNumber: phoneNumber.trim(),
        countryCode: country.code,
        challengeName: "CUSTOM_CHALLENGE",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] rounded-2xl border-2 border-red-500 bg-white p-8 shadow-lg">
      {/* Logo area - replace with your logo image */}
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">
          🦊
        </div>
        <span className="text-xl font-bold tracking-tight text-red-600 outline-1 outline-red-400 [-webkit-text-stroke:1px_rgba(255,255,255,0.8)]">
          CRAY
        </span>
      </div>

      <h1 className="mb-1 text-center text-2xl font-bold text-black">
        Login & Sign Up
      </h1>
      <p className="mb-6 text-center text-sm text-gray-500">
        We&apos;ll need your phone number to send an OTP for verification.
      </p>

      {apiResponse ? (
        <div className="flex flex-col gap-4 text-center">
          <p className="text-lg font-semibold text-green-700">OTP sent</p>
          <p className="text-sm text-gray-600">{apiResponse.message}</p>
          {apiResponse.demoMode && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-800">
              <p className="font-semibold">No SMS was sent (demo mode)</p>
              <p className="mt-1">
                To receive OTP on your phone, set your real API in <code className="rounded bg-amber-100 px-1">.env.local</code> and restart:
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">
                NEXT_PUBLIC_AUTH_SEND_OTP_URL=https://your-api.com/send-otp
              </pre>
            </div>
          )}
          <p className="text-xs text-gray-400">
            Session stored for verification. Challenge: {apiResponse.challengeName}
          </p>
          <button
            type="button"
            onClick={() =>
              onOtpSent?.({
                session: apiResponse.session,
                phoneNumber,
                countryCode: country.code,
                challengeName: apiResponse.challengeName ?? "CUSTOM_CHALLENGE",
                authToken: (apiResponse as SendOtpResponseBody & { authToken?: string }).authToken,
              })
            }
            className="mt-2 h-12 w-full rounded-xl bg-red-600 font-bold text-white transition hover:bg-red-700"
          >
            Enter verification code
          </button>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div>
          <label
            htmlFor="phone"
            className="mb-2 block text-sm font-bold text-black"
          >
            Phone Number
          </label>
          <div className="flex gap-2">
            <select
              value={country.code}
              onChange={(e) => {
                const opt = COUNTRY_OPTIONS.find((o) => o.code === e.target.value);
                if (opt) setCountry(opt);
              }}
              className="flex h-12 w-24 shrink-0 appearance-none rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              aria-label="Country code"
            >
              {COUNTRY_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.flag} {opt.code}
                </option>
              ))}
            </select>
            <input
              id="phone"
              type="tel"
              placeholder="Phone Number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="h-12 flex-1 rounded-xl border border-gray-300 px-4 text-black placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              required
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-red-600 focus:ring-red-500"
            required
          />
          <span className="text-sm text-gray-700">
            I consent to the Cray App{" "}
            <a
              href="/privacy"
              className="font-semibold text-red-600 underline hover:text-red-700"
            >
              Privacy Policy
            </a>{" "}
            and{" "}
            <a
              href="/terms"
              className="font-semibold text-red-600 underline hover:text-red-700"
            >
              Terms & Condition
            </a>
            .
          </span>
        </label>

        <button
          type="submit"
          disabled={isSubmitting || !consent}
          className="mt-2 h-12 w-full rounded-xl bg-red-600 font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "Sending…" : "Continue"}
        </button>
      </form>
      )}
    </div>
  );
}
