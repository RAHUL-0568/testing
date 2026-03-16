import { NextRequest, NextResponse } from "next/server";

/** Request body for logout */
export interface LogoutRequestBody {
  accessToken: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LogoutRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: { status: "error", message: "accessToken is required" },
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
        action: "logoutUser",
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
          message: "User logged out successfully.",
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Logout error:", err);
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
