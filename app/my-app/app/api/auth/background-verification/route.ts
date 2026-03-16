import { NextRequest, NextResponse } from "next/server";

interface BackgroundVerificationRequestBody {
  action?: string;
  page?: number;
  limit?: number;
  accessToken: string;
}

function getApiUrl(): string {
  const baseUrl =
    process.env.COGNITO_USER_SERVICE_URL ||
    process.env.NEXT_PUBLIC_COGNITO_USER_SERVICE_URL;
  const sendOtpUrl =
    process.env.AUTH_SEND_OTP_URL || process.env.NEXT_PUBLIC_AUTH_SEND_OTP_URL;
  return (
    baseUrl ||
    (sendOtpUrl
      ? sendOtpUrl.replace(/\/[^/]+$/, "/devCognitoUserService")
      : "")
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BackgroundVerificationRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const page =
      typeof body.page === "number" && Number.isFinite(body.page) && body.page > 0
        ? body.page
        : 1;
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
        ? body.limit
        : 5;

    if (!accessToken) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: { status: "error", message: "accessToken is required" },
        },
        { status: 400 }
      );
    }

    const apiUrl = getApiUrl();

    if (apiUrl) {
      const payload = {
        action: "getBackgroundVerification",
        page,
        limit,
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
          message: "Transaction list fetched successfully.",
          page,
          limit,
          totalCount: 0,
          totalPages: 0,
          data: [],
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Background verification list API error:", err);
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

