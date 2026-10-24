# Module JavaScript (js/)

Ce dossier regroupe la logique applicative du projet en JavaScript standard (ES6+), sans bundler ni framework externe.

---

## Organisation des fichiers

- `state.js` : Déclaration de l'état global (`state`) et de la configuration des entraînements (`config.workoutsDB`). Tous les modules viennent y lire ou écrire les données courantes.
- `bluetooth.js` : Gestion de l'API Web Bluetooth. Recherche de périphériques, connexion GATT, abonnement aux caractéristiques de puissance (service `0x1818`) et de vitesse/cadence (service `0x1816`), et décodage des buffers binaires.
- `workout.js` : Logique des séances par intervalles. Calcule les cibles de puissance en fonction de la FTP de l'utilisateur, fait avancer les étapes et met à jour la barre de progression.
- `session.js` : Gestion de l'enregistrement en cours (départ, pause, arrêt), cumul de la distance et des kilojoules, et mise à jour du tracé temps réel sur Chart.js.
- `history.js` : Historique individuel, synchronisation, suppression différée hors ligne et export TCX.
- `storage.js` : Espaces locaux isolés par compte Supabase et stockage IndexedDB des séries temporelles volumineuses.
- `main.js` : Point d'entrée de l'application. Initialise les écouteurs d'événements du DOM, la navigation entre onglets et l'enregistrement du Service Worker.

Au lancement, aucun profil n'est activé automatiquement : le cycliste doit confirmer son profil dans le sélecteur plein écran. Les suppressions hors ligne sont conservées dans une file `deletion_queue` isolée par compte jusqu'à leur confirmation Supabase.

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
- **États Bluetooth** : `disconnected`, `connecting`, `connected` et `stale` décrivent uniquement la liaison. Ils sont indépendants de `sessionStatus` (`idle`, `recording`, `stopped`) ; terminer une séance ne ferme donc pas la connexion GATT.
- **Fraîcheur des mesures** : puissance et vitesse ont chacune leur horodatage et un seuil initial de 5 s. L'absence de toute notification pendant 6 s place la liaison en `stale`. Une valeur périmée est enregistrée comme absente (`null`) et n'est plus intégrée dans la distance ou le travail.
- **Temps de séance** : `elapsedTime` vient de l'horloge monotone, `pedalingTime` mesure l'activité détectée et `reliableDataTime` le temps effectivement couvert par au moins une mesure fraîche. Les callbacks d'affichage ne définissent pas la durée.
- **Ajout d'un entraînement** : Il suffit d'ajouter une entrée dans l'objet `config.workoutsDB` de `state.js`. L'interface de l'onglet Entraînements la prendra en compte au chargement suivant.
