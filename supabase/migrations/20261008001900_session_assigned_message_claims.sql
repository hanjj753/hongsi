-- A worker assigned to one session may send that session's queued messages.
-- A claim must check each message's session, not class-wide staffing alone.
begin;

create or replace function public.claim_next_message_delivery(target_class_id bigint,target_device_id uuid,device_secret text)
returns table(message_id text,recipient_type text,phone text,content text)
language plpgsql security definer set search_path = '' as $$
declare picked record;
begin
  if app_private.current_app_role() is null then
    raise exception 'Approved account required' using errcode = '42501';
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
      and app_private.can_access_class_messages(m.class_id,m.session_id)
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

notify pgrst, 'reload schema';
commit;