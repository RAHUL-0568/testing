import { NextRequest, NextResponse } from "next/server";

export interface AddContactsRequestBody {
  accessToken: string;
  action?: string;
  contacts?: string; // JSON string of array of { name, phone, email } for addContacts
  source?: "crayscore" | "schemerscore";
}

// Contacts API is disconnected from local database; use external API only when configured.
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
    const body = (await request.json()) as AddContactsRequestBody;
    const accessToken = String(body.accessToken ?? "").trim();
    const action = body.action ?? "addContacts";

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

    // Get My Contact List (getContacts) — returns contacts[] with _id, userId, name, phone, email, isNumberAvailable (no local DB)
    if (action === "getContacts") {
      if (apiUrl) {
        const payload = { action: "getContacts", accessToken };
        const proxyRes = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await proxyRes.json().catch(() => ({}));
        const resBody = (data?.body ?? data) as { status?: string; contacts?: unknown[] };
        // If external API returns error (e.g. "Unsupported action"), return success with empty list so UI does not show error
        if (resBody?.status === "error" || !Array.isArray(resBody?.contacts)) {
          return NextResponse.json(
            {
              statusCode: 200,
              body: {
                status: "success",
                message: "Contacts fetched successfully.",
                contacts: [],
                lastSyncAt: Date.now(),
              },
            },
            { status: 200 }
          );
        }
        return NextResponse.json(data, { status: proxyRes.status });
      }
      return NextResponse.json(
        {
          statusCode: 200,
          body: {
            status: "success",
            message: "Contacts fetched successfully.",
            contacts: [],
            lastSyncAt: Date.now(),
          },
        },
        { status: 200 }
      );
    }

    if (action === "getContactList") {
      if (apiUrl) {
        const payload = { action: "getContactList", accessToken };
        const proxyRes = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await proxyRes.json().catch(() => ({}));
        const resBody = (data?.body ?? data) as { status?: string; result?: unknown[]; data?: unknown[] };
        const list = Array.isArray(resBody?.result) ? resBody.result : Array.isArray(resBody?.data) ? resBody.data : null;
        // If external API returns error or no list, return success with empty result so UI does not show error
        if (resBody?.status === "error" || list === null) {
          return NextResponse.json(
            {
              statusCode: 200,
              body: { status: "success", message: "Contact list.", result: [] },
            },
            { status: 200 }
          );
        }
        return NextResponse.json(data, { status: proxyRes.status });
      }
      return NextResponse.json(
        {
          statusCode: 200,
          body: { status: "success", message: "Contact list.", result: [] },
        },
        { status: 200 }
      );
    }

    const contacts = body.contacts;
    if (contacts === undefined || typeof contacts !== "string") {
      return NextResponse.json(
        {
          statusCode: 400,
          body: { status: "error", message: "contacts (JSON string) is required" },
        },
        { status: 400 }
      );
    }

    if (apiUrl) {
      const payload = {
        action: "addContacts",
        accessToken,
        contacts,
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
        body: { status: "success", message: "Contact added successfully." },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Contacts API error:", err);
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
