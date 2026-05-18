-- Pro team chat tables.

create table if not exists public.team_chat_settings (
    business_id uuid primary key,
    admin_only boolean default false,
    allow_attachments boolean default true,
    updated_by uuid references auth.users(id),
    updated_at timestamptz default now()
);

create table if not exists public.team_chat_messages (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null,
    sender_id uuid references auth.users(id),
    sender_name text,
    sender_role text,
    message text,
    attachment_url text,
    attachment_type text,
    created_at timestamptz default now()
);

create index if not exists team_chat_messages_business_created_idx
on public.team_chat_messages(business_id, created_at desc);

create table if not exists public.team_chat_reactions (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null,
    business_id uuid not null,
    user_id uuid references auth.users(id),
    user_name text,
    reaction text not null,
    created_at timestamptz default now(),
    unique(message_id, user_id)
);

create index if not exists team_chat_reactions_message_idx
on public.team_chat_reactions(message_id);

-- Optional RLS note:
-- The current app reads/writes chat through server.js using the Supabase service-role key.
-- Keep direct table access restricted unless you later add explicit business-scoped RLS policies.
