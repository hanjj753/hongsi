-- A transferred enrollment is historical. Returning to a previous class must
-- be another transfer from the current class, while direct reactivation is
-- reserved for a withdrawn enrollment.
begin;

create or replace function public.reactivate_student(
  target_class_id bigint,
  target_student_id bigint,
  new_joined_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.can_manage() then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if new_joined_on is null then
    raise exception 'Start date is required' using errcode = '23514';
  end if;
  update public.enrollments set
    enrollment_status = 'active', joined_on = new_joined_on, ended_on = null,
    transferred_to_class_id = null, status_changed_on = new_joined_on
  where class_id = target_class_id and student_id = target_student_id
    and enrollment_status = 'withdrawn';
  if not found then raise exception 'Withdrawn enrollment not found' using errcode = 'P0002'; end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
