import { NextRequest, NextResponse } from "next/server";

export interface HelpRequestBody {
  accessToken: string;
  title: string;
  description: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HelpRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();

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
        action: "help",
        accessToken,
        title: title || "help",
        description: description || "",
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
        body: { status: "success", message: "Send successfully." },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Help request error:", err);
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
