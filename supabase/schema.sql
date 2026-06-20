-- CURE Web: run this file once in Supabase → SQL Editor.
-- It creates the shared clinic model, medical data tables, RLS policies and private photo storage.

create extension if not exists pgcrypto;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  invite_code text not null unique default ('CURE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'doctor', 'member')),
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) > 0),
  birth_date date,
  gender text not null default 'Не указан',
  phone text not null default '',
  second_phone text not null default '',
  email text not null default '',
  address text not null default '',
  profession text not null default '',
  source text not null default 'Другое',
  first_visit_date date default current_date,
  status text not null default 'Новый',
  general_note text not null default '',
  anamnesis jsonb not null default '{}'::jsonb,
  dental jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  date timestamptz not null default now(),
  teeth text not null default '',
  complaint text not null default '',
  diagnosis text not null default '',
  treatment_type text not null default 'Консультация',
  procedure_description text not null default '',
  materials text not null default '',
  anesthesia text not null default '',
  recommendations text not null default '',
  doctor_notes text not null default '',
  total_cost numeric(14,2) not null default 0 check (total_cost >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  refund numeric(14,2) not null default 0 check (refund >= 0),
  next_visit_date timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete cascade,
  type text not null check (type in ('Доход', 'Расход', 'Возврат', 'Скидка', 'Коррекция')),
  amount numeric(14,2) not null check (amount > 0),
  date timestamptz not null default now(),
  category text not null,
  payment_method text not null default 'Карта',
  comment text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.photo_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete cascade,
  category text not null default 'Другое',
  storage_path text not null unique,
  comment text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists patients_clinic_idx on public.patients(clinic_id);
create index if not exists patients_search_idx on public.patients(clinic_id, full_name);
create index if not exists visits_clinic_patient_idx on public.visits(clinic_id, patient_id, date desc);
create index if not exists finance_clinic_date_idx on public.finance_transactions(clinic_id, date desc);
create index if not exists photos_clinic_patient_idx on public.photo_records(clinic_id, patient_id);
create index if not exists members_user_idx on public.clinic_members(user_id);

create or replace function public.is_clinic_member(target_clinic uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clinic_members
    where clinic_id = target_clinic and user_id = auth.uid()
  );
$$;

create or replace function public.create_clinic(clinic_name text)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Требуется вход'; end if;
  if exists(select 1 from public.clinic_members where user_id = auth.uid()) then
    raise exception 'Пользователь уже состоит в клинике';
  end if;
  insert into public.clinics(name, created_by)
  values (trim(clinic_name), auth.uid()) returning id into new_id;
  insert into public.clinic_members(clinic_id, user_id, role)
  values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;

create or replace function public.join_clinic_by_code(code text)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'Требуется вход'; end if;
  if exists(select 1 from public.clinic_members where user_id = auth.uid()) then
    raise exception 'Пользователь уже состоит в клинике';
  end if;
  select id into target from public.clinics where invite_code = upper(trim(code));
  if target is null then raise exception 'Клиника с таким кодом не найдена'; end if;
  insert into public.clinic_members(clinic_id, user_id, role)
  values (target, auth.uid(), 'member');
  return target;
end;
$$;

revoke all on function public.create_clinic(text) from public;
revoke all on function public.join_clinic_by_code(text) from public;
grant execute on function public.create_clinic(text) to authenticated;
grant execute on function public.join_clinic_by_code(text) to authenticated;

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.patients enable row level security;
alter table public.visits enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.photo_records enable row level security;

grant usage on schema public to authenticated;
grant select on public.clinics, public.clinic_members to authenticated;
grant select, insert, update, delete on
  public.patients,
  public.visits,
  public.finance_transactions,
  public.photo_records
to authenticated;

drop policy if exists "Members read clinics" on public.clinics;
create policy "Members read clinics" on public.clinics for select to authenticated
using (public.is_clinic_member(id));

drop policy if exists "Members read memberships" on public.clinic_members;
create policy "Members read memberships" on public.clinic_members for select to authenticated
using (user_id = auth.uid() or public.is_clinic_member(clinic_id));

drop policy if exists "Clinic members manage patients" on public.patients;
create policy "Clinic members manage patients" on public.patients for all to authenticated
using (public.is_clinic_member(clinic_id))
with check (public.is_clinic_member(clinic_id));

drop policy if exists "Clinic members manage visits" on public.visits;
create policy "Clinic members manage visits" on public.visits for all to authenticated
using (public.is_clinic_member(clinic_id))
with check (public.is_clinic_member(clinic_id));

drop policy if exists "Clinic members manage finance" on public.finance_transactions;
create policy "Clinic members manage finance" on public.finance_transactions for all to authenticated
using (public.is_clinic_member(clinic_id))
with check (public.is_clinic_member(clinic_id));

drop policy if exists "Clinic members manage photo records" on public.photo_records;
create policy "Clinic members manage photo records" on public.photo_records for all to authenticated
using (public.is_clinic_member(clinic_id))
with check (public.is_clinic_member(clinic_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-photos', 'clinical-photos', false, 15728640,
  array['image/jpeg','image/png','image/heic','image/heif','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clinic members read photos" on storage.objects;
create policy "Clinic members read photos" on storage.objects for select to authenticated
using (
  bucket_id = 'clinical-photos'
  and public.is_clinic_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Clinic members upload photos" on storage.objects;
create policy "Clinic members upload photos" on storage.objects for insert to authenticated
with check (
  bucket_id = 'clinical-photos'
  and public.is_clinic_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Clinic members delete photos" on storage.objects;
create policy "Clinic members delete photos" on storage.objects for delete to authenticated
using (
  bucket_id = 'clinical-photos'
  and public.is_clinic_member(((storage.foldername(name))[1])::uuid)
);

do $$
begin
  alter publication supabase_realtime add table public.patients;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.visits;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.finance_transactions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.photo_records;
exception when duplicate_object then null;
end $$;
