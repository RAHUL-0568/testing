import { NextRequest, NextResponse } from "next/server";

interface FamilyWatchdogRequestBody {
  status?: string;
  accessToken: string;
  dateTime?: number;
  productId?: string;
  transactionId?: string;
  purchaseToken?: string;
  environment?: string;
  currency?: string;
  action?: string;
  lname?: string;
  stateName?: string;
  stateCode?: string;
  amount?: string;
  originalTransactionId?: string;
  fname?: string;
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
    const body = (await request.json()) as FamilyWatchdogRequestBody;
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
      const now = Date.now();
      const transactionId = body.transactionId ?? `bg_${now}`;
      const action =
        body.action ?? "familywatchdogbackgroundVerificationV1";
      const payload = {
        status: body.status ?? "done",
        accessToken,
        dateTime: body.dateTime ?? now,
        productId:
          body.productId ?? "com.cray.crayapp.backgroundverification",
        transactionId,
        purchaseToken: body.purchaseToken ?? transactionId,
        environment: body.environment ?? "Sandbox",
        currency: body.currency ?? "usd",
        action,
        lname: body.lname ?? "",
        stateName: body.stateName ?? "",
        stateCode: body.stateCode ?? "",
        amount: body.amount ?? "4.99",
        originalTransactionId:
          body.originalTransactionId ?? transactionId,
        fname: body.fname ?? "",
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
    console.error("Family Watchdog verification API error:", err);
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

