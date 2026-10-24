-- CYCLODASH BATCH 2.1 — intégrité multi-tenant et RLS
-- Précondition : 20261024_001_initial_schema.sql déjà appliquée.
-- Cette migration ne supprime aucune donnée. Elle s'arrête si une incohérence existe.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.sessions s
        LEFT JOIN public.profiles p ON p.id = s.profile_id
        WHERE p.id IS NULL OR p.owner_id <> s.owner_id
    ) THEN
        RAISE EXCEPTION 'Migration interrompue: sessions avec profil absent ou propriétaire incohérent';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.session_data d
        LEFT JOIN public.sessions s ON s.id = d.session_id
        WHERE s.id IS NULL OR s.owner_id <> d.owner_id OR s.profile_id <> d.profile_id
    ) THEN
        RAISE EXCEPTION 'Migration interrompue: session_data incohérentes avec sessions';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_owner_id_id_key') THEN
        ALTER TABLE public.profiles ADD CONSTRAINT profiles_owner_id_id_key UNIQUE (owner_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_owner_id_id_profile_key') THEN
        ALTER TABLE public.sessions ADD CONSTRAINT sessions_owner_id_id_profile_key UNIQUE (owner_id, id, profile_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_owner_profile_fk') THEN
        ALTER TABLE public.sessions
            ADD CONSTRAINT sessions_owner_profile_fk
            FOREIGN KEY (owner_id, profile_id)
            REFERENCES public.profiles(owner_id, id)
            ON UPDATE RESTRICT ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_data_session_owner_profile_fk') THEN
        ALTER TABLE public.session_data
            ADD CONSTRAINT session_data_session_owner_profile_fk
            FOREIGN KEY (owner_id, session_id, profile_id)
            REFERENCES public.sessions(owner_id, id, profile_id)
            ON UPDATE RESTRICT ON DELETE CASCADE;
    END IF;
END $$;

DROP POLICY IF EXISTS "sessions_owner_update" ON public.sessions;
CREATE POLICY "sessions_owner_update" ON public.sessions
    FOR UPDATE TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = sessions.profile_id AND p.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "session_data_owner_insert" ON public.session_data;
CREATE POLICY "session_data_owner_insert" ON public.session_data
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.sessions s
            WHERE s.id = session_data.session_id
              AND s.owner_id = auth.uid()
              AND s.profile_id = session_data.profile_id
        )
    );

DROP POLICY IF EXISTS "session_data_owner_update" ON public.session_data;
CREATE POLICY "session_data_owner_update" ON public.session_data
    FOR UPDATE TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.sessions s
            WHERE s.id = session_data.session_id
              AND s.owner_id = auth.uid()
              AND s.profile_id = session_data.profile_id
        )
    );

COMMIT;

-- Retour arrière manuel (ne supprime pas les données) :
-- ALTER TABLE public.session_data DROP CONSTRAINT IF EXISTS session_data_session_owner_profile_fk;
-- ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_owner_profile_fk;
-- ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_owner_id_id_profile_key;
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_owner_id_id_key;
-- Puis restaurer les politiques UPDATE de la migration 001 si nécessaire.
