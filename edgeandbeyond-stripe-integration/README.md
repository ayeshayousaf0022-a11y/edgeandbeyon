# Edge & Beyond — Stripe Payment Integration

## Folder structure (matches what you need locally)

```
edgeandbeyond-stripe-integration/
├── supabase/
│   ├── functions/
│   │   ├── create-checkout/
│   │   │   └── index.ts        <- Edge Function: creates Stripe Checkout Session
│   │   └── stripe-webhook/
│   │       └── index.ts        <- Edge Function: writes paid orders into Supabase
│   └── migrations/
│       └── 001_orders_stripe_columns.sql   <- run this in Supabase SQL Editor first
├── success.html                <- goes to your GitHub Pages repo root
├── cancel.html                 <- goes to your GitHub Pages repo root
└── atlas-carryall-landing.html <- replaces your current landing page (Buy Now rewired)
```

## Setup

1. **Database** — In Supabase Dashboard -> SQL Editor, paste and run the contents of
   `supabase/migrations/001_orders_stripe_columns.sql`.

2. **Copy the `supabase/functions/` folder** from this package directly into your local
   project's `supabase/functions/` folder (replacing the empty one), so you end up with:
   ```
   <your project>/supabase/functions/create-checkout/index.ts
   <your project>/supabase/functions/stripe-webhook/index.ts
   ```

3. **Confirm Docker Desktop is running**, then from your project root:
   ```bash
   supabase link --project-ref lupsxhgwtnonpyrhbujy
   supabase functions deploy create-checkout --no-verify-jwt
   ```

4. **Set up the Stripe webhook**
   - Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
   - URL: `https://lupsxhgwtnonpyrhbujy.supabase.co/functions/v1/stripe-webhook`
   - Event: `checkout.session.completed`
   - Copy the signing secret it gives you, then:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```

5. **Confirm your Stripe key is set** (should already be, per your earlier setup):
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   ```

6. **Push the site files**
   - Replace your current landing page with `atlas-carryall-landing.html`
   - Add `success.html` and `cancel.html` to your GitHub Pages repo root
   - Commit and push

7. **Test** with a Stripe test card (`4242 4242 4242 4242`) before going live, and confirm
   a row appears in your `orders` table after a successful checkout.

## Notes

- Price is always looked up server-side in `create-checkout/index.ts` — never trust the browser.
- `stripe-webhook` upserts on `order_id`, so Stripe's automatic webhook retries won't create
  duplicate rows.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase into every Edge
  Function — you never set these yourself.
