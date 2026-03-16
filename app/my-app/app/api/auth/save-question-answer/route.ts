import { NextRequest, NextResponse } from "next/server";

export interface SaveQuestionAnswerRequestBody {
  action: string;
  accessToken: string;
  reviewId: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  progress: number;
  score: number;
  position: number;
  reviewed: boolean;
  questionArray: string;
  blockerAnsCount: number;
  blockerQuestionCount: number;
  dateTime: number;
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
    const body = (await request.json()) as SaveQuestionAnswerRequestBody;
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
        action: "saveQuestionAnswer",
        accessToken,
        reviewId: body.reviewId ?? "",
        phoneNumber: body.phoneNumber ?? "",
        firstName: body.firstName ?? "",
        lastName: body.lastName ?? "",
        progress: body.progress ?? 0,
        score: body.score ?? 0,
        position: body.position ?? 0,
        reviewed: body.reviewed ?? true,
        questionArray: body.questionArray ?? "",
        blockerAnsCount: body.blockerAnsCount ?? 0,
        blockerQuestionCount: body.blockerQuestionCount ?? 0,
        dateTime: body.dateTime ?? Date.now(),
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
          message: "Question answer saved successfully.",
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Save question answer API error:", err);
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
