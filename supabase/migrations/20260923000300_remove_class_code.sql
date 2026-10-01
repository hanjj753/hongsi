-- classes.id is the only class identifier. The development table must still be
-- empty so no manually assigned class code is silently discarded.
begin;

do $$
begin
  if exists (select 1 from public.classes limit 1) then
    raise exception 'classes must be empty before removing class_code';
  end if;
end
$$;

alter table public.classes drop column class_code;

commit;
