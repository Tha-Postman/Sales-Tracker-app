-- Repair an existing businesses table that was created without businesses.id.
-- Run this FIRST in Supabase SQL Editor, then run production-upgrade.sql again.

create extension if not exists pgcrypto;

alter table public.businesses
add column if not exists id uuid;

update public.businesses
set id = gen_random_uuid()
where id is null;

alter table public.businesses
alter column id set default gen_random_uuid();

alter table public.businesses
alter column id set not null;

do $$
declare
    id_attnum smallint;
    has_id_key boolean;
    has_primary_key boolean;
begin
    select attnum
    into id_attnum
    from pg_attribute
    where attrelid = 'public.businesses'::regclass
      and attname = 'id'
      and not attisdropped;

    select exists (
        select 1
        from pg_constraint
        where conrelid = 'public.businesses'::regclass
          and contype in ('p', 'u')
          and id_attnum = any(conkey)
    )
    into has_id_key;

    select exists (
        select 1
        from pg_constraint
        where conrelid = 'public.businesses'::regclass
          and contype = 'p'
    )
    into has_primary_key;

    if not has_id_key and not has_primary_key then
        alter table public.businesses
        add constraint businesses_pkey primary key (id);
    elsif not has_id_key then
        alter table public.businesses
        add constraint businesses_id_key unique (id);
    end if;
end $$;

alter table public.businesses
add column if not exists business_name text default 'New Business',
add column if not exists owner_id uuid references auth.users(id),
add column if not exists plan text default 'starter-monthly',
add column if not exists subscription_status text default 'inactive',
add column if not exists subscription_expires_at timestamptz,
add column if not exists currency text default 'NGN',
add column if not exists receipt_footer text default 'Thank you for your purchase.',
add column if not exists low_stock_threshold integer default 5,
add column if not exists created_at timestamptz default now(),
add column if not exists updated_at timestamptz default now();

-- If you already have one admin/business row but profiles are not linked yet,
-- uncomment this after checking the business id:
--
-- select id, business_name from public.businesses;
-- update public.profiles set business_id = 'PASTE_BUSINESS_ID' where business_id is null;
-- update public.customers set business_id = 'PASTE_BUSINESS_ID' where business_id is null;
-- update public.products set business_id = 'PASTE_BUSINESS_ID' where business_id is null;
