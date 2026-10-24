-- ============================================================================
-- CYCLODASH BATCH 2 — MIGRATION INITIALE SUPABASE POSTGRESQL
-- Multi-profils, Séances & Séries temporelles avec RLS stricte
-- ============================================================================

-- Activer l'extension pgcrypto pour gen_random_uuid() si nécessaire
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TABLE : PROFILES (Profils sportifs de l'installation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) > 0),
    ftp_watts INTEGER DEFAULT 200 CHECK (ftp_watts > 0 AND ftp_watts <= 600),
    avatar_color TEXT DEFAULT '#3b82f6',
    is_archived BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index pour accélérer la recherche des profils d'une installation
CREATE INDEX IF NOT EXISTS idx_profiles_owner_id ON public.profiles(owner_id);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON public.profiles(owner_id) WHERE is_archived = FALSE;

-- ----------------------------------------------------------------------------
-- 2. TABLE : SESSIONS (Résumé des séances de sport)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
    avg_power_watts DOUBLE PRECISION DEFAULT 0,
    max_power_watts DOUBLE PRECISION DEFAULT 0,
    avg_speed_kmh DOUBLE PRECISION DEFAULT 0,
    max_speed_kmh DOUBLE PRECISION DEFAULT 0,
    total_work_kj DOUBLE PRECISION DEFAULT 0,
    energy_kcal DOUBLE PRECISION DEFAULT 0,
    workout_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index pour charger rapidement l'historique d'un profil spécifique
CREATE INDEX IF NOT EXISTS idx_sessions_profile_started ON public.sessions(profile_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_owner_started ON public.sessions(owner_id, started_at DESC);

-- ----------------------------------------------------------------------------
-- 3. TABLE : SESSION_DATA (Séries temporelles pour exports TCX)
-- Stocke les mesures détaillées en JSONB compact
-- { time: [], timestamps: [], watts: [], speed: [], distance: [] }
-- Évite 1 requête HTTP par seconde et préserve les quotas gratuits de Supabase
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_data (
    session_id UUID PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_data_owner ON public.session_data(owner_id);
CREATE INDEX IF NOT EXISTS idx_session_data_profile ON public.session_data(profile_id);

-- ----------------------------------------------------------------------------
-- 4. SÉCURITÉ : ROW LEVEL SECURITY (RLS)
-- Aucune table n'est accessible publiquement sans authentification valide
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_data ENABLE ROW LEVEL SECURITY;

-- Politiques RLS pour PROFILES
-- Seul l'utilisateur propriétaire du compte d'installation peut voir ses profils
DROP POLICY IF EXISTS "profiles_owner_select" ON public.profiles;
CREATE POLICY "profiles_owner_select" ON public.profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "profiles_owner_insert" ON public.profiles;
CREATE POLICY "profiles_owner_insert" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "profiles_owner_update" ON public.profiles;
CREATE POLICY "profiles_owner_update" ON public.profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "profiles_owner_delete" ON public.profiles;
CREATE POLICY "profiles_owner_delete" ON public.profiles
    FOR DELETE TO authenticated
    USING (auth.uid() = owner_id);

-- Politiques RLS pour SESSIONS
-- Isolation stricte + intégrité relationnelle (le profile_id doit appartenir à owner_id)
DROP POLICY IF EXISTS "sessions_owner_select" ON public.sessions;
CREATE POLICY "sessions_owner_select" ON public.sessions
    FOR SELECT TO authenticated
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "sessions_owner_insert" ON public.sessions;
CREATE POLICY "sessions_owner_insert" ON public.sessions
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() = owner_id 
        AND EXISTS (
            SELECT 1 FROM public.profiles p 
            WHERE p.id = sessions.profile_id AND p.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "sessions_owner_update" ON public.sessions;
CREATE POLICY "sessions_owner_update" ON public.sessions
    FOR UPDATE TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "sessions_owner_delete" ON public.sessions;
CREATE POLICY "sessions_owner_delete" ON public.sessions
    FOR DELETE TO authenticated
    USING (auth.uid() = owner_id);

-- Politiques RLS pour SESSION_DATA
DROP POLICY IF EXISTS "session_data_owner_select" ON public.session_data;
CREATE POLICY "session_data_owner_select" ON public.session_data
    FOR SELECT TO authenticated
    USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "session_data_owner_insert" ON public.session_data;
CREATE POLICY "session_data_owner_insert" ON public.session_data
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.sessions s 
            WHERE s.id = session_data.session_id AND s.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "session_data_owner_update" ON public.session_data;
CREATE POLICY "session_data_owner_update" ON public.session_data
    FOR UPDATE TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "session_data_owner_delete" ON public.session_data;
CREATE POLICY "session_data_owner_delete" ON public.session_data
    FOR DELETE TO authenticated
    USING (auth.uid() = owner_id);

-- ----------------------------------------------------------------------------
-- 5. TRIGGER : Mise à jour automatique de updated_at sur profiles
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
