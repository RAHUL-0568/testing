import { NextRequest, NextResponse } from "next/server";
import { decrypt, encrypt } from "@/app/lib/encrypt";

interface HomeReviewDetailsRequestBody {
  accessToken: string;
  action?: string;
  page?: number;
  limit?: number;
  phoneNumber: string;
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
    const body = (await request.json()) as HomeReviewDetailsRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const phoneNumber = String(body.phoneNumber ?? "").trim();
    const page =
      typeof body.page === "number" && Number.isFinite(body.page) && body.page > 0
        ? body.page
        : 1;
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
        ? body.limit
        : 10;
    const action = body.action || "getUserHomeReviewDetailsV1";

    if (!accessToken || !phoneNumber) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: {
            status: "error",
            message: "accessToken and phoneNumber are required",
          },
        },
        { status: 400 }
      );
    }

    const apiUrl = getApiUrl();

    if (apiUrl) {
      const encryptedPhone = phoneNumber ? encrypt(phoneNumber) : phoneNumber;
      const payload = {
        action,
        accessToken,
        phoneNumber: encryptedPhone,
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
        const decryptedData = resBody.data.map((item: any) => {
          const encPhone = typeof item.phoneNumber === "string" ? item.phoneNumber : "";
          const encFirst = typeof item.firstName === "string" ? item.firstName : "";
          const encLast = typeof item.lastName === "string" ? item.lastName : "";

          const plainPhone = encPhone ? decrypt(encPhone) ?? encPhone : "";
          const plainFirst = encFirst ? decrypt(encFirst) ?? encFirst : "";
          const plainLast = encLast ? decrypt(encLast) ?? encLast : "";

          const userInfoFirst =
            typeof item.userInfo?.firstName === "string"
              ? decrypt(item.userInfo.firstName) ?? item.userInfo.firstName
              : item.userInfo?.firstName;
          const userInfoLast =
            typeof item.userInfo?.lastName === "string"
              ? decrypt(item.userInfo.lastName) ?? item.userInfo.lastName
              : item.userInfo?.lastName;

          return {
            ...item,
            phoneNumber: plainPhone,
            firstName: plainFirst,
            lastName: plainLast,
            userInfo: item.userInfo
              ? {
                  ...item.userInfo,
                  firstName: userInfoFirst,
                  lastName: userInfoLast,
                }
              : item.userInfo,
          };
        });

        return NextResponse.json(
          {
            ...data,
            body: {
              ...resBody,
              data: decryptedData,
            },
          },
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
            "Home review details API URL not configured. Set COGNITO_USER_SERVICE_URL in .env.local to fetch details.",
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
    console.error("Home review details API error:", err);
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

