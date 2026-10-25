# Configuration Supabase — CycloDash Kiosk V2

Ce dossier contient les migrations SQL et la documentation nécessaire pour le backend PostgreSQL / Supabase de CycloDash.

## Projet Supabase
- **URL du projet** : `https://vwdptlmmycpxobucctnj.supabase.co`
- **Clé d'API publique (Publishable/Anon)** : `sb_publishable_dr8rEtZLflaLNXzlpUg4ww_xcfpzSoF`

## Schéma des tables
1. **`public.profiles`** : Profils sportifs (nom, FTP, couleur, e-mail TCX et option d'envoi automatique).
2. **`public.sessions`** : Résumés des séances, avec l'instantané non rétroactif de la demande d'e-mail.
3. **`public.session_data`** : Séries temporelles complètes (secondes, watts, km/h) stockées en format JSONB compact pour régénération ultérieure d'exports TCX sans coût d'IO excessif.
4. **`public.email_deliveries`** : File d'envoi Gmail idempotente (`pending`, `sending`, `sent`, `failed`).

## Application de la migration
Pour appliquer la migration sur le projet Supabase :
1. Rendez-vous sur le [Tableau de bord Supabase](https://supabase.com/dashboard/project/vwdptlmmycpxobucctnj).
2. Ouvrez l'onglet **SQL Editor**.
3. Sur une nouvelle base seulement, exécutez `supabase/migrations/20261024_001_initial_schema.sql`.
4. Exécutez ensuite `supabase/migrations/20261024_002_integrity_hardening.sql`, y compris si la migration 001 avait déjà été appliquée.
5. La migration 002 vérifie les données existantes avant d'ajouter ses contraintes. Si elle signale une incohérence, examinez-la manuellement : aucune donnée ne doit être supprimée pour contourner le contrôle.
6. Exécutez `supabase/migrations/20261024_003_session_analytics.sql`, puis `supabase/migrations/20261025_004_profile_email_delivery.sql`.
7. Si la migration 004 est déjà appliquée, exécutez ensuite `supabase/migrations/20261025_005_simplify_email_statuses.sql`. Elle conserve toutes les colonnes et convertit seulement les anciens états Resend vers les quatre états Gmail.
8. Dans **Authentication > Providers > Email**, activez l'authentification par e-mail. CycloDash prend en charge aussi bien la confirmation par e-mail activée que désactivée.

La clé présente dans `js/supabase.js` est une clé publique/publishable. N'ajoutez jamais de clé `service_role` au dépôt ou au navigateur.

## Retour arrière Batch 2.1

Les commandes de retrait des contraintes sont documentées à la fin de la migration 002. Effectuez un export de la base avant tout rollback. Le rollback SQL ne supprime aucune séance, mais réduit les garanties d'intégrité : il ne doit être utilisé qu'en cas de nécessité diagnostiquée.

## Validation RLS

Les tests RLS multi-comptes doivent être exécutés sur une instance Supabase de test avec deux utilisateurs réels. Les tests Node locaux ne peuvent pas certifier les politiques PostgreSQL distantes.

## Sécurité et RLS
- RLS (Row Level Security) est activé sur toutes les tables (`profiles`, `sessions`, `session_data`).
- L'isolation est stricte par compte d'installation (`auth.uid() = owner_id`).
- Une séance ne peut être rattachée qu'à un profil appartenant au même compte d'installation.
- Les contraintes composites garantissent aussi cette cohérence lors des `UPDATE` et des upserts de `session_data`.

## Envoi TCX gratuit par Gmail

Le guide pas à pas destiné à un débutant se trouve dans
`google-apps-script/README.md`. Le code à copier dans Google Apps Script est
`google-apps-script/Code.gs`.

1. Déployer le script comme application Web exécutée par le compte Gmail, puis récupérer son URL `/exec`.
2. Copier `supabase/functions/.env.example` vers `supabase/functions/.env`, compléter les trois valeurs sans committer ce fichier, puis enregistrer les secrets :

   ```sh
   supabase secrets set --env-file supabase/functions/.env
   ```

3. Déployer uniquement les deux fonctions utiles :

   ```sh
   supabase functions deploy send-session-email
   supabase functions deploy process-email-queue --no-verify-jwt
   ```

4. Planifier toutes les minutes un `POST` vers
   `https://vwdptlmmycpxobucctnj.supabase.co/functions/v1/process-email-queue` avec l'en-tête `x-worker-secret` égal à `EMAIL_WORKER_SECRET`. Utilisez Supabase Cron ou un ordonnanceur de confiance ; n'inscrivez jamais ce secret dans une migration ou dans le navigateur.

Variables requises :

- `GOOGLE_SCRIPT_URL` : URL `/exec` de l'application Web Apps Script ;
- `GOOGLE_SCRIPT_SECRET` : secret partagé, également placé dans la propriété `HOMETRAINE_SHARED_SECRET` du script ;
- `EMAIL_WORKER_SECRET` : protège le worker planifié ;

Supabase fournit automatiquement `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` aux fonctions hébergées. Les nouveaux noms `SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY` sont également acceptés.

### Sémantique et limites

- `sent` signifie que `MailApp.sendEmail()` a accepté la demande ; aucune livraison au destinataire n'est affirmée.
- Les envois automatiques sont uniques par compte, profil, séance et format. Un nouvel envoi manuel reste possible et possède sa propre clé.
- Les demandes manuelles sont limitées à 10 par heure et tous les envois à 30 par jour et par compte. Le worker effectue au plus huit tentatives avec attente exponentielle.
- Le script refuse les appels sans secret, limite la taille des pièces jointes et garde lui aussi les clés idempotentes.
- Les tests locaux utilisent des mocks et n'envoient aucun vrai e-mail. Un test Gmail/Outlook et l'import Strava final doivent être réalisés uniquement avec des adresses consentantes.
