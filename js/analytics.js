// --- CYCLODASH BATCH 4 : MOTEUR D'ANALYSE DES PERFORMANCES ---
// Calculs purs sans dépendance DOM. Toutes les statistiques sont pondérées
// par le temps réel écoulé entre les mesures.

const CycloAnalytics = (() => {
    'use strict';

    // ── Configuration ──────────────────────────────────────────────────
    const MAX_GAP_SECONDS = 10; // Au-delà, on considère une interruption
    const BEST_EFFORT_DURATIONS = [5, 60, 300, 1200]; // secondes (5s, 1min, 5min, 20min)
    const MIN_COVERAGE_RATIO = 0.8; // 80 % de couverture pour valider un effort
    const DOWNSAMPLE_TARGET = 300; // Nombre maximum de points pour un graphique

    // ── Définitions des zones FTP ──────────────────────────────────────
    // Cohérentes avec workout.js et main.js : updateZonesDisplay()
    const ZONE_DEFINITIONS = [
        { id: 'Z1', name: 'Récupération',  color: 'var(--z1, #60a5fa)', minPct: 0,    maxPct: 0.55 },
        { id: 'Z2', name: 'Endurance',     color: 'var(--z2, #34d399)', minPct: 0.55, maxPct: 0.75 },
        { id: 'Z3', name: 'Tempo',         color: 'var(--z3, #fbbf24)', minPct: 0.75, maxPct: 0.90 },
        { id: 'Z4', name: 'Seuil',         color: 'var(--z4, #f97316)', minPct: 0.90, maxPct: 1.05 },
        { id: 'Z5', name: 'VO2 Max',       color: 'var(--z5, #ef4444)', minPct: 1.05, maxPct: 1.20 },
        { id: 'Z6', name: 'Anaérobie',     color: 'var(--z6, #a855f7)', minPct: 1.20, maxPct: Infinity }
    ];

    // ── Utilitaires ────────────────────────────────────────────────────

    /**
     * Valide et normalise les séries temporelles brutes.
     * Retourne un tableau d'objets { t, ts, watts, speed, distance } triés par t.
     * Les mesures null/undefined sont conservées en tant que null (=absence de donnée).
     */
    function normalizeTimeSeries(rawData) {
        if (!rawData || !Array.isArray(rawData.time) || rawData.time.length === 0) {
            return null;
        }
        const len = rawData.time.length;
        const points = [];
        for (let i = 0; i < len; i++) {
            const t = Number(rawData.time[i]);
            if (!Number.isFinite(t) || t < 0) continue;
            points.push({
                t,
                ts: (rawData.timestamps && rawData.timestamps[i]) || null,
                watts: sanitizeNumber(rawData.watts && rawData.watts[i]),
                speed: sanitizeNumber(rawData.speed && rawData.speed[i]),
                distance: sanitizeNumber(rawData.distance && rawData.distance[i])
            });
        }
        if (points.length === 0) return null;
        // Trier par temps croissant
        points.sort((a, b) => a.t - b.t);
        return points;
    }

    function sanitizeNumber(value) {
        if (value === null || value === undefined) return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Calcule le dt (durée représentée par le point i).
     * Modèle rigoureux sans double-comptage :
     * - Pour une séance enregistrée par session.js (t_0 > 0, chaque tick enregistre
     *   le dt écoulé depuis le précédent) :
     *   i=0 couvre [0, t_0] avec dt = min(t_0, MAX_GAP_SECONDS)
     *   i>0 couvre (t_{i-1}, t_i] avec dt = t_i - t_{i-1} (si <= MAX_GAP_SECONDS)
     * - Pour une série commençant à t=0 : intégration trapézoïdale où la somme des dt
     *   égale exactement t_last - t_0.
     */
    function getIntegrationDt(points, i) {
        if (!points || points.length === 0) return 0;
        if (points.length === 1) return 1;

        if (points[0].t > 0) {
            if (i === 0) {
                return points[0].t <= MAX_GAP_SECONDS ? points[0].t : 0;
            }
            const dt = points[i].t - points[i - 1].t;
            return (dt > 0 && dt <= MAX_GAP_SECONDS) ? dt : 0;
        }

        // points[0].t === 0 : règle des trapèzes
        if (i === 0) {
            const dtNext = points.length > 1 ? points[1].t - points[0].t : 1;
            return (dtNext > 0 && dtNext <= MAX_GAP_SECONDS) ? dtNext / 2 : 0;
        }
        if (i === points.length - 1) {
            const dtPrev = points[i].t - points[i - 1].t;
            return (dtPrev > 0 && dtPrev <= MAX_GAP_SECONDS) ? dtPrev / 2 : 0;
        }
        const dtPrev = points[i].t - points[i - 1].t;
        const dtNext = points[i + 1].t - points[i].t;
        let w = 0;
        if (dtPrev > 0 && dtPrev <= MAX_GAP_SECONDS) w += dtPrev / 2;
        if (dtNext > 0 && dtNext <= MAX_GAP_SECONDS) w += dtNext / 2;
        return w;
    }

    // ── Calcul de moyenne pondérée ─────────────────────────────────────

    function computeWeightedAverage(points, key) {
        if (!points || points.length === 0) return null;
        let weightedSum = 0;
        let totalWeight = 0;
        for (let i = 0; i < points.length; i++) {
            const v = points[i][key];
            if (v === null) continue;
            const dt = getIntegrationDt(points, i);
            if (dt <= 0) continue;
            weightedSum += v * dt;
            totalWeight += dt;
        }
        return totalWeight > 0 ? weightedSum / totalWeight : null;
    }

    // ── Statistiques de base ──────────────────────────────────────────

    function computeBasicStats(points) {
        if (!points || points.length === 0) {
            return { available: false };
        }

        const startT = (points[0].t > 0 && points[0].t <= MAX_GAP_SECONDS) ? 0 : points[0].t;
        const totalDuration = Math.max(0, points[points.length - 1].t - startT);

        // Puissance
        let sumPowerWeighted = 0, maxWatts = 0;
        let powerMeasureTime = 0;

        // Vitesse
        let sumSpeedWeighted = 0, maxSpeed = 0;
        let speedMeasureTime = 0;

        // Distance et travail
        let totalWorkJ = 0;
        let lastValidDistance = null;
        let maxDistance = 0;

        // Temps actif (pédalage)
        let activeTime = 0;
        let validDataTime = 0;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const dt = getIntegrationDt(points, i);

            if (p.watts !== null && dt > 0) {
                sumPowerWeighted += p.watts * dt;
                powerMeasureTime += dt;
                if (p.watts > maxWatts) maxWatts = p.watts;
                totalWorkJ += p.watts * dt;
            }

            if (p.speed !== null && dt > 0) {
                sumSpeedWeighted += p.speed * dt;
                speedMeasureTime += dt;
                if (p.speed > maxSpeed) maxSpeed = p.speed;
            }

            if ((p.watts !== null || p.speed !== null) && dt > 0) {
                validDataTime += dt;
            }
            if (((p.watts !== null && p.watts > 0) || (p.speed !== null && p.speed > 0.5)) && dt > 0) {
                activeTime += dt;
            }

            if (p.distance !== null) {
                if (p.distance > maxDistance) maxDistance = p.distance;
                lastValidDistance = p.distance;
            }
        }

        const avgPower = powerMeasureTime > 0 ? sumPowerWeighted / powerMeasureTime : null;
        const avgSpeed = speedMeasureTime > 0 ? sumSpeedWeighted / speedMeasureTime : null;
        const totalWorkKJ = totalWorkJ / 1000;
        const energyKcal = Math.round(totalWorkKJ);
        const distanceM = maxDistance || (lastValidDistance || 0);

        return {
            available: true,
            totalDuration: Math.round(totalDuration),
            activeTime: Math.round(activeTime),
            validDataTime: Math.round(validDataTime),
            powerMeasureTime: Math.round(powerMeasureTime),
            speedMeasureTime: Math.round(speedMeasureTime),
            avgPower: avgPower !== null ? Math.round(avgPower) : null,
            maxPower: Math.round(maxWatts),
            avgSpeed: avgSpeed !== null ? parseFloat(avgSpeed.toFixed(1)) : null,
            maxSpeed: parseFloat(maxSpeed.toFixed(1)),
            totalWorkKJ: Math.round(totalWorkKJ),
            energyKcal,
            distanceKm: parseFloat((distanceM / 1000).toFixed(2)),
            pointCount: points.length,
            dataCoverage: totalDuration > 0 ? Math.min(1, parseFloat((validDataTime / totalDuration).toFixed(3))) : 0
        };
    }

    // ── Analyse de la régularité (variabilité) ────────────────────────

    function computeVariability(points) {
        if (!points || points.length === 0) {
            return { available: false };
        }

        let sumPowerWeighted = 0, totalDt = 0;
        const validPowers = [];

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.watts === null) continue;
            const dt = getIntegrationDt(points, i);
            if (dt <= 0) continue;
            sumPowerWeighted += p.watts * dt;
            totalDt += dt;
            validPowers.push({ value: p.watts, dt });
        }

        if (totalDt <= 0 || validPowers.length < 2) {
            return { available: false };
        }

        const mean = sumPowerWeighted / totalDt;

        // Écart-type pondéré par le temps
        let sumSqDiffDt = 0;
        for (const { value, dt } of validPowers) {
            sumSqDiffDt += (value - mean) * (value - mean) * dt;
        }
        const variance = sumSqDiffDt / totalDt;
        const stdDev = Math.sqrt(variance);
        const cv = mean > 0 ? (stdDev / mean) * 100 : null;

        // Interprétation
        let interpretation = '';
        if (cv !== null) {
            if (cv < 15) interpretation = 'Effort relativement stable';
            else if (cv < 30) interpretation = 'Effort variable';
            else interpretation = "Alternance importante d'intensités";
        }

        return {
            available: true,
            mean: Math.round(mean),
            stdDev: Math.round(stdDev),
            cv: cv !== null ? parseFloat(cv.toFixed(1)) : null,
            interpretation,
            measureTime: Math.round(totalDt),
            sampleCount: validPowers.length
        };
    }

    // ── Répartition par zones FTP ─────────────────────────────────────

    function computeZoneDistribution(points, ftpWatts) {
        if (!points || points.length === 0 || !ftpWatts || ftpWatts <= 0) {
            return { available: false, zones: [] };
        }

        const zones = ZONE_DEFINITIONS.map(z => ({
            ...z,
            minWatts: Math.round(ftpWatts * z.minPct),
            maxWatts: z.maxPct === Infinity ? Infinity : Math.round(ftpWatts * z.maxPct),
            duration: 0
        }));

        let totalValidTime = 0;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.watts === null) continue;
            const dt = getIntegrationDt(points, i);
            if (dt <= 0) continue;

            totalValidTime += dt;

            // Trouver la zone correspondante (sans chevauchement ni trou)
            for (const zone of zones) {
                if (p.watts >= zone.minWatts && (zone.maxWatts === Infinity || p.watts < zone.maxWatts)) {
                    zone.duration += dt;
                    break;
                }
            }
        }

        return {
            available: totalValidTime > 0,
            ftp: ftpWatts,
            totalValidTime: Math.round(totalValidTime),
            zones: zones.map(z => ({
                id: z.id,
                name: z.name,
                color: z.color,
                minWatts: z.minWatts,
                maxWatts: z.maxWatts,
                duration: Math.round(z.duration),
                percentage: totalValidTime > 0 ? parseFloat(((z.duration / totalValidTime) * 100).toFixed(1)) : 0
            }))
        };
    }

    // ── Meilleurs efforts (O(N) fenêtre glissante + intégrale cumulée) ──

    /**
     * Algorithme optimisé en O(N) par intégrale cumulée et deux pointeurs.
     * Pour chaque durée demandée (5s, 60s, 300s, 1200s) :
     * 1. Découpage en segments continus sans interruption (> MAX_GAP_SECONDS)
     * 2. Précalcul des sommes cumulées d'énergie et de temps valide
     * 3. Fenêtre glissante linéaire avec évaluation en O(1)
     * 4. Exigence de couverture minimale >= MIN_COVERAGE_RATIO
     */
    function computeBestEfforts(points) {
        if (!points || points.length < 2) {
            return BEST_EFFORT_DURATIONS.map(d => ({
                duration: d,
                label: formatEffortDuration(d),
                power: null,
                available: false
            }));
        }

        const totalSessionDuration = points[points.length - 1].t - points[0].t;

        // Découper la séance en segments continus (sans interruption > MAX_GAP_SECONDS)
        const segments = [];
        let segStart = 0;
        for (let i = 1; i <= points.length; i++) {
            const isGap = (i < points.length) && (points[i].t - points[i - 1].t > MAX_GAP_SECONDS);
            if (i === points.length || isGap) {
                if (i - segStart >= 2) {
                    segments.push({ start: segStart, end: i - 1 });
                }
                segStart = i;
            }
        }

        const results = [];

        for (const targetDuration of BEST_EFFORT_DURATIONS) {
            if (totalSessionDuration < targetDuration * 0.5) {
                results.push({
                    duration: targetDuration,
                    label: formatEffortDuration(targetDuration),
                    power: null,
                    available: false
                });
                continue;
            }

            let bestAvg = null;

            for (const seg of segments) {
                const m = seg.end - seg.start + 1;
                const segPoints = [];
                for (let k = seg.start; k <= seg.end; k++) {
                    segPoints.push(points[k]);
                }

                const segDuration = segPoints[m - 1].t - segPoints[0].t;
                if (segDuration < targetDuration) continue;

                // Sommes cumulées (prefix sums) : O(M)
                // cumEnergy[k+1] = énergie cumulée jusqu'au point k
                // cumValidTime[k+1] = temps valide cumulé jusqu'au point k
                const cumEnergy = new Float64Array(m + 1);
                const cumValidTime = new Float64Array(m + 1);

                for (let j = 0; j < m; j++) {
                    const dt = (j === 0) ? 0 : (segPoints[j].t - segPoints[j - 1].t);
                    const valid = (segPoints[j].watts !== null && dt > 0);
                    cumEnergy[j + 1] = cumEnergy[j] + (valid ? segPoints[j].watts * dt : 0);
                    cumValidTime[j + 1] = cumValidTime[j] + (valid ? dt : 0);
                }

                // Deux pointeurs sliding window : O(M)
                let left = 0;
                for (let right = 1; right < m; right++) {
                    // Avancer left tant que la fenêtre reste >= targetDuration
                    while (left < right && (segPoints[right].t - segPoints[left + 1].t) >= targetDuration) {
                        left++;
                    }

                    const windowDuration = segPoints[right].t - segPoints[left].t;
                    if (windowDuration < targetDuration) continue;

                    // Si la fenêtre dépasse trop la cible, ignorer
                    if (windowDuration > targetDuration + MAX_GAP_SECONDS) continue;

                    // Énergie et temps valide dans la fenêtre [left, right]
                    const energyInWindow = cumEnergy[right + 1] - cumEnergy[left + 1];
                    const validTimeInWindow = cumValidTime[right + 1] - cumValidTime[left + 1];

                    // Vérifier la couverture minimale
                    if (validTimeInWindow < targetDuration * MIN_COVERAGE_RATIO) continue;

                    const avgPower = validTimeInWindow > 0 ? energyInWindow / validTimeInWindow : 0;
                    if (bestAvg === null || avgPower > bestAvg) {
                        bestAvg = avgPower;
                    }
                }
            }

            results.push({
                duration: targetDuration,
                label: formatEffortDuration(targetDuration),
                power: bestAvg !== null ? Math.round(bestAvg) : null,
                available: bestAvg !== null
            });
        }

        return results;
    }

    function formatEffortDuration(seconds) {
        if (seconds < 60) return `${seconds} s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
    }

    // ── Sous-échantillonnage pour l'affichage graphique (LTTB) ──────────

    /**
     * Algorithme Largest-Triangle-Three-Buckets (LTTB) adapté.
     * Préserve les pics, les creux et la forme générale de la courbe
     * tout en réduisant le nombre de points à targetCount.
     * Les points null (interruptions) sont préservés pour spanGaps: false.
     */
    function downsampleForChart(points, key, targetCount) {
        targetCount = targetCount || DOWNSAMPLE_TARGET;
        if (!points || points.length <= targetCount) return points;

        const nullIndices = new Set();
        for (let i = 0; i < points.length; i++) {
            if (points[i][key] === null) {
                nullIndices.add(i);
            }
        }

        // Si plus de 50 % de nulls, prendre un sous-échantillonnage régulier
        if (nullIndices.size > targetCount * 0.5) {
            const result = [];
            const step = Math.max(1, Math.floor(points.length / targetCount));
            for (let i = 0; i < points.length; i += step) {
                result.push(points[i]);
            }
            if (result[result.length - 1] !== points[points.length - 1]) {
                result.push(points[points.length - 1]);
            }
            return result;
        }

        const validPoints = points.filter((_, i) => !nullIndices.has(i));
        if (validPoints.length <= targetCount) return points;

        const sampled = [validPoints[0]]; // Conserver premier point
        const bucketSize = (validPoints.length - 2) / (targetCount - 2);

        for (let i = 0; i < targetCount - 2; i++) {
            const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
            const avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1;
            const avgRangeEndClamped = Math.min(avgRangeEnd, validPoints.length);

            let avgX = 0, avgY = 0, avgCount = 0;
            for (let j = avgRangeStart; j < avgRangeEndClamped; j++) {
                avgX += validPoints[j].t;
                avgY += (validPoints[j][key] || 0);
                avgCount++;
            }
            if (avgCount > 0) {
                avgX /= avgCount;
                avgY /= avgCount;
            } else if (avgRangeStart < validPoints.length) {
                avgX = validPoints[avgRangeStart].t;
                avgY = validPoints[avgRangeStart][key] || 0;
            }

            const rangeStart = Math.floor(i * bucketSize) + 1;
            const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;

            const prev = sampled[sampled.length - 1];
            let maxArea = -1;
            let maxIdx = Math.min(rangeStart, validPoints.length - 1);

            for (let j = rangeStart; j < rangeEnd && j < validPoints.length; j++) {
                const area = Math.abs(
                    (prev.t - avgX) * ((validPoints[j][key] || 0) - (prev[key] || 0)) -
                    (prev.t - validPoints[j].t) * (avgY - (prev[key] || 0))
                );
                if (area > maxArea) {
                    maxArea = area;
                    maxIdx = j;
                }
            }
            sampled.push(validPoints[maxIdx]);
        }
        sampled.push(validPoints[validPoints.length - 1]); // Conserver dernier point

        // Réinjecter les points null (interruptions)
        if (nullIndices.size > 0) {
            const nullPoints = Array.from(nullIndices).map(idx => points[idx]);
            const merged = [...sampled, ...nullPoints];
            merged.sort((a, b) => a.t - b.t);
            return merged;
        }

        return sampled;
    }

    // ── Analyse complète d'une séance ─────────────────────────────────

    /**
     * Point d'entrée principal.
     *
     * @param {Object} rawData - { time: [], timestamps: [], watts: [], speed: [], distance: [] }
     * @param {number|null} ftpWatts - FTP au moment de la séance (ou actuelle)
     * @param {boolean} ftpIsHistorical - true si la FTP est celle de la séance
     * @returns {Object} Analyse complète
     */
    function analyzeSession(rawData, ftpWatts, ftpIsHistorical) {
        const points = normalizeTimeSeries(rawData);
        const hasDetailedData = points !== null;

        const result = {
            hasDetailedData,
            basicStats: hasDetailedData ? computeBasicStats(points) : { available: false },
            variability: hasDetailedData ? computeVariability(points) : { available: false },
            zones: hasDetailedData ? computeZoneDistribution(points, ftpWatts) : { available: false, zones: [] },
            bestEfforts: hasDetailedData ? computeBestEfforts(points) : BEST_EFFORT_DURATIONS.map(d => ({
                duration: d,
                label: formatEffortDuration(d),
                power: null,
                available: false
            })),
            ftp: ftpWatts,
            ftpIsHistorical: !!ftpIsHistorical,
            chartData: null
        };

        if (hasDetailedData) {
            result.chartData = {
                power: downsampleForChart(points, 'watts', DOWNSAMPLE_TARGET),
                speed: downsampleForChart(points, 'speed', DOWNSAMPLE_TARGET)
            };
        }

        return result;
    }

    // ── API publique ──────────────────────────────────────────────────

    return {
        analyzeSession,
        normalizeTimeSeries,
        computeBasicStats,
        computeVariability,
        computeZoneDistribution,
        computeBestEfforts,
        downsampleForChart,
        getIntegrationDt,
        computeWeightedAverage,
        formatEffortDuration,
        ZONE_DEFINITIONS,
        BEST_EFFORT_DURATIONS,
        MAX_GAP_SECONDS,
        MIN_COVERAGE_RATIO,
        DOWNSAMPLE_TARGET
    };
})();

// Export double environnement (Node.js et Navigateur)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CycloAnalytics;
}
if (typeof window !== 'undefined') {
    window.CycloAnalytics = CycloAnalytics;
}
