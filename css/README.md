# Module CSS (css/)

Ce dossier rassemble l'ensemble des feuilles de style de CycloDash, modularisées par responsabilité. L'interface repose sur une esthétique moderne en thème sombre (optimisée pour les écrans AMOLED des tablettes et smartphones montés sur guidon) avec effets de transparence et de relief (glassmorphism), sans aucun framework CSS externe ni surcharge superflue.

---

## Organisation des fichiers

| Feuille de style | Rôle & Composants associés |
| :--- | :--- |
| **`variables.css`** | Variables CSS globales : palette de couleurs sombres, bordures subtiles, rayons de courbure et couleurs des 6 zones FTP (Z1 à Z6). |
| **`base.css`** | Reset CSS minimal, intégration de la police Inter, lissage des polices et règles génériques pour l'accessibilité. |
| **`layout.css`** | Squelette structurel de l'application, barre de navigation principale (onglets avec icônes), bandeau d'identité du profil actif et conteneurs principaux. |
| **`components.css`** | Composants d'interface réutilisables : boutons interactifs, cartes, champs de formulaire, interrupteurs basculeurs (switchers), toasts de notification et boîte de statut Bluetooth. |
| **`dashboard.css`** | Disposition du grand tableau de bord d'analyse en direct : tuiles de métriques (watts, vitesse, chrono, kJ), grand canevas Chart.js et progression de l'entraînement par intervalles. |
| **`compteur.css`** | **Mode Kiosk AMOLED** : interface ultra-contrastée à fond noir profond (`#000000`), typographie géante lisible à distance sur guidon, indicateur compact de statut Bluetooth et badge Screen Wake Lock. |
| **`ux-v3.css`** | Interface du sélecteur de profils plein écran (*"Qui pédale aujourd'hui ?"*), cartes de profils interactives avec pastilles colorées, dialogue modal de confirmation de suppression et badge de profil actif. |
| **`session-detail.css`** | Vue d'analyse détaillée de séance (Batch 4) : histogramme horizontal de répartition du temps dans les zones FTP, badges de records de puissance (5s, 1m, 5min, 20min), bascule de vue graphique et indicateur de chargement. |
| **`email.css`** | Boîte de dialogue d'envoi TCX par e-mail : aperçu de la pièce jointe, champ de saisie d'adresse, indicateurs de progression (`pending`, `sending`, `sent`, `failed`) et case à cocher d'envoi automatique. |
| **`responsive.css`** | Règles d'adaptation multi-écrans et points de rupture (*media queries*) pour smartphones (portrait/paysage) et tablettes de garage. |

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
