-- Flowstate website backend tables. RLS enabled, NO anon/auth policies:
-- all access is via the service role inside route handlers / the webhook.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  notes text,
  setup_url text not null,
  portable_url text not null,
  pub_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.download_counts (
  variant text primary key,
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.download_counts (variant, count) values ('setup', 0), ('portable', 0)
  on conflict (variant) do nothing;

-- Atomic download counter. SECURITY DEFINER so the service role call is enough.
create or replace function public.increment_download(p_variant text)
returns void language sql security definer as $$
  insert into public.download_counts (variant, count, updated_at)
  values (p_variant, 1, now())
  on conflict (variant)
  do update set count = public.download_counts.count + 1, updated_at = now();
$$;

alter table public.waitlist enable row level security;
alter table public.contacts enable row level security;
alter table public.releases enable row level security;
alter table public.download_counts enable row level security;
