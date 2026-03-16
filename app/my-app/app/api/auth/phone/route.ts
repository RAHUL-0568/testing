import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/app/lib/encrypt";

/** Request body when submitting phone for OTP */
export interface PhoneRequestBody {
  phoneNumber: string;
  countryCode: string;
}

/** Response body (Cognito custom challenge) */
export interface PhoneResponseBody {
  status: string;
  message: string;
  session: string;
  challengeName: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PhoneRequestBody;
    const phoneNumber = String(body.phoneNumber ?? "").trim();
    const countryCode = String(body.countryCode ?? "").trim();
    if (!phoneNumber || !countryCode) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: {
            status: "error",
            message: "phoneNumber and countryCode are required",
            session: "",
            challengeName: "",
          },
        },
        { status: 400 }
      );
    }

    const realApiUrl =
      process.env.AUTH_SEND_OTP_URL || process.env.NEXT_PUBLIC_AUTH_SEND_OTP_URL;
    if (realApiUrl) {
      // Payload shape that matches your backend (encrypted phoneNumber, countryCode + authToken + device fields)
      const payload = {
        phoneNumber: encrypt(phoneNumber),
        countryCode: encrypt(countryCode),
        authToken: process.env.AUTH_TOKEN_FOR_SEND_OTP ?? "QTgTq2mmGrn5QIotKjc1Np8woDzges9J",
        appVersion: "1.38",
        deviceModel: "web",
        deviceToken: "web",
        osVersion: "1.0",
        deviceType: "web",
      };
      const proxyRes = await fetch(realApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await proxyRes.json().catch(() => ({}));
      return NextResponse.json(data, { status: proxyRes.status });
    }

    return NextResponse.json(
      {
        statusCode: 200,
        body: {
          status: "success",
          message: "OTP sent to user.",
          session: "MOCK_SESSION",
          challengeName: "CUSTOM_CHALLENGE",
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Send OTP error:", err);
    return NextResponse.json(
      {
        statusCode: 500,
        body: {
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
          session: "",
          challengeName: "",
        },
      },
      { status: 500 }
    );
  }
}
