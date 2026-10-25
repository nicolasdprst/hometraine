# Suite de Tests Automatisés — CycloDash

Ce dossier contient la suite de tests automatisés validant la logique métier, l'intégrité des calculs, la résilience hors-ligne, les exports TCX et la sécurité multi-profils de CycloDash.

---

## Philosophie des tests

L'application CycloDash étant conçue en JavaScript standard sans framework ni bundler lourd, la suite de tests suit la même philosophie d'extrême légèreté :
- **Exécution ultra-rapide** : l'ensemble des 6 suites de tests s'exécute en moins de 2 secondes avec le moteur Node.js natif.
- **Zéro dépendance npm requise** : les tests utilisent les modules standards de Node.js (`assert`, `fs`, `path`, `vm`, `crypto`).
- **Isolation via `node:vm`** : le code source de l'application (`js/state.js`, `js/storage.js`, `js/history.js`, `js/analytics.js`, etc.) est exécuté directement dans des contextes sandboxés simulant les APIs du navigateur (DOM minimal, `localStorage`, `navigator`, `indexedDB`, horloges de performance) sans avoir besoin d'installer de navigateur headless lourd (Puppeteer, Playwright).

---

## Lancer les tests

Les tests s'exécutent avec n'importe quelle version récente de Node.js (Node 16+) :

### Exécuter l'ensemble de la suite
```bash
node tests/test_batch1_1.js && \
node tests/test_batch2_logic.js && \
node tests/test_batch2_1_real_code.js && \
node tests/test_batch3_ux.js && \
node tests/test_batch4_analytics.js && \
node tests/test_email_tcx.js
```

### Exécuter un test individuel
```bash
node tests/test_batch4_analytics.js
```

---

## Détail des fichiers de test

| Fichier | Domaine testé | Points clés validés |
| :--- | :--- | :--- |
| **`test_batch1_1.js`** | Cycle de vie BLE & UI | - Synchronisation des boutons d'interface (Connecter, Démarrer, Arrêter)<br>- Anti-rebond et unicité de la boucle démo<br>- Générateur d'UUID v4 standard de secours (`createCycloDashId`)<br>- Règles de fraîcheur des données capteurs |
| **`test_batch2_logic.js`** | Logique métier & TCX | - Génération du flux XML TCX conforme Garmin/Strava (Trackpoints, TPX Watts & Speed, Calories)<br>- Isolation stricte des données entre profils cyclistes<br>- Calculs de moyennes pondérées et respect de l'idempotence |
| **`test_batch2_1_real_code.js`** | Intégration du code réel | - Exécution directe de `js/storage.js`, `js/history.js`, `js/supabase.js` en bac à sable<br>- Synchronisation Supabase et traitement de la file `sync_queue`<br>- Résilience aux coupures réseau et mode déconnecté |
| **`test_batch3_ux.js`** | Expérience Kiosk Multi-profils | - Affichage obligatoire du sélecteur "Qui pédale aujourd'hui ?" au démarrage<br>- Changement de profil actif sans fuite d'état en mémoire<br>- Gestion de la file de suppression différée (`deletion_queue`) |
| **`test_batch4_analytics.js`** | Moteur d'analyse de performance | - Moyennes pondérées par la durée réelle inter-points (échantillonnage irrégulier)<br>- Variabilité, écart-type et coefficient de variation (CV)<br>- Meilleurs efforts sur fenêtres glissantes (5s, 60s, 300s, 1200s)<br>- Performance : analyse de 7 200 points (séance de 2h) en moins de 150 ms<br>- Répartition rigoureuse du temps par zones d'intensité FTP (Z1 à Z6)<br>- Robustesse face aux valeurs nulles, corrompues ou incomplètes |
| **`test_email_tcx.js`** | Passerelle E-mail & Automatisations | - Déduplication et idempotence de la file d'attente locale `email_queue`<br>- Envoi automatique conditionné à la réussite de la synchronisation cloud<br>- Validation stricte des adresses e-mail destinataires<br>- Reprise sur incident réseau (retry) au rétablissement de la connexion (`online`)<br>- Vérification de la compatibilité des schémas SQL Supabase |

---

## Bonnes pratiques pour l'ajout de tests

1. Ne pas introduire de bibliothèques tierces (Jest, Mocha) : conserver le module natif `assert`.
2. Charger les fichiers JavaScript applicatifs de `js/` via la méthode `loadScript()` ou `vm.runInContext()` pour garantir que le test valide le code réel de production.
3. Vérifier les cas limites (valeurs `null`, déconnexions inattendues, tableaux vides, horodatages désordonnés).
