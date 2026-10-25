-- CYCLODASH — envoi sécurisé des séances par e-mail (TCX)
-- Préconditions : migrations 001, 002 et 003 appliquées.
-- Migration additive : aucune donnée existante n'est supprimée ou envoyée.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email_address TEXT,
    ADD COLUMN IF NOT EXISTS email_auto_send BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS email_format TEXT NOT NULL DEFAULT 'tcx';

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_email_address_format_check,
    ADD CONSTRAINT profiles_email_address_format_check CHECK (
        email_address IS NULL
        OR email_address ~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
    ),
    DROP CONSTRAINT IF EXISTS profiles_email_auto_requires_address_check,
    ADD CONSTRAINT profiles_email_auto_requires_address_check CHECK (
        email_auto_send = FALSE OR email_address IS NOT NULL
    ),
    DROP CONSTRAINT IF EXISTS profiles_email_format_check,
    ADD CONSTRAINT profiles_email_format_check CHECK (email_format = 'tcx');

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS email_auto_requested BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS email_recipient_snapshot TEXT;

ALTER TABLE public.sessions
    DROP CONSTRAINT IF EXISTS sessions_email_recipient_snapshot_check,
    ADD CONSTRAINT sessions_email_recipient_snapshot_check CHECK (
        email_recipient_snapshot IS NULL
        OR email_recipient_snapshot ~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
    ),
    DROP CONSTRAINT IF EXISTS sessions_email_auto_requires_recipient_check,
    ADD CONSTRAINT sessions_email_auto_requires_recipient_check CHECK (
        email_auto_requested = FALSE OR email_recipient_snapshot IS NOT NULL
    );

CREATE TABLE IF NOT EXISTS public.email_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    profile_id UUID NOT NULL,
    recipient TEXT NOT NULL,
    send_type TEXT NOT NULL CHECK (send_type IN ('automatic', 'manual')),
    file_format TEXT NOT NULL DEFAULT 'tcx' CHECK (file_format = 'tcx'),
    idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
        'queued', 'processing', 'accepted', 'delivered', 'delayed', 'failed', 'bounced', 'complained'
    )),
    provider_id TEXT,
    provider_status TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT email_deliveries_session_fk
        FOREIGN KEY (owner_id, session_id, profile_id)
        REFERENCES public.sessions(owner_id, id, profile_id)
        ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_owner_created
    ON public.email_deliveries(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_queue
    ON public.email_deliveries(status, next_attempt_at)
    WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS idx_email_deliveries_provider
    ON public.email_deliveries(provider_id)
    WHERE provider_id IS NOT NULL;

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_deliveries_owner_select" ON public.email_deliveries;
CREATE POLICY "email_deliveries_owner_select" ON public.email_deliveries
    FOR SELECT TO authenticated
    USING (auth.uid() = owner_id);

-- Les écritures passent exclusivement par les Edge Functions utilisant une
-- clé serveur. Aucun INSERT/UPDATE/DELETE direct n'est accordé au navigateur.

CREATE OR REPLACE FUNCTION public.queue_automatic_session_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.email_deliveries (
        owner_id, session_id, profile_id, recipient, send_type,
        file_format, idempotency_key, status
    )
    SELECT
        s.owner_id,
        s.id,
        s.profile_id,
        s.email_recipient_snapshot,
        'automatic',
        'tcx',
        'auto/' || s.owner_id || '/' || s.profile_id || '/' || s.id || '/tcx',
        'queued'
    FROM public.sessions s
    WHERE s.id = NEW.session_id
      AND s.owner_id = NEW.owner_id
      AND s.profile_id = NEW.profile_id
      AND s.email_auto_requested = TRUE
      AND s.email_recipient_snapshot IS NOT NULL
    ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_automatic_session_email() FROM PUBLIC;

DROP TRIGGER IF EXISTS trigger_queue_automatic_session_email ON public.session_data;
CREATE TRIGGER trigger_queue_automatic_session_email
    AFTER INSERT ON public.session_data
    FOR EACH ROW EXECUTE FUNCTION public.queue_automatic_session_email();

DROP TRIGGER IF EXISTS trigger_email_deliveries_updated_at ON public.email_deliveries;
CREATE TRIGGER trigger_email_deliveries_updated_at
    BEFORE UPDATE ON public.email_deliveries
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON COLUMN public.sessions.email_auto_requested IS
    'Instantané de l’option d’envoi automatique au moment de la fin de séance.';
COMMENT ON TABLE public.email_deliveries IS
    'File serveur idempotente des e-mails TCX. accepted signifie accepté par le prestataire, pas livré.';

COMMIT;

-- Rollback manuel (les profils et séances restent présents) :
-- DROP TRIGGER IF EXISTS trigger_queue_automatic_session_email ON public.session_data;
-- DROP FUNCTION IF EXISTS public.queue_automatic_session_email();
-- DROP TABLE IF EXISTS public.email_deliveries;
-- ALTER TABLE public.sessions DROP COLUMN IF EXISTS email_recipient_snapshot;
-- ALTER TABLE public.sessions DROP COLUMN IF EXISTS email_auto_requested;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS email_format;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS email_auto_send;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS email_address;
