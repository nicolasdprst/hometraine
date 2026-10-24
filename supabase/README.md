# Configuration Supabase — CycloDash Kiosk V2

Ce dossier contient les migrations SQL et la documentation nécessaire pour le backend PostgreSQL / Supabase de CycloDash.

## Projet Supabase
- **URL du projet** : `https://vwdptlmmycpxobucctnj.supabase.co`
- **Clé d'API publique (Publishable/Anon)** : `sb_publishable_dr8rEtZLflaLNXzlpUg4ww_xcfpzSoF`

## Schéma des tables
1. **`public.profiles`** : Profils sportifs (nom, FTP, couleur d'avatar, statut archivé).
2. **`public.sessions`** : Résumés des séances (durée, distance, puissance moy/max, vitesse moy/max, kJ, kcal, entraînement).
3. **`public.session_data`** : Séries temporelles complètes (secondes, watts, km/h) stockées en format JSONB compact pour régénération ultérieure d'exports TCX sans coût d'IO excessif.

## Application de la migration
Pour appliquer la migration sur le projet Supabase :
1. Rendez-vous sur le [Tableau de bord Supabase](https://supabase.com/dashboard/project/vwdptlmmycpxobucctnj).
2. Ouvrez l'onglet **SQL Editor**.
3. Sur une nouvelle base seulement, exécutez `supabase/migrations/20261024_001_initial_schema.sql`.
4. Exécutez ensuite `supabase/migrations/20261024_002_integrity_hardening.sql`, y compris si la migration 001 avait déjà été appliquée.
5. La migration 002 vérifie les données existantes avant d'ajouter ses contraintes. Si elle signale une incohérence, examinez-la manuellement : aucune donnée ne doit être supprimée pour contourner le contrôle.
6. Dans **Authentication > Providers > Email**, activez l'authentification par e-mail. CycloDash prend en charge aussi bien la confirmation par e-mail activée que désactivée.

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
