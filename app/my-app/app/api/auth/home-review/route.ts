import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/app/lib/encrypt";

interface HomeReviewRequestBody {
  accessToken: string;
  action?: string;
  page?: number;
  limit?: number;
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
    const body = (await request.json()) as HomeReviewRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const page =
      typeof body.page === "number" && Number.isFinite(body.page) && body.page > 0
        ? body.page
        : 1;
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
        ? body.limit
        : 10;

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
        action: "getUserHomeReview",
        accessToken,
        page,
        limit,
      };
      const proxyRes = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await proxyRes.json().catch(() => ({}));
      const resBody = data?.body ?? data;
      if (
        resBody?.status === "success" &&
        Array.isArray(resBody.data) &&
        resBody.data.length > 0
      ) {
        const decrypted = resBody.data.map((item: Record<string, unknown>) => {
          const first = typeof item.firstName === "string" ? item.firstName.trim() : "";
          const last = typeof item.lastName === "string" ? item.lastName.trim() : "";
          const phone = typeof item.phoneNumber === "string" ? item.phoneNumber : (item.phoneNumber as string | undefined);
          return {
            ...item,
            firstName: first ? (decrypt(first) ?? first) : "",
            lastName: last ? (decrypt(last) ?? last) : "",
            phoneNumber: phone ?? "",
          };
        });
        return NextResponse.json(
          { ...data, body: { ...resBody, data: decrypted } },
          { status: proxyRes.status }
        );
      }
      return NextResponse.json(data, { status: proxyRes.status });
    }

    return NextResponse.json(
      {
        statusCode: 200,
        body: {
          status: "success",
          message:
            "Home review API URL not configured. Set COGNITO_USER_SERVICE_URL in .env.local to fetch reviews.",
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
          data: [],
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Home review API error:", err);
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

