-- Run this after creating the businesses table, or use it to complete the team/business upgrade.
-- It keeps existing data and makes every record belong to one business.

alter table public.profiles
add column if not exists business_id uuid references public.businesses(id),
add column if not exists is_active boolean default true,
add column if not exists status text default 'active';

alter table public.customers
add column if not exists business_id uuid references public.businesses(id);

alter table public.products
add column if not exists business_id uuid references public.businesses(id);

create index if not exists profiles_business_id_idx on public.profiles(business_id);
create index if not exists customers_business_id_idx on public.customers(business_id);
create index if not exists products_business_id_idx on public.products(business_id);

-- If you already created one business manually, link old records like this:
-- update public.profiles set business_id = 'PASTE_BUSINESS_ID' where business_id is null;
-- update public.customers set business_id = 'PASTE_BUSINESS_ID' where business_id is null;
-- update public.products set business_id = 'PASTE_BUSINESS_ID' where business_id is null;
