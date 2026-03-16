import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/app/lib/encrypt";

/** Request: encrypted or plain profile fields from auth user */
export interface DecryptProfileRequestBody {
  firstName?: string | null;
  lastName?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DecryptProfileRequestBody;
    const rawFirst = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const rawLast = typeof body.lastName === "string" ? body.lastName.trim() : "";

    const firstName = rawFirst ? (decrypt(rawFirst) ?? rawFirst) : "";
    const lastName = rawLast ? (decrypt(rawLast) ?? rawLast) : "";

    return NextResponse.json(
      { firstName, lastName },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { firstName: "", lastName: "" },
      { status: 200 }
    );
  }
}
