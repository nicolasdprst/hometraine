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
3. Copiez et collez le contenu du fichier `supabase/migrations/20261024_001_initial_schema.sql`.
4. Cliquez sur **Run** pour exécuter le script.
5. Dans **Authentication > Providers > Email**, vérifiez que l'authentification par email est activée (option "Confirm email" recommandée désactivée pour un usage kiosque local fluide sans attente d'email).

## Sécurité et RLS
- RLS (Row Level Security) est activé sur toutes les tables (`profiles`, `sessions`, `session_data`).
- L'isolation est stricte par compte d'installation (`auth.uid() = owner_id`).
- Une séance ne peut être rattachée qu'à un profil appartenant au même compte d'installation.
