-- ============================================================================
-- CYCLODASH BATCH 4 — MIGRATION : FTP historique par séance
-- Ajoute la colonne ftp_at_session_watts à la table sessions pour mémoriser
-- la FTP utilisée au moment du départ de chaque séance.
-- ============================================================================
-- Préconditions :
--   - 20261024_001_initial_schema.sql et 20261024_002_integrity_hardening.sql
--     déjà appliquées.
--   - Les données historiques ne sont PAS modifiées rétroactivement.
--     Les anciennes séances conserveront une valeur NULL pour cette colonne.
-- ============================================================================
-- Compatibilité :
--   - L'application fonctionne normalement même si cette migration n'a pas
--     encore été appliquée : le code client envoie ftp_at_session_watts dans
--     le payload, et Supabase/PostgreSQL ignore silencieusement les colonnes
--     inconnues lors d'un upsert REST (avec resolution=merge-duplicates).
--   - Pour les séances anciennes (NULL), l'application utilise la FTP actuelle
--     du profil avec un indicateur visuel « Zones estimées avec la FTP actuelle ».
-- ============================================================================

BEGIN;

-- 1. Ajout de la colonne (nullable, aucune modification des données existantes)
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS ftp_at_session_watts INTEGER
    CHECK (ftp_at_session_watts IS NULL OR (ftp_at_session_watts > 0 AND ftp_at_session_watts <= 600));

-- 2. Commentaire descriptif
COMMENT ON COLUMN public.sessions.ftp_at_session_watts IS
    'FTP du cycliste au moment du départ de la séance (watts). NULL pour les séances antérieures au Batch 4.';

COMMIT;

-- ============================================================================
-- Procédure de rollback (ne supprime aucune donnée de séance) :
-- ALTER TABLE public.sessions DROP COLUMN IF EXISTS ftp_at_session_watts;
-- ============================================================================
