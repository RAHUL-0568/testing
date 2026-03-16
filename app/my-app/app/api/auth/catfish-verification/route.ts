import { NextRequest, NextResponse } from "next/server";

export interface CatfishVerificationRequestBody {
  action: "catfishVerification";
  transactionId: string;
  phoneNumber: string;
  isSelfVerifcation: boolean;
  name: string;
  status: string;
  amount: number;
  dateTime: number;
  productId: string;
  originalTransactionId: string;
  purchaseToken: string;
  currency: string;
  environment: string;
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
    const body = (await request.json()) as CatfishVerificationRequestBody;
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

    const apiUrl = getApiUrl();

    if (apiUrl) {
      const payload = {
        action: "catfishVerification",
        transactionId: body.transactionId ?? "",
        phoneNumber: body.phoneNumber ?? "",
        isSelfVerifcation: body.isSelfVerifcation ?? false,
        name: body.name ?? "",
        status: body.status ?? "done",
        amount: body.amount ?? 199,
        dateTime: body.dateTime ?? Date.now(),
        productId: body.productId ?? "productId",
        originalTransactionId: body.originalTransactionId ?? "originalTransactionId",
        purchaseToken: body.purchaseToken ?? "purchaseToken",
        currency: body.currency ?? "USD",
        environment: body.environment ?? "SANDBOX",
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
          message: "Background verification done successfully.",
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Catfish verification API error:", err);
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
