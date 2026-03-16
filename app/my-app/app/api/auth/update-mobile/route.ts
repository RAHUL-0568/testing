import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/app/lib/encrypt";

/** Request body for update mobile (send OTP to new number) */
export interface UpdateMobileRequestBody {
  accessToken: string;
  newPhone: string;
  countryCode: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateMobileRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const newPhone = String(body.newPhone ?? "").trim();
    const countryCode = String(body.countryCode ?? "").trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: { status: "error", message: "accessToken is required" },
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
        action: "updateMobile",
        newPhone: encrypt(newPhone),
        countryCode: encrypt(countryCode),
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
          message: "OTP sent to the new phone number.",
          data: {
            session: "MOCK_SESSION_UPDATE_MOBILE",
            challengeName: "CUSTOM_CHALLENGE",
            formattedPhone: `${countryCode}${newPhone}`,
          },
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Update mobile error:", err);
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
