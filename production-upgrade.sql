-- Production workflow upgrade for Sales Tracker.
-- Run this in Supabase SQL Editor after the existing business/team/chat setup.
-- If you already created public.businesses before and it has no id column,
-- run business-id-repair.sql first, then run this file.

create extension if not exists pgcrypto;

create table if not exists public.businesses (
    id uuid primary key default gen_random_uuid(),
    business_name text not null default 'New Business',
    owner_id uuid references auth.users(id),
    plan text default 'starter-monthly',
    subscription_status text default 'inactive',
    subscription_expires_at timestamptz,
    currency text default 'NGN',
    receipt_footer text default 'Thank you for your purchase.',
    low_stock_threshold integer default 5,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table public.businesses
add column if not exists currency text default 'NGN',
add column if not exists receipt_footer text default 'Thank you for your purchase.',
add column if not exists low_stock_threshold integer default 5,
add column if not exists updated_at timestamptz default now();

alter table public.profiles
add column if not exists business_id uuid references public.businesses(id),
add column if not exists is_active boolean default true,
add column if not exists status text default 'active',
add column if not exists subscription_status text default 'inactive',
add column if not exists subscription_plan text,
add column if not exists subscription_reference text,
add column if not exists subscription_expires_at timestamptz,
add column if not exists subscription_billing_cycle text,
add column if not exists subscription_currency text;

alter table public.customers
add column if not exists business_id uuid references public.businesses(id),
add column if not exists created_by text;

alter table public.products
add column if not exists business_id uuid references public.businesses(id),
add column if not exists available boolean default true;

create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    business_id uuid references public.businesses(id) on delete cascade not null,
    actor_id uuid references auth.users(id),
    actor_name text,
    actor_role text,
    action text not null,
    target_type text,
    target_id text,
    details jsonb default '{}'::jsonb,
    created_at timestamptz default now()
);

create index if not exists profiles_business_id_idx on public.profiles(business_id);
create index if not exists customers_business_id_idx on public.customers(business_id);
create index if not exists products_business_id_idx on public.products(business_id);
create index if not exists audit_logs_business_created_idx on public.audit_logs(business_id, created_at desc);

