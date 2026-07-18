-- Run this once in the Supabase SQL Editor (or via `supabase db push`).
-- Adds the columns the Stripe webhook needs, and two safety constraints
-- so retried webhooks never create duplicate order rows.

alter table public.orders
  add column if not exists shipping_address        text,
  add column if not exists product_name             text,
  add column if not exists quantity                 integer,
  add column if not exists price                     numeric,
  add column if not exists currency                  text,
  add column if not exists payment_status            text,
  add column if not exists stripe_payment_intent_id  text,
  add column if not exists tracking_number           text,
  add column if not exists created_at                timestamptz default now();

-- Unique order_id lets the webhook safely "upsert" — if Stripe retries the
-- same event (it does this routinely), we update the existing row instead
-- of inserting a duplicate order.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_order_id_key'
  ) then
    alter table public.orders add constraint orders_order_id_key unique (order_id);
  end if;
end $$;

-- Belt-and-braces: also guarantee we never store the same Stripe payment
-- twice under two different order_ids.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_stripe_payment_intent_id_key'
  ) then
    alter table public.orders add constraint orders_stripe_payment_intent_id_key unique (stripe_payment_intent_id);
  end if;
end $$;
