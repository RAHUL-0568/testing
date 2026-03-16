import { NextRequest, NextResponse } from "next/server";

export interface QuestionsRequestBody {
  accessToken: string;
  action?: string;
  connectionType?: "inPerson" | "online";
}

/** Get Question new API – used when no env URL is set (no manual questions, always fetch from API). */
const DEFAULT_GET_QUESTION_NEW_API_URL = "https://getquestionnew.com/questions";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as QuestionsRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const connectionType = body.connectionType ?? "online";

    if (!accessToken) {
      return NextResponse.json(
        {
          statusCode: 400,
          body: { status: "error", message: "accessToken is required" },
        },
        { status: 400 }
      );
    }

    const sendOtpUrl =
      process.env.AUTH_SEND_OTP_URL || process.env.NEXT_PUBLIC_AUTH_SEND_OTP_URL;
    const apiUrl =
      process.env.GET_QUESTION_NEW_API_URL ||
      process.env.NEXT_PUBLIC_GET_QUESTION_NEW_API_URL ||
      process.env.COGNITO_USER_SERVICE_URL ||
      process.env.NEXT_PUBLIC_COGNITO_USER_SERVICE_URL ||
      (sendOtpUrl
        ? sendOtpUrl.replace(/\/[^/]+$/, "/devCognitoUserService")
        : "") ||
      DEFAULT_GET_QUESTION_NEW_API_URL;

    if (apiUrl) {
      const payload = { accessToken, action: "getQuestionsV3", connectionType };
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
          message: "Question listing.",
          result: [],
          schemerResult: [],
          totalPoints: 0,
          blockerQuestionCount: 0,
          schemerTotalPoints: 0,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Questions API error:", err);
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
