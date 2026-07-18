// supabase/functions/create-checkout/index.ts
//
// Creates a Stripe Checkout Session for a single product and returns its URL.
// The browser is never trusted with the price — it only sends a productId
// and quantity; the real price comes from the PRODUCTS map below.

import Stripe from "npm:stripe@17.4.0";

// Only these origins may call this function.
const ALLOWED_ORIGINS = new Set([
  "https://edgeandbeyond.com",
  "https://www.edgeandbeyond.com",
]);

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(), // required in the Deno runtime
});

// Server-side product catalog. Add more products here as you add pages —
// never accept a price from the client.
const PRODUCTS: Record<string, { name: string; price: number; currency: string }> = {
  "atlas-carryall-espresso": {
    name: "The Atlas Carryall — Espresso Full-Grain Leather",
    price: 245, // major units (£245.00)
    currency: "gbp",
  },
};

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const productId = String(body.productId ?? "");
    const quantity = Math.max(1, Math.min(10, parseInt(String(body.quantity ?? "1"), 10) || 1));

    const product = PRODUCTS[productId];
    if (!product) {
      return new Response(JSON.stringify({ error: "Unknown product" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Our own order id, generated up front so we can tie the Checkout
    // Session to a row in `orders` before Stripe ever confirms payment.
    const orderId = `EDGE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: product.currency,
            unit_amount: Math.round(product.price * 100),
            product_data: { name: product.name },
          },
          quantity,
        },
      ],
      customer_creation: "always",
      phone_number_collection: { enabled: true },
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["GB", "IE", "FR", "DE", "ES", "IT", "NL", "BE", "PT", "US", "CA"],
      },
      success_url: "https://edgeandbeyond.com/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://edgeandbeyond.com/cancel.html",
      metadata: {
        order_id: orderId,
        product_id: productId,
        product_name: product.name,
        quantity: String(quantity),
      },
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }

    return new Response(JSON.stringify({ url: session.url, order_id: orderId }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-checkout error:", err);
    return new Response(JSON.stringify({ error: "Unable to create checkout session" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
