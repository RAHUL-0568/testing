import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in .env.local." },
      { status: 500 }
    );
  }

  try {
    const stripe = new Stripe(secretKey);
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      request.headers.get("origin") ||
      "http://localhost:3000";
    const successUrl = `${origin}/home?background_check_success=1`;
    const cancelUrl = `${origin}/home`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 799, // $7.99
            product_data: {
              name: "BackgroundCheck - Test",
              description:
                "Background verification — safety and trust evaluation based on behavioral and risk indicators.",
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Failed to create Stripe Checkout session." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Background checkout error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to create checkout session.",
      },
      { status: 500 }
    );
  }
}
