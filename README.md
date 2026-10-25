# CycloDash

Tableau de bord web pour home trainer connecté. L'application se connecte directement au home trainer via l'API Web Bluetooth du navigateur, sans compte obligatoire, sans serveur distant requis et sans aucun abonnement.

---

## Motivation

La plupart des applications du marché (Zwift, applications propriétaires des fabricants, etc.) sont souvent lourdes à charger, bourrées de dépendances, avec des abonnements mensuels, un compte obligatoire et aucune possibilité de comprendre ou réparer le code quand un capteur se déconnecte. Sur une vieille tablette posée sur le guidon au fond du garage, ça rame ou ça plante.

Ce projet part d'un besoin simple :
- Se connecter directement au home trainer en Bluetooth depuis le navigateur, sans intermédiaire.
- Zéro abonnement, zéro compte imposé, aucune donnée envoyée sur un serveur distant si vous ne le souhaitez pas.
- Une base de code légère en JavaScript pur, lisible, modifiable et facile à déboguer.

---

## Fonctionnalités

### Pilotage en direct & Ergonomie Kiosk
- **Connexion Bluetooth Low Energy directe** aux home trainers et capteurs compatibles (profils normalisés *Cycling Power* `0x1818` et *Cycling Speed/Cadence* `0x1816`).
- **Mode Compteur Kiosk AMOLED** : interface épurée à très haut contraste conçue pour smartphone/tablette sur guidon (fond noir `#000000` économe en batterie, chiffres géants lisibles en plein effort).
- **Maintien de l'écran allumé (Screen Wake Lock API)** : empêche la mise en veille automatique de la tablette ou du smartphone pendant la séance.
- **Affichage télémétrique temps réel** : puissance instantanée en watts, vitesse estimée ou mesurée, cadence et travail mécanique intégré ($kJ$ et $kcal$).
- **Suivi d'entraînements par intervalles** : séances prédéfinies (*Warmup & Endurance*, *Intervalles 30/30*, *Sweet Spot*) avec calcul dynamique des cibles de puissance et jauge de progression.
- **Zones d'intensité FTP personnalisées** : calcul automatique et repères visuels colorés des 6 zones d'effort (Z1 Récupération à Z6 Anaérobie) selon votre FTP.
- **Graphique interactif temps réel** : tracé dynamique de l'effort via Chart.js.
- **Mode démo intégré** : simulation d'un cycliste virtuel sur le plat pour tester l'interface et les entraînements sans capteur physique branché.

### Multi-Profils & Organisation
- **Sélecteur Kiosk *"Qui pédale aujourd'hui ?"*** : dialogue plein écran au démarrage permettant à chaque membre du foyer de sélectionner son profil avant de pédaler.
- **Profils individuels étanches** : réglage de la FTP personnelle, couleur d'avatar personnalisée, adresse e-mail pour export et isolation stricte des historiques.

### Analyse de Performance & Fiche de Séance
- **Moteur d'analyse avancé (`CycloAnalytics`)** : calcul des moyennes pondérées par le temps réel inter-mesures (résistant aux timestamps irréguliers), écart-type, variabilité et coefficient de variation (CV).
- **Courbe de records de puissance (Best Efforts)** : détection automatique des pics de puissance maximale sur 5 secondes, 1 minute, 5 minutes et 20 minutes.
- **Histogramme de répartition par zones** : calcul précis du temps passé dans chaque zone d'intensité FTP (Z1 à Z6 avec frontières strictes).
- **Fiche détaillée interactive** : consultation post-séance avec bascule de graphiques (puissance / vitesse) et downsampling algorithmique pour un affichage instantané.

### Sauvegarde, Exports & Passerelle E-mail
- **Stockage hybride Offline-First** :
  - `LocalStorage` cloisonné par compte pour les profils et les résumés d'activités ;
  - `IndexedDB` (`cyclodash-data-v2`) pour l'enregistrement seconde par seconde des séries temporelles complètes.
- **Export TCX conforme Strava / Garmin** : génération instantanée de fichiers XML Training Center Database (`.tcx`) intégrant les Trackpoints, l'extension TPX (Watts et Vitesse), la distance cumulée et les calories.
- **Expédition e-mail TCX gratuite (Passerelle Gmail)** : réception automatique ou manuelle de son fichier TCX par e-mail à la fin de la séance, via une passerelle Google Apps Script sans coût d'infrastructure.
- **Synchronisation Cloud optionnelle (Supabase)** : synchronisation multi-appareils sécurisée par Row Level Security (RLS) avec gestion de files d'attente déconnectées (`sync_queue` et `deletion_queue`).
- **Application Web Progressive (PWA)** : installable sur l'écran d'accueil et 100% fonctionnelle hors-ligne grâce au Service Worker avec stratégie de mise en cache dédiée.

---

## Démarrage rapide

L'application ne nécessite aucun build (pas de Webpack, Vite ou Babel) ni installation de dépendances Node pour fonctionner. C'est du HTML, CSS et JavaScript natif standard.

> [!IMPORTANT]
> Pour utiliser l'API Web Bluetooth, les navigateurs imposent d'exécuter l'application sur `localhost` ou sur une adresse sécurisée `HTTPS`.

### 1. Cloner le dépôt

```bash
git clone https://github.com/votre-compte/cyclodash.git
cd cyclodash
```

### 2. Démarrer un serveur local

Avec Python 3 :
```bash
python -m http.server 8000
```

Ou avec Node.js :
```bash
npx serve .
```

### 3. Utilisation

1. Ouvrez `http://localhost:8000` dans un navigateur basé sur Chromium (Google Chrome, Microsoft Edge, Brave, Opera).
2. Choisissez votre profil ou créez-en un dans la fenêtre *"Qui pédale aujourd'hui ?"*.
3. Allumez votre home trainer, puis cliquez sur **Connecter Trainer**.
4. Démarrez votre séance et pédalez !

---

## Tests automatisés

Le projet intègre une suite de tests unitaires et d'intégration automatisés exécutables directement avec Node.js, sans aucun navigateur headless lourd :

```bash
node tests/test_batch1_1.js && \
node tests/test_batch2_logic.js && \
node tests/test_batch2_1_real_code.js && \
node tests/test_batch3_ux.js && \
node tests/test_batch4_analytics.js && \
node tests/test_email_tcx.js
```

Consultez le guide dédié dans [tests/README.md](tests/README.md) pour le détail de la couverture de test.

---

## Structure du projet

Le code est organisé sans framework pour garantir une transparence totale, une maintenabilité maximale et des temps de chargement instantanés :

```text
.
├── index.html                  # Interface utilisateur principale et modales
├── service-worker.js           # PWA : mise en cache et fonctionnement hors-ligne
├── manifest.json               # Configuration PWA pour installation mobile/bureau
├── style.css                   # Point d'entrée CSS (imports globaux)
├── _config.yaml                # Configuration Jekyll (pour GitHub Pages)
│
├── css/                        # Feuilles de style modulaires (Vanilla CSS)
│   ├── README.md               # Documentation détaillée des styles et variables
│   ├── variables.css           # Tokens de design et couleurs des zones FTP Z1 à Z6
│   ├── base.css                # Reset CSS et typographie Inter
│   ├── layout.css              # Structure globale et barre d'onglets
│   ├── components.css          # Boutons, cartes, formulaires et console
│   ├── dashboard.css           # Vue Dashboard complète avec grand graphique
│   ├── compteur.css            # Mode Kiosk AMOLED à très haut contraste
│   ├── ux-v3.css               # Sélecteur de profil "Qui pédale" et dialogues tactiles
│   ├── session-detail.css      # Fiche d'analyse détaillée et histogrammes de zones
│   ├── email.css               # Modale d'envoi et statuts d'expédition e-mail
│   └── responsive.css          # Adaptations smartphone portrait/paysage et tablette
│
├── js/                         # Logique applicative (ES6+ natif)
│   ├── README.md               # Documentation approfondie de l'architecture JS
│   ├── state.js                # État global réactif, seuils et base d'entraînements
│   ├── profiles.js             # Gestionnaire multi-profils et sélecteur Kiosk
│   ├── bluetooth.js            # API Web Bluetooth, décodage GATT et mode démo
│   ├── session.js              # Chronomètre, intégration de l'effort et Wake Lock
│   ├── workout.js              # Moteur des entraînements par intervalles
│   ├── storage.js              # Couche de stockage local (LocalStorage & IndexedDB)
│   ├── history.js              # Historique, exports XML TCX et synchronisation
│   ├── analytics.js            # Moteur mathématique de performance (CycloAnalytics)
│   ├── session-detail.js       # Contrôleur d'affichage de la fiche d'analyse
│   ├── email.js                # Gestion de la file d'envoi TCX par e-mail
│   ├── supabase.js             # Client REST/Auth Supabase natif (zéro dépendance)
│   ├── main.js                 # Initialisation, routage des onglets et Service Worker
│   └── vendor/
│       └── chart.umd.js        # Bibliothèque Chart.js packagée pour le hors-ligne
│
├── supabase/                   # Backend PostgreSQL & Edge Functions
│   ├── README.md               # Guide d'installation et de configuration Supabase
│   ├── config.toml             # Configuration du projet local Supabase
│   ├── migrations/             # Migrations SQL versionnées (001 à 005)
│   └── functions/              # Edge Functions Deno (send-session-email, worker cron)
│
├── google-apps-script/         # Passerelle d'envoi e-mail gratuite par Gmail
│   ├── Code.gs                 # Script Google Apps Script Web App
│   └── README.md               # Guide pas à pas de déploiement et configuration
│
├── tests/                      # Suite de tests automatisés (Node.js natif)
│   ├── README.md               # Documentation de la suite de tests
│   ├── test_batch1_1.js        # Tests du cycle de vie BLE et des contrôles UI
│   ├── test_batch2_logic.js    # Tests du générateur TCX et de l'isolation des données
│   ├── test_batch2_1_real_code.js # Tests d'intégration sur le code réel
│   ├── test_batch3_ux.js       # Tests du sélecteur de profils et des dialogues UX
│   ├── test_batch4_analytics.js # Tests du moteur mathématique de performance
│   └── test_email_tcx.js       # Tests de la file locale e-mail et de la sécurité RLS
│
├── docs/                       # Documentation annexe et médias
│   ├── README.md               # Index de la documentation et ressources
│   └── screenshots/            # Captures d'écran de référence
│
└── icons/                      # Icônes PWA pour smartphone et tablette
```

Des documentations spécialisées sont disponibles dans les sous-dossiers :
- **Logique applicative** : [js/README.md](js/README.md)
- **Feuilles de style & Thème** : [css/README.md](css/README.md)
- **Tests automatisés** : [tests/README.md](tests/README.md)
- **Base de données & API** : [supabase/README.md](supabase/README.md)
- **Passerelle Gmail** : [google-apps-script/README.md](google-apps-script/README.md)
- **Documentation visuelle** : [docs/README.md](docs/README.md)

---

## Calculs et télémétrie

### Vitesse en mode démo
En l'absence de capteur de vitesse physique, la vitesse est estimée à partir de la puissance sur terrain plat selon la résistance aérodynamique :

$$Vitesse\ (km/h) = \sqrt[3]{\frac{Puissance\ (W)}{0.007}} \times 3.6$$

### Énergie mécanique et calories
Le travail mécanique en kilojoules est calculé par intégration trapézoïdale de la puissance instantanée sur la durée réelle écoulée entre chaque mesure :

$$Travail\ (kJ) = \frac{\sum (Watts \times \Delta t)}{1000}$$

En considérant un rendement musculaire moyen du corps humain de 24 %, l'énergie métabolique dépensée correspond sensiblement au travail produit :

$$1\ kJ\ mécanique \approx 1\ kcal\ métabolique$$

### Calibration Elite Turno
Pour les trainers à résistance fluide équipés du capteur Misuro B+ (comme l'Elite Turno), la circonférence virtuelle est fixée à `0.165 m` dans `js/state.js` pour refléter le ratio de rotation interne du volant d'inertie.

### Moyennes pondérées et robustesse temporelle
Dans `js/analytics.js`, toutes les moyennes de puissance et de vitesse sont rigoureusement pondérées par le temps inter-échantillons $\Delta t_i$ :

$$Puissance\ moyenne\ (W) = \frac{\sum (P_i \times \Delta t_i)}{\sum \Delta t_i}$$

Si un capteur espace ses notifications ou subit un décrochage temporaire, le temps sans signal au-delà du seuil de tolérance (5 s) n'est pas intégré, ce qui évite de fausser les moyennes.

---

## Compatibilité

- **Matériel compatible** : Elite Turno, Wahoo Kickr, Tacx Flux/Neo, et globalement tout trainer ou capteur transmettant les services Bluetooth normalisés `0x1818` (Cycling Power) ou `0x1816` (Cycling Speed and Cadence).
- **Navigateurs recommandés** : Google Chrome, Microsoft Edge, Brave, Opera (l'API Web Bluetooth n'est pas supportée nativement par Firefox ni Safari).
- **Appareils testés** : PC portable Linux/Windows/Mac, tablettes Android, smartphones Android (testé notamment avec succès sur un Samsung Galaxy S6 / Android 7 sous Chrome en mode Kiosk AMOLED).
