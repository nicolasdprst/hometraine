-- CYCLODASH — simplification Gmail / Google Apps Script
-- Précondition : migration 004 déjà appliquée.
-- Migration non destructive : les colonnes historiques sont conservées.

BEGIN;

ALTER TABLE public.email_deliveries
    DROP CONSTRAINT IF EXISTS email_deliveries_status_check;

UPDATE public.email_deliveries
SET next_attempt_at = CASE
        WHEN status = 'delayed' AND next_attempt_at IS NULL THEN now()
        ELSE next_attempt_at
    END,
    status = CASE status
    WHEN 'queued' THEN 'pending'
    WHEN 'processing' THEN 'sending'
    WHEN 'accepted' THEN 'sent'
    WHEN 'delivered' THEN 'sent'
    WHEN 'delayed' THEN 'pending'
    WHEN 'bounced' THEN 'failed'
    WHEN 'complained' THEN 'failed'
    ELSE status
END;

ALTER TABLE public.email_deliveries
    ALTER COLUMN status SET DEFAULT 'pending',
    ADD CONSTRAINT email_deliveries_status_check
        CHECK (status IN ('pending', 'sending', 'sent', 'failed'));

DROP INDEX IF EXISTS public.idx_email_deliveries_queue;
CREATE INDEX idx_email_deliveries_queue
    ON public.email_deliveries(status, next_attempt_at)
    WHERE status IN ('pending', 'failed');

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
        'pending'
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

COMMENT ON TABLE public.email_deliveries IS
    'File Gmail idempotente. sent signifie accepté par MailApp, pas livré au destinataire.';

COMMIT;

-- Les colonnes provider_id, provider_status, accepted_at et delivered_at sont
-- volontairement conservées pour ne supprimer aucune donnée issue de la 004.
