-- PR #47 / exact restore of pre-hardening public RPC.
-- Source: read-only pg_get_functiondef from project zuczsheoixuwienbkprz, 2026-11-08.
-- No user data or secrets included. Use only on explicit rollback.
BEGIN;
CREATE OR REPLACE FUNCTION public.save_schedule_engine_state(p_expected_revision bigint, p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_revision bigint;
  v_previous jsonb;
  v_next_revision bigint;
begin
  if v_owner is null or
     coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'É necessário iniciar sessão com uma conta permanente.'
      using errcode = '28000';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Revisão inválida.' using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload ->> 'version' <> '4'
     or jsonb_typeof(p_payload -> 'people') <> 'array'
     or jsonb_typeof(p_payload -> 'availabilities') <> 'array'
     or jsonb_typeof(p_payload -> 'weeklyOperatingHours') <> 'object'
     or jsonb_typeof(p_payload -> 'exceptions') <> 'array'
     or jsonb_typeof(p_payload -> 'workRules') <> 'object'
     or jsonb_typeof(p_payload -> 'weeklyPresenceRequirements') <> 'object'
     or jsonb_typeof(p_payload -> 'presenceExceptions') <> 'array' then
    raise exception 'Formato de dados incompatível (é necessário v4).'
      using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 2000000 then
    raise exception 'Estado excede 2 MB.' using errcode = '22023';
  end if;

  -- Transaction-scoped, user-scoped lock also serializes first insert.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner::text, 0)
  );

  select revision, payload
    into v_revision, v_previous
    from public.schedule_engine_states
    where owner_id = v_owner
    for update;

  if not found then
    if p_expected_revision <> 0 then
      raise exception 'Conflito de revisão: a base foi alterada.'
        using errcode = '40001';
    end if;

    insert into public.schedule_engine_states
      (owner_id, revision, payload)
    values (v_owner, 1, p_payload);
    v_next_revision := 1;
  else
    if v_revision <> p_expected_revision then
      raise exception 'Conflito de revisão: a base foi alterada.'
        using errcode = '40001';
    end if;

    if jsonb_array_length(v_previous -> 'people') > 0
       and jsonb_array_length(p_payload -> 'people') = 0 then
      raise exception 'A gravação iria apagar todos os colaboradores.'
        using errcode = '22023';
    end if;

    if v_previous = p_payload then
      return v_revision;
    end if;

    update public.schedule_engine_states
      set revision = revision + 1,
          payload = p_payload,
          updated_at = now()
      where owner_id = v_owner
      returning revision into v_next_revision;
  end if;

  insert into public.schedule_engine_state_history
    (owner_id, revision, payload)
  values (v_owner, v_next_revision, p_payload);

  return v_next_revision;
end;
$function$

REVOKE ALL ON FUNCTION public.save_schedule_engine_state(bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_schedule_engine_state(bigint,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_schedule_engine_state(bigint,jsonb) TO authenticated;
COMMIT;
