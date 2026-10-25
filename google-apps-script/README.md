# Passerelle Gmail HomeTraine — guide simple

Cette passerelle gratuite reçoit uniquement les demandes signées de Supabase et
envoie le TCX avec le compte Google qui autorise le script.

## Ce qui est déjà fait et ce qui reste à faire

Le code HomeTraine, les deux Edge Functions, la file d'attente et les tests sont
déjà préparés dans le dépôt. Les opérations suivantes nécessitent votre action,
car elles demandent une connexion personnelle à Google et Supabase : créer le
script, autoriser Gmail, enregistrer les secrets, exécuter la migration 005,
déployer les fonctions et activer le Cron.

## 1. Créer le script

1. Ouvrir <https://script.google.com> avec le compte Gmail expéditeur.
2. Cliquer **Nouveau projet** et le nommer `HomeTraine Mail`.
3. Remplacer le contenu de `Code.gs` par celui du fichier `Code.gs` de ce dossier.
4. Enregistrer.

## 2. Enregistrer le secret partagé

Générer deux secrets différents avec `openssl rand -hex 32`. Dans Apps Script :

1. Ouvrir **Paramètres du projet** (roue dentée).
2. Dans **Propriétés du script**, ajouter :
   - propriété : `HOMETRAINE_SHARED_SECRET`
   - valeur : le premier secret généré.
3. Enregistrer. Ne jamais coller ce secret dans `Code.gs`.

## 3. Déployer et autoriser Gmail

1. En haut de l'éditeur, sélectionner la fonction `authorizeHomeTraine`, puis
   cliquer **Exécuter**. Accepter l'autorisation d'envoyer des e-mails. Cette
   fonction vérifie uniquement le quota et n'envoie aucun message.
2. Cliquer **Déployer → Nouveau déploiement**.
3. Choisir **Application Web**.
4. Exécuter en tant que : **Moi**.
5. Qui a accès : **Tout le monde** (y compris les utilisateurs non connectés).
   L'URL doit être joignable par Supabase, mais toute requête sans le secret
   partagé est refusée.
6. Cliquer **Déployer**.
7. Copier l'URL terminée par `/exec` (pas l'URL `/dev`).

Après une modification de `Code.gs`, créer une **nouvelle version** du
déploiement ; enregistrer le fichier seul ne met pas l'application Web à jour.

## 4. Configurer Supabase

Dans **Edge Functions → Secrets**, ajouter :

- `GOOGLE_SCRIPT_URL` : URL `/exec` copiée ;
- `GOOGLE_SCRIPT_SECRET` : même valeur que `HOMETRAINE_SHARED_SECRET` ;
- `EMAIL_WORKER_SECRET` : second secret généré, différent du premier.

Puis appliquer la migration `20261025_005_simplify_email_statuses.sql` et
déployer uniquement `send-session-email` et `process-email-queue`.

Depuis la racine du dépôt :

```sh
npx supabase login
npx supabase link --project-ref vwdptlmmycpxobucctnj
npx supabase secrets set \
  GOOGLE_SCRIPT_URL='URL_EXEC_COPIEE' \
  GOOGLE_SCRIPT_SECRET='PREMIER_SECRET' \
  EMAIL_WORKER_SECRET='SECOND_SECRET'
npx supabase functions deploy send-session-email
npx supabase functions deploy process-email-queue --no-verify-jwt
```

La migration 005 doit être collée dans **Supabase → SQL Editor** et exécutée
avant le premier envoi. Elle ne supprime aucune colonne ni aucune séance.

## 5. Activer le traitement automatique

Dans **Supabase → Integrations → Vault**, créer deux secrets :

- `cyclodash_project_url` = `https://vwdptlmmycpxobucctnj.supabase.co`
- `cyclodash_email_worker_secret` = exactement le `SECOND_SECRET`

Activer ensuite **Integrations → Cron**, puis exécuter dans SQL Editor :

```sql
SELECT cron.schedule(
    'cyclodash-process-email-queue',
    '* * * * *',
    $$
    SELECT net.http_post(
        url := (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'cyclodash_project_url' LIMIT 1
        ) || '/functions/v1/process-email-queue',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (
                SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'cyclodash_email_worker_secret' LIMIT 1
            )
        ),
        body := '{}'::jsonb
    );
    $$
);
```

Le worker vérifie la file chaque minute. C'est ce qui permet de ranger ou
fermer le vieux téléphone après la synchronisation.

## 6. Premier test

Utiliser dans HomeTraine une séance synchronisée appartenant au profil actif,
cliquer **Envoyer par e-mail** et saisir sa propre adresse autorisée. Vérifier :

- le mail et sa pièce jointe TCX ;
- **Apps Script → Exécutions** ;
- **Supabase → Edge Functions → Logs** ;
- la ligne correspondante dans `email_deliveries`, avec `status = sent`.

`sent` signifie que `MailApp.sendEmail()` a accepté la demande, pas que le
serveur du destinataire l'a effectivement livrée.

Faire d'abord un test vers l'adresse Gmail du propriétaire du script, puis un
second vers une adresse Outlook consentante. Aucun test automatique du dépôt
n'envoie réellement de mail.
