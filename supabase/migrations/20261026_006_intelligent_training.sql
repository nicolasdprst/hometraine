-- Migration additive : les anciennes valeurs (dont 200 W) sont conservées et marquées non vérifiées.
ALTER TABLE public.profiles ALTER COLUMN ftp_watts DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN ftp_watts DROP NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ftp_origin TEXT NOT NULL DEFAULT 'legacy_unknown';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ftp_confidence TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ftp_last_evaluated_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ftp_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ftp_pending_estimate JSONB;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS training_goal TEXT NOT NULL DEFAULT 'general_progress';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sessions_per_week SMALLINT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS session_duration_minutes SMALLINT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS intensity_preference TEXT NOT NULL DEFAULT 'balanced';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_ftp_origin_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_ftp_origin_check CHECK (ftp_origin IN ('unknown','legacy_unknown','manual','estimated','test'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_ftp_confidence_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_ftp_confidence_check CHECK (ftp_confidence IN ('unknown','manual','faible','moyen','élevé'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_training_goal_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_training_goal_check CHECK (training_goal IN ('restart','endurance','general_progress','ftp','performance'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_intensity_preference_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_intensity_preference_check CHECK (intensity_preference IN ('gentle','balanced','intense'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_sessions_per_week_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_sessions_per_week_check CHECK (sessions_per_week IS NULL OR sessions_per_week BETWEEN 1 AND 7);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_session_duration_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_session_duration_check CHECK (session_duration_minutes IS NULL OR session_duration_minutes BETWEEN 10 AND 300);

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS active_duration_seconds INTEGER;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS reliable_data_seconds INTEGER;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS workout_id TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS feedback_rating TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ;
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_feedback_rating_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_feedback_rating_check CHECK (feedback_rating IS NULL OR feedback_rating IN ('very_easy','easy','appropriate','difficult','too_difficult'));

CREATE TABLE IF NOT EXISTS public.ai_recommendation_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_owner_created ON public.ai_recommendation_usage(owner_id, created_at DESC);
ALTER TABLE public.ai_recommendation_usage ENABLE ROW LEVEL SECURITY;
