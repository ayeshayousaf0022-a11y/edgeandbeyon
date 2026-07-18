// supabase/functions/create-checkout/index.ts
//
// Creates a Stripe Checkout Session for one or more cart items and returns
// its URL. The browser is never trusted with the price of a real product —
// it only sends a productId and quantity; the real price always comes from
// the PRODUCTS map below. Free "gift" line items are the one exception:
// since they're always priced at £0 server-side, the client-supplied name
// is safe to use (there's no financial value to tamper with).

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

const CURRENCY = "gbp"; // single-currency store for now

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

interface CartItemInput {
  productId?: string;
  quantity?: number | string;
  isGift?: boolean;
  name?: string; // only used (and trusted) when isGift is true — it's a £0 item
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

    // Back-compat: a single { productId, quantity } request (used by "Buy Now")
    // is treated the same as a one-item cart.
    const rawItems: CartItemInput[] = Array.isArray(body.items)
      ? body.items
      : body.productId
      ? [{ productId: body.productId, quantity: body.quantity }]
      : [];

    if (rawItems.length === 0) {
      return new Response(JSON.stringify({ error: "No items to check out" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    if (rawItems.length > 20) {
      return new Response(JSON.stringify({ error: "Too many items" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const summaryParts: string[] = [];
    let totalQuantity = 0;
    let totalAmount = 0; // major units, for a sanity check before creating the session

    for (const raw of rawItems) {
      const quantity = Math.max(1, Math.min(10, parseInt(String(raw.quantity ?? "1"), 10) || 1));

      if (raw.isGift) {
        // Free gift: price is always £0 regardless of what the client sends.
        // Safe to use the client-supplied name since there's no value at stake.
        const giftName = String(raw.name ?? "Gift").slice(0, 200) || "Gift";
        line_items.push({
          price_data: {
            currency: CURRENCY,
            unit_amount: 0,
            product_data: { name: giftName },
          },
          quantity,
        });
        summaryParts.push(`${giftName} ×${quantity}`);
        continue;
      }

      const product = PRODUCTS[String(raw.productId ?? "")];
      if (!product) {
        return new Response(JSON.stringify({ error: `Unknown product: ${raw.productId}` }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      line_items.push({
        price_data: {
          currency: product.currency,
          unit_amount: Math.round(product.price * 100),
          product_data: { name: product.name },
        },
        quantity,
      });
      summaryParts.push(`${product.name} ×${quantity}`);
      totalAmount += product.price * quantity;
      totalQuantity += quantity;
    }

    if (totalAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Your bag total is £0 — add a product before checking out." }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // Our own order id, generated up front so we can tie the Checkout
    // Session to a row in `orders` before Stripe ever confirms payment.
    const orderId = `EDGE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
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
        // Stripe metadata values are strings only, and the orders table has a
        // single product_name/quantity column pair — so a multi-item cart is
        // summarized into one readable line rather than stored per-item.
        product_name: summaryParts.join(", ").slice(0, 480),
        quantity: String(totalQuantity || 1),
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

