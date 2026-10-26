# Module CSS (css/)

Ce dossier rassemble les feuilles de style de CycloDash. L'interface repose sur un thème sombre neutre, des surfaces opaques et une seule couleur d'accent, sans framework CSS.

---

## Organisation des fichiers

| Feuille de style | Rôle & Composants associés |
| :--- | :--- |
| **`variables.css`** | Variables CSS globales : palette de couleurs sombres, bordures subtiles, rayons de courbure et couleurs des 6 zones FTP (Z1 à Z6). |
| **`base.css`** | Reset CSS minimal, intégration de la police Inter, lissage des polices et règles génériques pour l'accessibilité. |
| **`app.css`** | Coque responsive, navigation, Compteur, séances, historique, réglages, modales et bilan de séance. |
| **`session-detail.css`** | Vue d'analyse détaillée de séance (Batch 4) : histogramme horizontal de répartition du temps dans les zones FTP, badges de records de puissance (5s, 1m, 5min, 20min), bascule de vue graphique et indicateur de chargement. |
| **`email.css`** | Boîte de dialogue d'envoi TCX par e-mail : aperçu de la pièce jointe, champ de saisie d'adresse, indicateurs de progression (`pending`, `sending`, `sent`, `failed`) et case à cocher d'envoi automatique. |

---

## Personnalisation des zones de puissance FTP

Les couleurs associées aux 6 zones d'intensité cycliste sont déclarées dans `variables.css` et exploitées dynamiquement à la fois par le CSS et les modules JavaScript :

```css
:root {
  --z1: #60a5fa; /* Z1 Récupération active (< 55% FTP) */
  --z2: #34d399; /* Z2 Endurance fondamentale (55% - 75% FTP) */
  --z3: #fbbf24; /* Z3 Tempo (76% - 90% FTP) */
  --z4: #f97316; /* Z4 Seuil lactique (91% - 105% FTP) */
  --z5: #ef4444; /* Z5 VO2 Max (106% - 120% FTP) */
  --z6: #a855f7; /* Z6 Capacité anaérobie (> 120% FTP) */
}
```

La modification de ces variables met automatiquement à jour la jauge dynamique de watts, le bandeau de l'intervalle en cours, les graphiques temps réel et l'histogramme d'analyse détaillée.
