-- Run this in Supabase SQL Editor before enabling paid access.
-- It adds subscription fields used by pricing.html, signin.html, dashboard.html, and admin.html.

alter table public.profiles
add column if not exists subscription_status text default 'inactive',
add column if not exists subscription_plan text,
add column if not exists subscription_reference text,
add column if not exists subscription_expires_at timestamptz,
add column if not exists subscription_billing_cycle text,
add column if not exists subscription_currency text;

-- Optional helper: make one existing admin active manually.
-- update public.profiles
-- set subscription_status = 'active',
--     subscription_plan = 'business',
--     subscription_expires_at = now() + interval '1 year'
-- where email = 'your-admin-email@example.com';

-- Suggested policy idea:
-- Keep profile updates limited so users can only update their own row.
-- For production payments, use a backend webhook to activate subscriptions
-- instead of updating subscription_status directly from the browser.
