alter table public.profiles
  alter column must_change_password set default false;

update public.profiles
set must_change_password = false
where must_change_password = true;
