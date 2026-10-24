-- Cancel only pending recipients of one message. Deliveries already claimed
-- by a sending device, or submitted to Android, keep their audit status.
begin;

create function public.cancel_pending_message(target_message_id bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target_class_id bigint;
  target_session_id bigint;
  changed integer;
begin
  select class_id,session_id into target_class_id,target_session_id
    from public.messages where id = target_message_id;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  if not app_private.can_access_class_messages(target_class_id,target_session_id) then
    raise exception 'Class messaging access denied' using errcode = '42501';
  end if;
  update public.message_deliveries set status = 'cancelled',updated_at = statement_timestamp()
    where message_id = target_message_id and status = 'pending';
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.cancel_pending_message(bigint) from public, anon, authenticated;
grant execute on function public.cancel_pending_message(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
