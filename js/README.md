# Module JavaScript (js/)

Ce dossier regroupe l'ensemble de la logique applicative de CycloDash en JavaScript standard (ES6+), sans bundler, sans transpilation et sans framework externe.

---

## Organisation des fichiers

| Fichier | Rôle & Responsabilité |
| :--- | :--- |
| **`state.js`** | Déclaration de l'état réactif global (`state`), des seuils de fraîcheur et de la base d'entraînements (`config.workoutsDB`). Fournit également le générateur d'identifiants UUID v4 standard `createCycloDashId()`. |
| **`profiles.js`** | Gestion multi-profils (mode Kiosk) : modale de sélection obligatoire au démarrage (*"Qui pédale aujourd'hui ?"*), création/édition de profils (nom, FTP, couleur d'avatar, e-mail de notification), calcul des initiales et synchronisation avec Supabase. |
| **`bluetooth.js`** | Connexion Web Bluetooth Low Energy (GATT). Abonnement aux services normalisés `0x1818` (Cycling Power) et `0x1816` (Cycling Speed & Cadence), décodage des trames binaires, gestion des pertes de signal (`stale` après 6s) et simulateur de cycliste (mode démo). |
| **`session.js`** | Gestion de la séance en cours (démarrage, pause, arrêt). Horloge monotone, intégration trapézoïdale de l'énergie mécanique ($J \rightarrow kJ/kcal$) et de la distance, maintien de l'écran actif via l'API Screen Wake Lock et mise à jour du tracé en temps réel sur Chart.js. |
| **`workout.js`** | Moteur des séances d'entraînement par intervalles. Calcul des cibles de puissance personnalisées selon la FTP du profil, avancement des paliers d'effort et mise à jour de la jauge et de la roadmap. |
| **`training-library.js`** | Bibliothèque locale de 19 séances avec identifiants stables, objectifs, difficulté, durées et cibles en pourcentage de FTP. |
| **`ftp-estimator.js`** | Contrôle durée/couverture/cohérence, règle des 95 % sur 20 minutes, confiance et provenance. Ne modifie jamais silencieusement un profil. |
| **`training-recommendations.js`** | Classement prudent selon objectif, volume récent, disponibilité et ressentis, sans service externe. |
| **`training-feedback.js`** | Validation et persistance du ressenti avec vérification du profil propriétaire. |
| **`training-ui.js`** | Analyse FTP, décisions accepter/refuser/reporter, filtres et fin de séance. |
| **`gemini.js`** | Appel facultatif à l’Edge Function et validation stricte ; repli transparent sur le moteur local. |
| **`storage.js`** | Couche de stockage local hybride :<br>- `localDataStore` : partitionnement étanche des données par compte (`cyclodash:<ownerId>:<clé>`) avec support invité (`anonymous`).<br>- `cycloDb` : base IndexedDB (`cyclodash-data-v2`) dédiée aux séries temporelles haute fréquence de chaque seconde. |
| **`history.js`** | Historique des séances du profil actif, calcul des résumés, génération de fichiers XML TCX complets (compatibles Strava / Garmin), gestion de la file locale d'envoi cloud (`sync_queue`) et de suppression différée (`deletion_queue`). |
| **`analytics.js`** | Moteur mathématique d'analyse de performance (`CycloAnalytics`) : moyennes pondérées par le temps (tolérance aux échantillons irréguliers), variabilité, écart-type, coefficient de variation, détection des meilleurs efforts (5s, 1min, 5min, 20min), répartition par zones FTP et downsampling pour graphiques fluides. |
| **`session-detail.js`** | Contrôleur de la vue d'analyse détaillée d'une séance : chargement des données (IndexedDB puis secours Supabase), instanciation des graphiques Chart.js de puissance et de vitesse, rendu des badges de records et dialogue de confirmation. |
| **`email.js`** | Module d'expédition TCX par e-mail (`CycloEmail`) : dialogue d'envoi unitaire, suivi des statuts (`pending`, `sending`, `sent`, `failed`), file locale hors-ligne avec réexpédition automatique au retour du réseau (`online`). |
| **`supabase.js`** | Client REST et d'authentification natif pour Supabase sans SDK externe (conçu pour fonctionner sur les navigateurs légers et anciennes tablettes). Gestion des tokens JWT, auto-refresh transparent sur erreur 401 et requêtes CRUD avec Row Level Security. |
| **`main.js`** | Point d'entrée de l'application : initialisation au chargement du DOM, routage des onglets (Compteur, Dashboard, Entraînements, Historique, Paramètres), gestion des notifications toast et orchestration du cycle de vie du Service Worker. |
| **`vendor/chart.umd.js`** | Bibliothèque Chart.js autonome pré-packagée en UMD pour fonctionner entièrement hors-ligne sans connexion Internet. |

---

## Flux de données et cycle de vie d'une séance

```text
[Home Trainer BLE / Démo]
         │  (Trames binaires 0x1818 & 0x1816)
         ▼
  bluetooth.js ─────────────► state.js (currentWatts, currentSpeed, timestamps)
         │                         │
         ▼                         ▼
   session.js ◄────────────── workout.js (comparaison cible FTP)
  (Intégration J / m,              │
   Horloge monotone,               ▼
   Screen Wake Lock)         UI Compteur & Dashboard (affichage direct)
         │
         ▼ (À l'arrêt de la séance)
   history.js
   ├── IndexedDB (cycloDb) ──► Sauvegarde des séries temporelles (1 pt / sec)
   ├── LocalStorage ─────────► Résumé de session (moyennes, max, kJ, durée)
   └── File sync_queue ──────► Envoi asynchrone vers Supabase
                                   │
                                   ▼ (Si e-mail configuré)
                             email.js ──► Edge Function ──► Passerelle Gmail
```

---

## Notes techniques importantes

- **Sélection de profil obligatoire** : Au lancement, aucun profil n'est sélectionné par défaut afin d'éviter d'enregistrer une séance sur le compte d'un autre membre du foyer. Le cycliste valide son profil dans l'overlay Kiosk.
- **Calibration Elite Turno (Misuro B+)** : La constante `WHEEL_CIRCUMFERENCE_M` dans `state.js` est réglée à `0.165` mètre en raison de la démultiplication interne du volant d'inertie.
- **États de la liaison Bluetooth** : Les statuts `disconnected`, `connecting`, `connected` et `stale` qualifient exclusivement la couche BLE. Ils sont totalement indépendants de l'état de la séance (`sessionStatus` : `idle`, `recording`, `stopped`). L'arrêt d'une séance ne coupe pas la connexion Bluetooth.
- **Fraîcheur des données et seuil stale** : La puissance et la vitesse possèdent un horodatage individuel avec un seuil de validité de 5 secondes (`POWER_FRESHNESS_MS`). Tout silence radio supérieur à 6 secondes (`BLE_NOTIFICATION_STALE_MS`) passe la liaison en `stale` et remplace les valeurs par des tirets pour ne pas fausser les calculs d'énergie.
- **Horloge monotone vs Horloge système** : La durée réelle d'effort (`elapsedTime`) est dérivée de `performance.now()`, protégeant les calculs contre les ajustements d'heure système. Le temps `pedalingTime` ne comptabilise que les secondes avec activité détectée.
