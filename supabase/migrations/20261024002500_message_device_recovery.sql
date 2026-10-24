-- Reinstalled Android apps lose their local pairing secret. Re-pair only for the
-- original staff account (or a manager) and require a fresh approval. Archive
-- deleted devices so historical deliveries keep their device reference.
begin;

alter table public.sending_devices add column if not exists archived_at timestamptz;

-- The original composite FK excludes visiting makeup students. Replace it
-- with an equally narrow roster check: enrollment in this class, or explicit
-- participation in this exact class session. Existing class/session and
-- student FKs remain in place. Direct client inserts remain denied by RLS.
create function app_private.check_message_roster()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.enrollments e
      where e.class_id = new.class_id and e.student_id = new.student_id)
    or (new.session_id is not null and exists (
      select 1 from public.session_participants p
      where p.host_class_id = new.class_id and p.session_id = new.session_id
        and p.student_id = new.student_id)) then
    return new;
  end if;
  raise exception 'Student is not enrolled or participating in class session'
    using errcode = '23514';
end;
$$;
revoke all on function app_private.check_message_roster() from public, anon, authenticated;
create trigger messages_roster before insert or update of class_id, student_id, session_id
  on public.messages for each row execute function app_private.check_message_roster();
alter table public.messages drop constraint if exists messages_class_id_student_id_fkey;

create or replace function public.register_sending_device(device_label text, android_identifier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  existing_id uuid;
  original_staff_id bigint;
  secret text;
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if btrim(coalesce(device_label,'')) = '' or btrim(coalesce(android_identifier,'')) = '' then
    raise exception 'Device label and identifier are required' using errcode = '23514';
  end if;
  select d.id,d.registered_by into existing_id,original_staff_id
    from public.sending_devices d where d.legacy_device_id = btrim(android_identifier) for update;
  if existing_id is not null then
    if original_staff_id <> app_private.current_staff_id() and not app_private.can_manage() then
      raise exception 'Ask a manager to reset this device' using errcode = '42501';
    end if;
    delete from app_private.sending_device_credentials where device_id = existing_id;
    update public.sending_devices set label = btrim(device_label), is_enabled = false,
      registered_by = app_private.current_staff_id(), archived_at = null,
      updated_at = statement_timestamp() where id = existing_id;
    new_id := existing_id;
  else
    insert into public.sending_devices(label,legacy_device_id,is_enabled,registered_by)
      values (btrim(device_label),btrim(android_identifier),false,app_private.current_staff_id())
      returning id into new_id;
  end if;
  secret := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into app_private.sending_device_credentials(device_id,secret_hash)
    values (new_id,sha256(convert_to(secret,'UTF8')));
  return jsonb_build_object('device_id',new_id,'secret',secret);
end;
$$;
revoke all on function public.register_sending_device(text,text) from public, anon, authenticated;
grant execute on function public.register_sending_device(text,text) to authenticated;

create function public.archive_sending_device(target_device_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_manage() then
    raise exception 'Manager account required' using errcode = '42501';
  end if;
  update public.sending_devices set is_enabled = false, archived_at = statement_timestamp(),
    updated_at = statement_timestamp() where id = target_device_id and archived_at is null;
  if not found then raise exception 'Device not found' using errcode = 'P0002'; end if;
  delete from app_private.sending_device_credentials where device_id = target_device_id;
end;
$$;
revoke all on function public.archive_sending_device(uuid) from public, anon, authenticated;
grant execute on function public.archive_sending_device(uuid) to authenticated;

-- A makeup student belongs to the host session as a participant, even though
-- their enrollment stays in the original class.
create or replace function public.create_class_messages(target_class_id bigint,target_session_id bigint,message_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  target_student_id bigint;
  target_request_id uuid;
  parent_phone text;
  student_phone text;
  recipient_preference text;
  student_name text;
  message_id bigint;
  created_count integer := 0;
  existing_count integer := 0;
  message_content text;
begin
  if not app_private.can_access_class_messages(target_class_id,target_session_id) then
    raise exception 'Class messaging access denied' using errcode = '42501';
  end if;
  if target_session_id is not null and not exists (
    select 1 from public.class_sessions s where s.id = target_session_id and s.class_id = target_class_id) then
    raise exception 'Session does not belong to class' using errcode = '23514';
  end if;
  if jsonb_typeof(message_items) <> 'array' or jsonb_array_length(message_items) < 1
    or jsonb_array_length(message_items) > 100 then
    raise exception 'Provide 1 to 100 messages' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(message_items) loop
    target_student_id := (item->>'student_id')::bigint;
    target_request_id := (item->>'request_id')::uuid;
    message_content := btrim(coalesce(item->>'content',''));
    if message_content = '' then raise exception 'Message content is required' using errcode = '23514'; end if;
    select s.full_name,s.parent_phone,s.student_phone,s.default_message_recipients
      into student_name,parent_phone,student_phone,recipient_preference
      from public.students s where s.id = target_student_id and (
        exists (select 1 from public.enrollments e
          where e.class_id = target_class_id and e.student_id = s.id)
        or (target_session_id is not null and exists (
          select 1 from public.session_participants p where p.host_class_id = target_class_id
            and p.session_id = target_session_id and p.student_id = s.id))
      );
    if not found then raise exception 'Student is not enrolled or participating in class' using errcode = '23514'; end if;
    if nullif(btrim(coalesce(parent_phone,'')),'') is null then
      raise exception 'Parent phone is required for student %',target_student_id using errcode = '23514';
    end if;
    if recipient_preference = 'both' and nullif(btrim(coalesce(student_phone,'')),'') is null then
      raise exception 'Student phone is required for student %',target_student_id using errcode = '23514';
    end if;
    insert into public.messages(class_id,student_id,session_id,student_name_snapshot,
      student_phone_snapshot,parent_phone_snapshot,content,created_by,request_id)
      values (target_class_id,target_student_id,target_session_id,student_name,
        student_phone,parent_phone,message_content,app_private.current_staff_id(),target_request_id)
      on conflict (request_id) do nothing returning id into message_id;
    if message_id is null then
      if not exists (select 1 from public.messages m where m.request_id = target_request_id
        and m.class_id = target_class_id and m.student_id = target_student_id
        and m.session_id is not distinct from target_session_id and m.content = message_content) then
        raise exception 'Request ID was reused for different content' using errcode = '23505';
      end if;
      existing_count := existing_count + 1;
    else
      insert into public.message_deliveries(message_id,recipient_type) values (message_id,'parent');
      if recipient_preference = 'both' then
        insert into public.message_deliveries(message_id,recipient_type) values (message_id,'student');
      end if;
      created_count := created_count + 1;
    end if;
    message_id := null;
  end loop;
  return jsonb_build_object('created',created_count,'already_created',existing_count);
end;
$$;
revoke all on function public.create_class_messages(bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.create_class_messages(bigint,bigint,jsonb) to authenticated;

-- Editing a queued message creates a replacement. A sent/sending message is
-- immutable; this keeps both the recipient snapshot and delivery audit intact.
create function public.replace_pending_message(target_message_id bigint,new_content text,new_request_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  original public.messages%rowtype;
  replacement_id bigint;
begin
  select * into original from public.messages where id = target_message_id for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if not app_private.can_access_class_messages(original.class_id,original.session_id) then
    raise exception 'Class messaging access denied' using errcode = '42501';
  end if;
  if btrim(coalesce(new_content,'')) = '' then
    raise exception 'Message content is required' using errcode = '23514';
  end if;
  perform 1 from public.message_deliveries where message_id = target_message_id for update;
  if not found or exists (select 1 from public.message_deliveries
      where message_id = target_message_id and status <> 'pending') then
    raise exception 'Only fully pending messages can be replaced' using errcode = '23514';
  end if;
  insert into public.messages(class_id,student_id,session_id,student_name_snapshot,
    student_phone_snapshot,parent_phone_snapshot,content,created_by,request_id)
    values (original.class_id,original.student_id,original.session_id,original.student_name_snapshot,
      original.student_phone_snapshot,original.parent_phone_snapshot,btrim(new_content),
      app_private.current_staff_id(),new_request_id)
    returning id into replacement_id;
  insert into public.message_deliveries(message_id,recipient_type)
    select replacement_id,recipient_type from public.message_deliveries where message_id = target_message_id;
  update public.message_deliveries set status = 'cancelled',updated_at = statement_timestamp()
    where message_id = target_message_id;
  return replacement_id;
end;
$$;
revoke all on function public.replace_pending_message(bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.replace_pending_message(bigint,text,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
