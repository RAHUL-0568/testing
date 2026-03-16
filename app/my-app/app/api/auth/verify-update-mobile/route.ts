import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/app/lib/encrypt";

/** Request body for verify update mobile OTP */
export interface VerifyUpdateMobileRequestBody {
  accessToken: string;
  session: string;
  challengeName?: string;
  newPhone: string;
  countryCode: string;
  otp: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VerifyUpdateMobileRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const session = String(body.session ?? "").trim();
    const newPhone = String(body.newPhone ?? "").trim();
    const countryCode = String(body.countryCode ?? "").trim();
    const otp = String(body.otp ?? "").trim();
    const challengeName = String(body.challengeName ?? "CUSTOM_CHALLENGE").trim();

    if (!accessToken || !session || !otp || otp.length !== 4) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: { status: "error", message: "accessToken, session, and 4-digit otp are required" },
        },
        { status: 400 }
      );
    }
    if (!newPhone || !countryCode) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: { status: "error", message: "newPhone and countryCode are required" },
        },
        { status: 400 }
      );
    }

    const baseUrl =
      process.env.COGNITO_USER_SERVICE_URL ||
      process.env.NEXT_PUBLIC_COGNITO_USER_SERVICE_URL;
    const sendOtpUrl =
      process.env.AUTH_SEND_OTP_URL || process.env.NEXT_PUBLIC_AUTH_SEND_OTP_URL;
    const apiUrl =
      baseUrl ||
      (sendOtpUrl
        ? sendOtpUrl.replace(/\/[^/]+$/, "/devCognitoUserService")
        : "");

    if (apiUrl) {
      const payload = {
        action: "verifyUpdateMobileOTP",
        session,
        challengeName,
        newPhone: encrypt(newPhone),
        countryCode: encrypt(countryCode),
        otp,
        accessToken,
      };
      const proxyRes = await fetch(apiUrl, {
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
          message: "Phone number updated successfully.",
          data: { accessToken: body.accessToken },
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Verify update mobile error:", err);
    return NextResponse.json(
      {
        statusCode: 500,
        body: {
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        },
      },
      { status: 500 }
    );
  }
}
