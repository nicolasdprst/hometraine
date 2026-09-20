# Module JavaScript (js/)

Ce dossier regroupe la logique applicative du projet en JavaScript standard (ES6+), sans bundler ni framework externe.

---

## Organisation des fichiers

- `state.js` : Déclaration de l'état global (`state`) et de la configuration des entraînements (`config.workoutsDB`). Tous les modules viennent y lire ou écrire les données courantes.
- `bluetooth.js` : Gestion de l'API Web Bluetooth. Recherche de périphériques, connexion GATT, abonnement aux caractéristiques de puissance (service `0x1818`) et de vitesse/cadence (service `0x1816`), et décodage des buffers binaires.
- `workout.js` : Logique des séances par intervalles. Calcule les cibles de puissance en fonction de la FTP de l'utilisateur, fait avancer les étapes et met à jour la barre de progression.
- `session.js` : Gestion de l'enregistrement en cours (départ, pause, arrêt), cumul de la distance et des kilojoules, et mise à jour du tracé temps réel sur Chart.js.
- `history.js` : Persistance des séances terminées dans le LocalStorage, affichage sous forme de liste et export des données au format JSON.
- `main.js` : Point d'entrée de l'application. Initialise les écouteurs d'événements du DOM, la navigation entre onglets et l'enregistrement du Service Worker.

---

## Flux de données

1. Le capteur physique (ou le générateur démo) émet des données brutes.
2. `bluetooth.js` décode les octets et met à jour `state.currentWatts` et `state.currentSpeed`.
3. `session.js` calcule les moyennes, met à jour le chronomètre et injecte les points dans le graphique Chart.js.
4. `workout.js` compare la puissance instantanée à la zone cible de l'intervalle et fait défiler la roadmap.
5. À l'arrêt, `history.js` sérialise l'objet de session et l'enregistre dans le LocalStorage.

---

## Notes techniques

- **Calibration du capteur Misuro B+ (Elite Turno)** : La constante `WHEEL_CIRCUMFERENCE_M` dans `state.js` est réglée à `0.165` mètres en raison de la démultiplication interne du volant d'inertie.
- **Ajout d'un entraînement** : Il suffit d'ajouter une entrée dans l'objet `config.workoutsDB` de `state.js`. L'interface de l'onglet Entraînements la prendra en compte au chargement suivant.
