# CycloDash

CycloDash est une application web progressive (PWA) moderne et légère conçue pour afficher et enregistrer en temps réel les métriques des séances d'entraînement sur home trainer. 

En utilisant mon propre home trainer, j'ai été déçu de constater à quel point la configuration des applications existantes était souvent lourde, peu flexible et verrouillée derrière des options premium payantes. Pour changer cela, j'ai développé cette application simple, rapide et sans superflu. Il suffit de connecter vos capteurs en un clic et commencez à rouler.

L'application s'appuie sur l'API web bluetooth pour communiquer directement avec vos capteurs de vélo sans intermédiaire ni serveur distant, tout en proposant des séances d'entraînement structurées basées sur votre seuil fonctionnel de puissance (FTP).

---

## fonctionnalités principales

* Connectivité Bluetooth Low Energy (BLE) : Détection et connexion directe à vos capteurs et home trainers compatibles via le protocole Web Bluetooth.
* Métriques en temps réel :
  * Puissance instantanée et moyenne (Watts).
  * Vitesse instantanée et moyenne (km/h).
  * Durée et distance cumulée.
  * Graphique d'évolution en continu (Chart.js).
  * Bilan d'effort : puissance max, vitesse max, dépense énergétique (kcal) et travail mécanique total (kJ).
* Entraînements structurés :
  * Mode Roule libre ou séances ciblées par intervalles (Échauffement & Endurance, 30/30, Sweet Spot).
  * Jauge visuelle de maintien de zone et décompte dynamique de chaque palier.
* Calcul personnalisé des zones (Coggan) :
  * Définition de votre FTP (Functional Threshold Power) dans les paramètres.
  * Découpage automatique des zones de Z1 (Récupération) à Z6 (Anaérobie).
* PWA : Installable sur smartphone, tablette ou bureau, avec mise en cache via Service Worker pour un fonctionnement hors-ligne.
* Historique local : Sauvegarde de vos sorties et bilans d'efforts passés.

---

## Architecture

```text
├── index.html            # Interface utilisateur principale (HTML5 sémantique)
├── style.css             # Feuilles de styles modernes (Thème Glassmorphism / Dark)
├── manifest.json         # Manifeste PWA pour l'installation écran d'accueil
├── service-worker.js     # Gestion du cache et mode hors-ligne
├── _config.yaml          # Configuration d'hébergement statique (GitHub Pages)
└── js/
    ├── main.js           # Initialisation de l'application et navigation par onglets
    ├── state.js          # Gestionnaire de l'état global et persistance (localStorage)
    ├── bluetooth.js      # Gestion de l'API Web Bluetooth (appairage, GATT, parsing)
    ├── session.js        # Gestion du chronomètre, calculs statistiques et graphiques
    ├── workout.js        # Logique des séances par intervalles et affichage des zones
    └── history.js        # Enregistrement et restitution de l'historique des sorties
