-- Extend student registration and editing to approved staff without replacing existing function logic.
-- This keeps production-only fixes in the current function bodies intact.
begin;

do $migration$
declare
  function_id regprocedure;
  definition text;
  guard_pattern constant text := 'if[[:space:]]+not[[:space:]]+app_private[.]can_manage[(][)][[:space:]]*then';
begin
  foreach function_id in array array[
    'public.register_student_and_enroll(bigint,bigint,text,text,text,text,text,text,date)'::regprocedure,
    'public.update_enrollment_start_date(bigint,bigint,date)'::regprocedure,
    'public.update_student_and_enrollment(bigint,bigint,text,text,text,text,text,text,date)'::regprocedure
  ] loop
    definition := pg_get_functiondef(function_id);
    if definition !~* guard_pattern then
      if definition ~* 'if[[:space:]]+app_private[.]current_app_role[(][)][[:space:]]+is[[:space:]]+null[[:space:]]+then' then
        continue;
      end if;
      raise exception 'Expected manager guard not found in %', function_id;
    end if;
    definition := regexp_replace(definition, guard_pattern,
      'if app_private.current_app_role() is null then', 'i');
    definition := replace(definition, 'Manager or administrator access required',
      'Approved staff access required');
    execute definition;
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
