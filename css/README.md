# Module CSS (css/)

Ce dossier rassemble l'ensemble des feuilles de style de l'application, découpées par responsabilité. Le design repose sur un thème sombre avec effets de transparence (glassmorphism), sans framework CSS externe.

---

## Organisation des fichiers

- `variables.css` : Définition des variables globales CSS (couleurs de fond, texte, bordures et couleurs des 6 zones FTP Z1 à Z6).
- `base.css` : Reset CSS basique, police Inter et règles génériques du document.
- `layout.css` : Structure de la page, en-tête, barre d'onglets et conteneurs principaux.
- `components.css` : Éléments d'interface réutilisables (boutons, formulaires, cartes de sélection, console de statut).
- `dashboard.css` : Disposition du tableau de bord de pilotage (cartes des métriques clés, graphique Chart.js et affichage de l'intervalle en cours).
- `responsive.css` : Points de rupture (media queries) pour l'affichage sur tablettes et smartphones.

---

## Personnalisation des zones de puissance

Les couleurs associées aux zones d'intensité Z1 à Z6 sont modifiables directement dans `variables.css` :

```css
:root {
  --zone-z1: #60a5fa; /* Récupération */
  --zone-z2: #34d399; /* Endurance */
  --zone-z3: #facc15; /* Tempo */
  --zone-z4: #fb923c; /* Seuil */
  --zone-z5: #f87171; /* VO2 Max */
  --zone-z6: #c084fc; /* Anaérobie */
}
```

La modification de ces variables met automatiquement à jour la jauge d'intensité, la bannière d'intervalle et les badges d'entraînement.
