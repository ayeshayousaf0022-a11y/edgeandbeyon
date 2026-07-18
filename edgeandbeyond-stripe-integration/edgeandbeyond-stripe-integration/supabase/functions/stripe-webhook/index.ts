// supabase/functions/stripe-webhook/index.ts
//
// Receives Stripe webhook events, verifies the signature, and — on
// checkout.session.completed — writes the order into the `orders` table.
//
// This function must be deployed with --no-verify-jwt (see deployment
// notes) because Stripe calls it directly and cannot send a Supabase auth
// token. Security instead comes entirely from the Stripe signature check
// below — never remove that check.

import Stripe from "npm:stripe@17.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// Supabase into every Edge Function — do not set these yourself, and never
// put the service role key in any client-side code.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function formatAddress(addr?: Stripe.Address | null): string | null {
  if (!addr) return null;
  return [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country]
    .filter(Boolean)
    .join(", ");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text(); // must stay unparsed for signature verification

  if (!signature) {
    return new Response("Missing Stripe-Signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const shippingAddress =
      formatAddress(session.shipping_details?.address) ??
      formatAddress(session.customer_details?.address);

    const { error } = await supabase.from("orders").upsert(
      {
        order_id: session.metadata?.order_id ?? session.id,
        customer_name: session.customer_details?.name ?? null,
        email: session.customer_details?.email ?? null,
        phone: session.customer_details?.phone ?? null,
        shipping_address: shippingAddress,
        product_name: session.metadata?.product_name ?? null,
        quantity: session.metadata?.quantity
          ? parseInt(session.metadata.quantity, 10)
          : null,
        price: session.amount_total != null ? session.amount_total / 100 : null,
        currency: session.currency ?? null,
        payment_status: session.payment_status ?? "paid",
        stripe_payment_intent_id:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        // tracking_number is intentionally left null — filled in later during fulfillment
        // created_at uses the column default (now())
      },
      { onConflict: "order_id" },
    );

    if (error) {
      console.error("Supabase insert error:", error);
      // Non-2xx makes Stripe retry the webhook later.
      return new Response("Database error", { status: 500 });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
