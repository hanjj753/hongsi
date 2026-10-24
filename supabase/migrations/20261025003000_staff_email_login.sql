-- An active staff directory email is the login allowlist. Existing application roles remain.
begin;

create or replace function app_private.current_staff_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s
  where (select app_private.is_hongsi_firebase_user())
    and s.firebase_uid = (select auth.jwt()->>'sub')
    and s.email = lower(btrim((select auth.jwt()->>'email')))
    and s.archived_at is null;
$$;

create or replace function app_private.current_app_role()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(a.app_role, 'assistant')
  from public.staff s left join public.app_access a on a.staff_id = s.id
  where s.id = (select app_private.current_staff_id())
    and s.employment_status = 'active' and s.archived_at is null;
$$;

create or replace function public.get_my_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('staff_id', s.id::text, 'full_name', s.full_name,
    'app_role', coalesce(a.app_role, 'assistant'), 'access_status', 'approved',
    'employment_status', s.employment_status,
    'can_manage_devices', (select app_private.can_manage()),
    'can_manage_accounts', (select app_private.is_admin()))
  from public.staff s left join public.app_access a on a.staff_id = s.id
  where s.id = (select app_private.current_staff_id());
$$;

create or replace function public.link_my_staff_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  matched_staff_id bigint;
  verified_email text;
begin
  if not app_private.is_hongsi_firebase_user() then
    raise exception 'Verified Firebase account required' using errcode = '42501';
  end if;
  verified_email := lower(btrim(auth.jwt()->>'email'));
  if verified_email is null or verified_email = '' then return null; end if;

  select id into matched_staff_id from public.staff
    where firebase_uid = auth.jwt()->>'sub' and email = verified_email
      and employment_status = 'active' and archived_at is null;
  if matched_staff_id is null then
    update public.staff set firebase_uid = auth.jwt()->>'sub'
      where email = verified_email and firebase_uid is null
        and employment_status = 'active' and archived_at is null
      returning id into matched_staff_id;
  end if;
  if matched_staff_id is null then return null; end if;

  insert into public.app_access(staff_id, app_role, access_status)
    values (matched_staff_id, 'assistant', 'approved')
    on conflict (staff_id) do update set access_status = 'approved';
  return public.get_my_access();
end;
$$;

-- Keep the existing RPC signature for older app versions, but remove the
-- ability to put a listed staff member into a separate approval state.
create or replace function public.admin_set_access(target_staff_id bigint, new_role text, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(804211566696::bigint);
  if not app_private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if target_staff_id = app_private.current_staff_id() then
    raise exception 'Cannot change your own access' using errcode = '42501';
  end if;
  if new_status <> 'approved' or new_role not in ('assistant', 'manager', 'admin') then
    raise exception 'Only active staff roles can be assigned' using errcode = '23514';
  end if;
  if not exists (select 1 from public.staff where id = target_staff_id
    and employment_status = 'active' and archived_at is null) then
    raise exception 'Active staff member required' using errcode = '23514';
  end if;
  insert into public.app_access(staff_id, app_role, access_status)
    values (target_staff_id, new_role, 'approved')
    on conflict (staff_id) do update
      set app_role = excluded.app_role, access_status = 'approved';
end;
$$;

create function app_private.guard_staff_email_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    if not app_private.is_admin() or old.id = app_private.current_staff_id() then
      raise exception 'Only an administrator can change another staff email' using errcode = '42501';
    end if;
    -- The old Google account must lose access as soon as the directory email changes.
    new.firebase_uid := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_staff_email_identity() from public, anon, authenticated;
create trigger guard_staff_email_identity before update of email on public.staff
  for each row execute function app_private.guard_staff_email_identity();

update public.app_access a set access_status = 'approved',
  app_role = case when a.access_status = 'suspended' then 'assistant' else a.app_role end
  from public.staff s
  where s.id = a.staff_id and s.employment_status = 'active'
    and s.archived_at is null and a.access_status <> 'approved';

comment on function public.link_my_staff_account() is
  '검증된 Firebase 이메일이 현역 조교 명단에 있을 때 자동으로 연결하고 로그인 권한을 부여한다.';
notify pgrst, 'reload schema';
commit;
