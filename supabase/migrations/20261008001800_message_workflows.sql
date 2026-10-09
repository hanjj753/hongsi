-- Message drafts, recipient-level claiming, and a separate paired-device secret.
begin;

create table app_private.sending_device_credentials (
  device_id uuid primary key references public.sending_devices(id) on delete cascade,
  secret_hash bytea not null
);
alter table app_private.sending_device_credentials enable row level security;

create function app_private.device_matches(target_device_id uuid, device_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.sending_device_credentials c
    where c.device_id = target_device_id
      and c.secret_hash = sha256(convert_to(coalesce(device_secret,''), 'UTF8'))
  );
$$;
revoke all on function app_private.device_matches(uuid,text) from public, anon, authenticated;

create function public.register_sending_device(device_label text, android_identifier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  existing_id uuid;
  secret text;
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
  end if;
  if btrim(coalesce(device_label,'')) = '' or btrim(coalesce(android_identifier,'')) = '' then
    raise exception 'Device label and identifier are required' using errcode = '23514';
  end if;
  select d.id into existing_id from public.sending_devices d
    where d.legacy_device_id = btrim(android_identifier) for update;
  if existing_id is not null then
    if exists (select 1 from app_private.sending_device_credentials c where c.device_id = existing_id) then
      raise exception 'Device is already paired; ask a manager to reset its pairing' using errcode = '23505';
    end if;
    update public.sending_devices set label = btrim(device_label), is_enabled = false,
      registered_by = app_private.current_staff_id(), updated_at = statement_timestamp()
      where id = existing_id;
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

create function public.reset_sending_device(target_device_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_manage() then
    raise exception 'Manager account required' using errcode = '42501';
  end if;
  update public.sending_devices set is_enabled = false, updated_at = statement_timestamp()
    where id = target_device_id;
  if not found then raise exception 'Device not found' using errcode = 'P0002'; end if;
  delete from app_private.sending_device_credentials where device_id = target_device_id;
end;
$$;
revoke all on function public.reset_sending_device(uuid) from public, anon, authenticated;
grant execute on function public.reset_sending_device(uuid) to authenticated;

create function public.get_sending_device_state(target_device_id uuid, device_secret text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if app_private.current_app_role() is null or not app_private.device_matches(target_device_id,device_secret) then
    raise exception 'Device pairing is invalid' using errcode = '42501';
  end if;
  select jsonb_build_object('device_id',d.id,'label',d.label,'is_enabled',d.is_enabled)
    into result from public.sending_devices d where d.id = target_device_id;
  return result;
end;
$$;
revoke all on function public.get_sending_device_state(uuid,text) from public, anon, authenticated;
grant execute on function public.get_sending_device_state(uuid,text) to authenticated;

create function public.create_class_messages(target_class_id bigint,target_session_id bigint,message_items jsonb)
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
      from public.students s join public.enrollments e on e.student_id = s.id
      where e.class_id = target_class_id and s.id = target_student_id;
    if not found then raise exception 'Student is not enrolled in class' using errcode = '23514'; end if;
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

create function public.claim_next_message_delivery(target_class_id bigint,target_device_id uuid,device_secret text)
returns table(message_id text,recipient_type text,phone text,content text)
language plpgsql security definer set search_path = '' as $$
declare picked record;
begin
  if not app_private.can_access_class_messages(target_class_id,null) then
    raise exception 'Class messaging access denied' using errcode = '42501';
  end if;
  if not app_private.device_matches(target_device_id,device_secret)
    or not exists (select 1 from public.sending_devices d where d.id = target_device_id and d.is_enabled) then
    raise exception 'Sending device is not approved' using errcode = '42501';
  end if;
  select d.message_id,d.recipient_type,m.content,
    case d.recipient_type when 'student' then m.student_phone_snapshot else m.parent_phone_snapshot end as phone
    into picked
    from public.message_deliveries d join public.messages m on m.id = d.message_id
    where m.class_id = target_class_id and d.status = 'pending'
    order by m.created_at,d.message_id,d.recipient_type
    for update of d skip locked limit 1;
  if not found then return; end if;
  update public.message_deliveries d set status = 'sending',
    attempt_count = d.attempt_count + 1, last_attempt_at = statement_timestamp(),
    sending_device_id = target_device_id, updated_at = statement_timestamp()
    where d.message_id = picked.message_id and d.recipient_type = picked.recipient_type;
  return query select picked.message_id::text,picked.recipient_type::text,picked.phone::text,picked.content::text;
end;
$$;
revoke all on function public.claim_next_message_delivery(bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_next_message_delivery(bigint,uuid,text) to authenticated;

create function public.finish_message_delivery(target_message_id bigint,target_recipient_type text,
  target_device_id uuid,device_secret text,delivery_result text,error_message text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if app_private.current_app_role() is null or not app_private.device_matches(target_device_id,device_secret) then
    raise exception 'Sending device is not paired' using errcode = '42501';
  end if;
  if delivery_result not in ('submitted','failed') then
    raise exception 'Invalid delivery result' using errcode = '23514';
  end if;
  update public.message_deliveries d set status = delivery_result,
    submitted_at = case when delivery_result = 'submitted' then statement_timestamp() else null end,
    last_error = case when delivery_result = 'failed' then left(coalesce(error_message,'Unknown device error'),500) else null end,
    updated_at = statement_timestamp()
    where d.message_id = target_message_id and d.recipient_type = target_recipient_type
      and d.status = 'sending' and d.sending_device_id = target_device_id
      and exists (select 1 from public.messages m where m.id = d.message_id
        and app_private.can_access_class_messages(m.class_id,m.session_id));
  if not found then raise exception 'Claimed delivery not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.finish_message_delivery(bigint,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.finish_message_delivery(bigint,text,uuid,text,text,text) to authenticated;

create function public.cancel_pending_class_messages(target_class_id bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if not app_private.can_manage() then raise exception 'Manager account required' using errcode = '42501'; end if;
  update public.message_deliveries d set status = 'cancelled',updated_at = statement_timestamp()
    from public.messages m where m.id = d.message_id and m.class_id = target_class_id and d.status = 'pending';
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.cancel_pending_class_messages(bigint) from public, anon, authenticated;
grant execute on function public.cancel_pending_class_messages(bigint) to authenticated;

comment on table app_private.sending_device_credentials is 'Secret hashes are never readable by app accounts; paired device proves possession for SMS claims.';
notify pgrst, 'reload schema';
commit;



