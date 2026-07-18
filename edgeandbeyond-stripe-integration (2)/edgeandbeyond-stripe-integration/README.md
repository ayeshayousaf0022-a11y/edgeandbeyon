# Edge & Beyond — Stripe Payment Integration (v2: Buy Now + Cart both go through Stripe)

## What changed from v1
- `create-checkout` now accepts a **list of cart items** (not just one hardcoded product), so
  both "Buy Now" and "Add to Cart -> Checkout" use the same real Stripe Checkout flow.
- The cart checkout modal no longer has fake "Card number / Expiry / CVC" fields — those never
  went anywhere and would have been a PCI compliance problem if ever wired up for real. Instead
  it shows your order summary and a "Continue to secure payment" button that hands off to
  Stripe's own hosted, secure checkout page (same as Buy Now).
- Free gift items are always priced at £0 server-side, regardless of what the browser sends —
  only the *name* of a gift is taken from the client, since there's no financial value to protect there.

## Folder structure

```
edgeandbeyond-stripe-integration/
├── supabase/
│   ├── functions/
│   │   ├── create-checkout/
│   │   │   └── index.ts        <- creates Stripe Checkout Session for cart or single item
│   │   └── stripe-webhook/
│   │       └── index.ts        <- writes paid orders into Supabase (unchanged from v1)
│   └── migrations/
│       └── 001_orders_stripe_columns.sql
├── success.html
├── cancel.html
└── atlas-carryall-landing.html  <- Buy Now AND cart checkout both call Stripe now
```

## Deploy

Only `create-checkout` changed — `stripe-webhook` does not need redeploying, but it's harmless to redeploy both:

```bash
supabase functions deploy create-checkout --no-verify-jwt
```

Then push the updated `atlas-carryall-landing.html` to your GitHub Pages repo.

## Note on multi-item orders

Your `orders` table has a single `product_name` and `quantity` column (not a separate table per
line item). When a cart has multiple different items, `product_name` is stored as a readable
summary like `"The Atlas Carryall ×1, Founder's Kit gift ×1"` and `quantity` is the total item
count. If you want itemized order lines later, that needs a small `order_items` child table —
happy to build that when you're ready.
