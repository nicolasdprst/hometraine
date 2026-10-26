// Bibliothèque déterministe d'entraînements CycloDash.
(function (root) {
    'use strict';

    const step = (type, minutes, desc, targetPct) => ({
        type, duration: Math.round(minutes * 60), desc,
        target_pct: targetPct || ({ Z1: 0.50, Z2: 0.68, Z3: 0.84, Z4: 0.98, Z5: 1.12, Z6: 1.30 }[type] || null)
    });
    const repeat = (count, entries) => Array(count).fill(null).flatMap(() => entries.map(item => ({ ...item })));
    const workout = (id, name, category, objective, difficulty, description, steps, extra = {}) => ({
        id, name, category, objective, difficulty, description, steps,
        duration_seconds: steps.reduce((sum, item) => sum + item.duration, 0),
        requires_ftp: extra.requires_ftp !== false,
        is_ftp_test: !!extra.is_ftp_test
    });

    const list = [
        workout('discovery15', 'Découverte 15 minutes', 'Découverte', 'Prendre en main le home trainer', 1, 'Une première séance courte, souple et sans pression.', [step('Z1', 5, 'Mise en route'), step('Z2', 7, 'Pédalage facile'), step('Z1', 3, 'Retour au calme')], { requires_ftp: false }),
        workout('easy20', 'Endurance facile 20 minutes', 'Découverte', 'Développer une première base aérobie', 1, 'Une séance accessible, pilotable au ressenti si votre FTP est inconnue.', [step('Z1', 5, 'Échauffement'), step('Z2', 12, 'Endurance facile'), step('Z1', 3, 'Retour au calme')], { requires_ftp: false }),
        workout('progressive30', 'Sortie progressive 30 minutes', 'Découverte', 'Apprendre à doser son effort', 2, 'L’intensité augmente doucement sans dépasser le tempo.', [step('Z1', 6, 'Mise en route'), step('Z2', 10, 'Endurance'), step('Z3', 9, 'Tempo confortable', 0.80), step('Z1', 5, 'Retour au calme')]),
        workout('endurance30', 'Endurance fondamentale 30 minutes', 'Endurance', 'Construire l’endurance aérobie', 2, 'Un effort régulier où la conversation reste possible.', [step('Z1', 5, 'Échauffement'), step('Z2', 20, 'Endurance régulière'), step('Z1', 5, 'Retour au calme')]),
        workout('endurance45', 'Endurance fondamentale 45 minutes', 'Endurance', 'Consolider la base aérobie', 2, 'Une séance stable et modérée pour accumuler du temps utile.', [step('Z1', 8, 'Échauffement'), step('Z2', 32, 'Endurance régulière'), step('Z1', 5, 'Retour au calme')]),
        workout('endurance60', 'Endurance longue 60 minutes', 'Endurance', 'Augmenter la capacité à soutenir un effort', 3, 'Une heure principalement en endurance, sans pic inutile.', [step('Z1', 10, 'Échauffement'), step('Z2', 45, 'Endurance longue'), step('Z1', 5, 'Retour au calme')]),
        workout('endurance90', 'Endurance longue 90 minutes', 'Endurance', 'Développer l’endurance de longue durée', 3, 'Une sortie longue à intensité maîtrisée.', [step('Z1', 10, 'Échauffement'), step('Z2', 70, 'Endurance longue'), step('Z3', 5, 'Tempo souple', 0.80), step('Z1', 5, 'Retour au calme')]),
        workout('tempo-progressive', 'Tempo progressif', 'Tempo / Sweet Spot', 'Améliorer la tenue d’un effort soutenu', 3, 'Trois paliers progressifs, de l’endurance au tempo.', [step('Z1', 8, 'Échauffement'), step('Z2', 8, 'Endurance'), step('Z3', 8, 'Tempo 1', 0.80), step('Z3', 8, 'Tempo 2', 0.88), step('Z1', 6, 'Retour au calme')]),
        workout('sweetspot', 'Sweet Spot 2 × 10 minutes', 'Tempo / Sweet Spot', 'Accumuler du travail proche du seuil', 3, 'Deux blocs soutenus mais contrôlés, séparés par une récupération.', [step('Z2', 10, 'Échauffement'), step('Z3', 10, 'Sweet Spot 1', 0.90), step('Z1', 5, 'Récupération'), step('Z3', 10, 'Sweet Spot 2', 0.90), step('Z1', 5, 'Retour au calme')]),
        workout('sweetspot-3x8', 'Sweet Spot 3 × 8 minutes', 'Tempo / Sweet Spot', 'Répéter des efforts soutenus', 4, 'Trois blocs réguliers juste sous le seuil.', [step('Z2', 10, 'Échauffement'), ...repeat(3, [step('Z3', 8, 'Sweet Spot', 0.90), step('Z1', 4, 'Récupération')]), step('Z1', 5, 'Retour au calme')]),
        workout('threshold-3x6', 'Seuil 3 × 6 minutes', 'Seuil', 'Améliorer la puissance au seuil', 4, 'Trois efforts proches de la FTP avec récupération complète.', [step('Z2', 12, 'Échauffement'), ...repeat(3, [step('Z4', 6, 'Effort au seuil', 0.98), step('Z1', 4, 'Récupération')]), step('Z1', 6, 'Retour au calme')]),
        workout('threshold-2x12', 'Seuil 2 × 12 minutes', 'Seuil', 'Soutenir plus longtemps la puissance au seuil', 5, 'Deux longs blocs exigeants réservés aux profils préparés.', [step('Z2', 12, 'Échauffement'), step('Z4', 12, 'Seuil 1', 0.98), step('Z1', 6, 'Récupération'), step('Z4', 12, 'Seuil 2', 0.98), step('Z1', 8, 'Retour au calme')]),
        workout('intervals3030', 'Intervalles 30/30', 'VO2max', 'Découvrir les efforts courts et intenses', 4, 'Dix répétitions de 30 secondes, sans sprint maximal.', [step('Z2', 10, 'Échauffement'), ...repeat(10, [step('Z5', 0.5, 'Effort intense', 1.15), step('Z1', 0.5, 'Récupération')]), step('Z1', 10, 'Retour au calme')]),
        workout('vo2-4x3', 'Intervalles 4 × 3 minutes', 'VO2max', 'Développer la puissance aérobie', 5, 'Quatre efforts intenses et réguliers, jamais des sprints.', [step('Z2', 12, 'Échauffement'), ...repeat(4, [step('Z5', 3, 'VO2max', 1.12), step('Z1', 3, 'Récupération')]), step('Z1', 8, 'Retour au calme')]),
        workout('vo2-5x3', 'Intervalles 5 × 3 minutes', 'VO2max', 'Augmenter la tolérance aux efforts intenses', 5, 'Une séance avancée à réserver aux semaines bien assimilées.', [step('Z2', 12, 'Échauffement'), ...repeat(5, [step('Z5', 3, 'VO2max', 1.12), step('Z1', 3, 'Récupération')]), step('Z1', 8, 'Retour au calme')]),
        workout('recovery20', 'Récupération active 20 minutes', 'Récupération', 'Faire tourner les jambes sans charge', 1, 'Très facile : réduisez encore l’intensité si nécessaire.', [step('Z1', 20, 'Pédalage très souple', 0.48)], { requires_ftp: false }),
        workout('recovery30', 'Récupération active 30 minutes', 'Récupération', 'Favoriser une reprise douce', 1, 'Une demi-heure facile, sans objectif de performance.', [step('Z1', 5, 'Mise en route', 0.45), step('Z1', 20, 'Récupération active', 0.50), step('Z1', 5, 'Retour au calme', 0.45)], { requires_ftp: false }),
        workout('ftp-test-20', 'Test FTP guidé', 'Évaluation', 'Estimer la FTP à partir d’un effort de 20 minutes', 5, 'Après un échauffement progressif, tenez le meilleur effort régulier possible pendant 20 minutes. Le résultat reste une estimation, pas une mesure physiologique exacte.', [step('Z1', 8, 'Échauffement facile', 0.50), step('Z2', 5, 'Montée progressive', 0.70), step('Z4', 3, 'Préparation soutenue', 0.95), step('Z1', 4, 'Récupération'), step('Z4', 20, 'Effort test régulier', 1.00), step('Z1', 10, 'Retour au calme')], { is_ftp_test: true, requires_ftp: false }),
        workout('cadence30', 'Endurance & vélocité 30 minutes', 'Endurance', 'Améliorer la fluidité du pédalage', 2, 'Une endurance légère ponctuée de séquences de vélocité, sans hausse brutale de puissance.', [step('Z1', 5, 'Échauffement'), ...repeat(4, [step('Z2', 4, 'Endurance souple'), step('Z2', 1, 'Vélocité contrôlée', 0.65)]), step('Z1', 5, 'Retour au calme')])
    ];

    const byId = Object.freeze(list.reduce((map, item) => { map[item.id] = item; return map; }, {}));
    const api = Object.freeze({ list: Object.freeze(list), byId, get: id => byId[id] || null });
    root.CycloTrainingLibrary = api;
    if (root.config) root.config.workoutsDB = byId;
})(typeof window !== 'undefined' ? window : globalThis);
