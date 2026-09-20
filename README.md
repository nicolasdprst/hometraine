# CycloDash

Tableau de bord web pour home trainer connecté. L'application se connecte directement au home trainer via l'API Web Bluetooth du navigateur, sans compte, sans serveur distant et sans abonnement.


## Motivation

La plupart des applications du marché (Zwift, applications propriétaires des fabricants, etc.) sont souvent lourdes à charger, bourrées de dépendances, avec des abonnements mensuels, un compte obligatoire et aucune possibilité de comprendre ou réparer le code quand un capteur se déconnecte. Sur une vieille tablette posée sur le guidon au fond du garage, ça rame ou ça plante.

Ce projet part d'un besoin simple :
- Se connecter directement au home trainer en Bluetooth depuis le navigateur, sans intermédiaire.
- Zéro abonnement, zéro compte, aucune donnée envoyée sur un serveur distant.
- Une base de code légère en JavaScript pur, lisible, modifiable et facile à déboguer.

---

## Fonctionnalités

- Connexion directe en Bluetooth aux home trainers compatibles (profils Cycling Power et Cycling Speed/Cadence).
- Affichage en direct de la puissance (watts), de la vitesse, de la cadence et de l'énergie dépensée (kJ et kcal).
- Suivi de séances d'entraînement par intervalles (warmup, 30/30, sweet spot) avec indicateur de progression.
- Zones d'intensité calculées à partir de votre FTP configurable.
- Graphique temps réel de la puissance et de la vitesse.
- Mode démo simulant un cycliste sur le plat pour tester l'interface sans matériel.
- Sauvegarde locale de l'historique des sorties (LocalStorage) avec export JSON.
- Fonctionnement hors-ligne via Service Worker (PWA installable sur mobile et bureau).

---

## Démarrage rapide

L'application ne nécessite aucun build ni installation de dépendances Node. C'est du HTML/CSS/JS natif.

Pour utiliser l'API Web Bluetooth, les navigateurs imposent d'exécuter l'application sur `localhost` ou sur une adresse `HTTPS`.

### 1. Cloner le dépôt

```bash
git clone https://github.com/votre-compte/cyclodash.git
cd cyclodash
```

### 2. Démarrer un serveur local

Avec Python :
```bash
python -m http.server 8000
```

Ou avec Node :
```bash
npx serve .
```

### 3. Utilisation

Ouvrez `http://localhost:8000` dans un navigateur basé sur Chromium (Chrome, Edge, Brave), puis cliquez sur **Connecter Trainer**.

---

## Structure du projet

Le code est organisé sans framework pour rester lisible et léger :

```text
.
├── index.html          # Page principale
├── service-worker.js   # Mise en cache pour le mode hors-ligne
├── manifest.json       # Configuration PWA
├── style.css           # Imports CSS globaux
├── css/                # Feuilles de style modulaires
│   ├── base.css        # Reset et typographie
│   ├── components.css  # Boutons, cartes, formulaires
│   ├── dashboard.css   # Métriques, graphiques et roadmap
│   ├── layout.css      # Structure de page et navigation
│   ├── responsive.css  # Adaptations smartphone et tablette
│   └── variables.css   # Variables de couleurs et zones FTP
└── js/                 # Logique applicative
    ├── bluetooth.js    # Communication Web Bluetooth et décodage GATT
    ├── history.js      # Gestion de l'historique et LocalStorage
    ├── main.js         # Initialisation et routage des onglets
    ├── session.js      # Chronomètre, calculs d'effort et Chart.js
    ├── state.js        # État global et définition des séances
    └── workout.js      # Moteur d'entraînement et découpage des zones
```

Des documentations spécifiques sont disponibles dans les dossiers [css/](css/) et [js/](js/).

---

## Calculs et télémétrie

### Vitesse en mode démo
En l'absence de capteur de vitesse physique, la vitesse est estimée à partir de la puissance sur terrain plat selon la résistance aérodynamique :

$$Vitesse\ (km/h) = \sqrt[3]{\frac{Puissance\ (W)}{0.007}} \times 3.6$$

### Énergie et calories
Le travail mécanique en kilojoules est intégré à chaque seconde :

$$Travail\ (kJ) = \frac{\sum (Watts \times \Delta t)}{1000}$$

En considérant un rendement musculaire moyen de 24 %, l'énergie métabolique dépensée correspond sensiblement à :

$$1\ kJ\ mécanique \approx 1\ kcal\ métabolique$$

### Calibration Elite Turno
Pour les trainers à résistance fluide équipés du capteur Misuro B+ (comme le Turno), la circonférence virtuelle est fixée à `0.165 m` dans `js/state.js` pour refléter le ratio de rotation interne du volant.

---

## Compatibilité

- **Matériel** : Elite Turno, Wahoo Kickr, Tacx Flux/Neo, et globalement tout trainer ou capteur transmettant les services Bluetooth `0x1818` (Cycling Power) ou `0x1816` (Speed and Cadence).
- **Navigateurs** : Google Chrome, Microsoft Edge, Brave, Opera (l'API Web Bluetooth n'est pas supportée nativement par Safari ni Firefox).
