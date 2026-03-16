import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/app/lib/encrypt";

/** Verify OTP request body */
export interface VerifyOtpRequestBody {
  phoneNumber: string;
  countryCode: string;
  authToken: string;
  session: string;
  challengeName: string;
  otp: string;
  deviceType?: string;
  appVersion?: string;
  deviceModel?: string;
  deviceToken?: string;
  osVersion?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VerifyOtpRequestBody;
    const phoneNumber = String(body.phoneNumber ?? "").trim();
    const countryCode = String(body.countryCode ?? "").trim();
    const { session, otp } = body;
    if (!phoneNumber || !countryCode || !session || !otp || otp.length !== 4) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: {
            status: "error",
            message: "phoneNumber, countryCode, session, and 4-digit otp are required",
          },
        },
        { status: 400 }
      );
    }

    let realVerifyUrl =
      process.env.AUTH_VERIFY_OTP_URL || process.env.NEXT_PUBLIC_AUTH_VERIFY_OTP_URL;
    if (!realVerifyUrl) {
      const sendUrl =
        process.env.AUTH_SEND_OTP_URL || process.env.NEXT_PUBLIC_AUTH_SEND_OTP_URL;
      if (sendUrl) {
        realVerifyUrl = sendUrl;
      }
    }
    if (realVerifyUrl) {
      const authToken =
        body.authToken?.trim() || process.env.AUTH_TOKEN_FOR_SEND_OTP || "QTgTq2mmGrn5QIotKjc1Np8woDzges9J";
      if (!authToken) {
        console.warn("[Verify OTP] No authToken provided and AUTH_TOKEN_FOR_SEND_OTP not set");
      }
      const payload = {
        phoneNumber: encrypt(phoneNumber),
        countryCode: encrypt(countryCode),
        authToken,
        appVersion: body.appVersion || "1.38",
        deviceModel: body.deviceModel || "web",
        deviceToken: body.deviceToken || "web",
        osVersion: body.osVersion || "1.0",
        deviceType: body.deviceType || "web",
        session,
        challengeName: body.challengeName || "CUSTOM_CHALLENGE",
        otp,
      };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const apiKey = process.env.AUTH_API_KEY || process.env.API_GATEWAY_API_KEY;
      if (apiKey) headers["x-api-key"] = apiKey;

      console.log("[Verify OTP] Calling:", realVerifyUrl);
      const proxyRes = await fetch(realVerifyUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const raw = await proxyRes.text();
      const data = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
      if (!proxyRes.ok) {
        const msg =
          (data as { body?: { message?: string }; message?: string })?.body?.message
            ?? (data as { message?: string })?.message
            ?? raw.slice(0, 300);
        console.error("[Verify OTP] Backend returned", proxyRes.status, "—", msg);
        if (String(msg).toLowerCase().includes("missing authentication token")) {
          console.error(
            "[Verify OTP] Wrong URL path. Set AUTH_VERIFY_OTP_URL in .env.local to the exact verify endpoint from API Gateway."
          );
        }
      }
      return NextResponse.json(data, { status: proxyRes.status });
    }

    return NextResponse.json(
      {
        statusCode: 401,
        body: {
          status: "error",
          message: "Set AUTH_VERIFY_OTP_URL in .env.local to use your verify API.",
        },
      },
      { status: 401 }
    );
  } catch (err) {
    console.error("Verify OTP error:", err);
    return NextResponse.json(
      {
        statusCode: 400,
        body: { status: "error", message: "Invalid request" },
      },
      { status: 400 }
    );
  }
}
