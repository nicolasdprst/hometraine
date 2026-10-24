'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

// Charger directement CycloAnalytics
const CycloAnalytics = require('../js/analytics.js');

// ══════════════════════════════════════════════════════════════════════════════
// 1. TESTS MATHÉMATIQUES PURS & STATISTIQUES DE PUISSANCE
// ══════════════════════════════════════════════════════════════════════════════

function testBasicStatsAndWeightedAverage() {
    console.log('--- Test 1.1 : Moyenne pondérée et statistiques de base ---');

    // Cas standard : 5 points réguliers à 1s d'intervalle, 200W constant
    const rawConstant = {
        time: [1, 2, 3, 4, 5],
        watts: [200, 200, 200, 200, 200],
        speed: [30, 30, 30, 30, 30],
        distance: [8.33, 16.66, 25.0, 33.33, 41.66]
    };
    const ptsConstant = CycloAnalytics.normalizeTimeSeries(rawConstant);
    const statsConstant = CycloAnalytics.computeBasicStats(ptsConstant);

    assert.strictEqual(statsConstant.available, true);
    assert.strictEqual(statsConstant.avgPower, 200);
    assert.strictEqual(statsConstant.maxPower, 200);
    assert.strictEqual(statsConstant.avgSpeed, 30.0);
    assert.strictEqual(statsConstant.maxSpeed, 30.0);
    // 200 W * 5 s = 1000 J = 1.0 kJ
    assert.strictEqual(statsConstant.totalWorkKJ, 1);
    assert.strictEqual(statsConstant.powerMeasureTime, 5);
    assert.strictEqual(statsConstant.dataCoverage, 1);

    // Cas linéaire : [100, 200, 300, 400, 500] W à 1s
    const rawLinear = {
        time: [1, 2, 3, 4, 5],
        watts: [100, 200, 300, 400, 500],
        speed: [20, 25, 30, 35, 40]
    };
    const ptsLinear = CycloAnalytics.normalizeTimeSeries(rawLinear);
    const statsLinear = CycloAnalytics.computeBasicStats(ptsLinear);

    assert.strictEqual(statsLinear.avgPower, 300); // (100+200+300+400+500)/5 = 300
    assert.strictEqual(statsLinear.maxPower, 500);
    assert.strictEqual(statsLinear.avgSpeed, 30.0);
    assert.strictEqual(statsLinear.maxSpeed, 40.0);
    // Travail : (100+200+300+400+500) * 1 = 1500 J = 1.5 kJ -> arrondi 2 kJ ou 1 kJ selon Math.round
    assert.strictEqual(statsLinear.totalWorkKJ, 2);

    console.log('✓ Statistiques de base validées.');
}

function testIrregularTimestamps() {
    console.log('--- Test 1.2 : Timestamps irréguliers et pondération temporelle ---');

    // t = [1, 3, 4, 8] : dt = [1, 2, 1, 4]
    // watts = [100, 200, 300, 100]
    // Travail attendu = 100*1 + 200*2 + 300*1 + 100*4 = 100 + 400 + 300 + 400 = 1200 J
    // Temps total valide = 1 + 2 + 1 + 4 = 8 s
    // Puissance moyenne pondérée = 1200 / 8 = 150 W
    // (Une moyenne arithmétique simple non pondérée donnerait (100+200+300+100)/4 = 175 W, ce qui serait faux !)
    const rawIrregular = {
        time: [1, 3, 4, 8],
        watts: [100, 200, 300, 100],
        speed: [10, 20, 30, 10]
    };
    const pts = CycloAnalytics.normalizeTimeSeries(rawIrregular);
    const stats = CycloAnalytics.computeBasicStats(pts);

    assert.strictEqual(stats.powerMeasureTime, 8);
    assert.strictEqual(stats.avgPower, 150, 'La puissance moyenne doit être strictement pondérée par le temps');
    assert.strictEqual(stats.maxPower, 300);

    console.log('✓ Pondération avec timestamps irréguliers validée (150W vs 175W arithmétique).');
}

function testVariabilityAndStandardDeviation() {
    console.log('--- Test 1.3 : Variabilité, écart-type et coefficient de variation ---');

    // Puissance constante -> écart-type = 0, CV = 0
    const rawFlat = {
        time: [1, 2, 3, 4, 5],
        watts: [200, 200, 200, 200, 200]
    };
    const vFlat = CycloAnalytics.computeVariability(CycloAnalytics.normalizeTimeSeries(rawFlat));
    assert.strictEqual(vFlat.available, true);
    assert.strictEqual(vFlat.mean, 200);
    assert.strictEqual(vFlat.stdDev, 0);
    assert.strictEqual(vFlat.cv, 0);
    assert.strictEqual(vFlat.interpretation, 'Effort relativement stable');

    // Puissance variable : [150, 250, 150, 250] à dt=1
    // mean = 200
    // variance = ((150-200)^2 + (250-200)^2 + (150-200)^2 + (250-200)^2) / 4 = (2500*4)/4 = 2500
    // stdDev = sqrt(2500) = 50
    // CV = 50 / 200 * 100 = 25.0 % -> 'Effort variable'
    const rawVar = {
        time: [1, 2, 3, 4],
        watts: [150, 250, 150, 250]
    };
    const vVar = CycloAnalytics.computeVariability(CycloAnalytics.normalizeTimeSeries(rawVar));
    assert.strictEqual(vVar.mean, 200);
    assert.strictEqual(vVar.stdDev, 50);
    assert.strictEqual(vVar.cv, 25.0);
    assert.strictEqual(vVar.interpretation, 'Effort variable');

    // Forte alternance : [100, 300, 100, 300] -> mean=200, stdDev=100, CV=50% -> 'Alternance importante d\'intensités'
    const rawHigh = {
        time: [1, 2, 3, 4],
        watts: [100, 300, 100, 300]
    };
    const vHigh = CycloAnalytics.computeVariability(CycloAnalytics.normalizeTimeSeries(rawHigh));
    assert.strictEqual(vHigh.mean, 200);
    assert.strictEqual(vHigh.stdDev, 100);
    assert.strictEqual(vHigh.cv, 50.0);
    assert.strictEqual(vHigh.interpretation, "Alternance importante d'intensités");

    // Série vide ou insuffisante (< 2 points)
    const rawSingle = { time: [1], watts: [200] };
    const vSingle = CycloAnalytics.computeVariability(CycloAnalytics.normalizeTimeSeries(rawSingle));
    assert.strictEqual(vSingle.available, false);

    console.log('✓ Variabilité, écart-type et CV validés.');
}

function testBestEffortsSlidingWindow() {
    console.log('--- Test 1.4 : Meilleurs efforts (5s, 60s, 300s, 1200s) ---');

    // 1. Séance courte de 10s : 5s doit être disponible, 60s/300s/1200s non disponibles
    const shortTimes = [];
    const shortWatts = [];
    // 0 à 4s : 100W, 5s à 9s : 400W (5 secondes consécutives à 400W)
    for (let i = 1; i <= 10; i++) {
        shortTimes.push(i);
        shortWatts.push(i <= 5 ? 100 : 400);
    }
    const ptsShort = CycloAnalytics.normalizeTimeSeries({ time: shortTimes, watts: shortWatts });
    const effortsShort = CycloAnalytics.computeBestEfforts(ptsShort);

    const e5s = effortsShort.find(e => e.duration === 5);
    const e60s = effortsShort.find(e => e.duration === 60);
    const e300s = effortsShort.find(e => e.duration === 300);
    const e1200s = effortsShort.find(e => e.duration === 1200);

    assert.strictEqual(e5s.available, true);
    assert.strictEqual(e5s.power, 400, 'Le meilleur 5s doit valoir 400W');
    assert.strictEqual(e60s.available, false, '60s ne doit pas être disponible sur 10s');
    assert.strictEqual(e60s.power, null);
    assert.strictEqual(e300s.available, false);
    assert.strictEqual(e1200s.available, false);

    // 2. Séance de 120s avec un pic de 60s à 300W
    const t120 = [];
    const w120 = [];
    for (let i = 1; i <= 120; i++) {
        t120.push(i);
        // De t=31 à t=90 (60s) : 300W, sinon 150W
        w120.push((i >= 31 && i <= 90) ? 300 : 150);
    }
    const pts120 = CycloAnalytics.normalizeTimeSeries({ time: t120, watts: w120 });
    const efforts120 = CycloAnalytics.computeBestEfforts(pts120);

    const eff5_120 = efforts120.find(e => e.duration === 5);
    const eff60_120 = efforts120.find(e => e.duration === 60);
    const eff300_120 = efforts120.find(e => e.duration === 300);

    assert.strictEqual(eff5_120.available, true);
    assert.strictEqual(eff5_120.power, 300);
    assert.strictEqual(eff60_120.available, true);
    assert.strictEqual(eff60_120.power, 300, 'Le meilleur 60s doit valoir 300W');
    assert.strictEqual(eff300_120.available, false, '300s non disponible sur 120s');

    // 3. Rejet des fenêtres traversant des interruptions (> MAX_GAP_SECONDS)
    // Séries : 30s à 400W, interruption de 30s, 30s à 400W
    // Le 60s ne doit PAS pouvoir combiner les deux blocs à travers le trou !
    const tGap = [];
    const wGap = [];
    for (let i = 1; i <= 30; i++) {
        tGap.push(i);
        wGap.push(400);
    }
    // Trou de t=30 à t=60 (gap de 30s > 10s)
    for (let i = 61; i <= 90; i++) {
        tGap.push(i);
        wGap.push(400);
    }
    const ptsGap = CycloAnalytics.normalizeTimeSeries({ time: tGap, watts: wGap });
    const effortsGap = CycloAnalytics.computeBestEfforts(ptsGap);
    const eff60Gap = effortsGap.find(e => e.duration === 60);
    assert.strictEqual(eff60Gap.available, false, 'Un effort continu de 60s ne peut pas traverser un trou de 30s');

    console.log('✓ Meilleurs efforts et gestion des interruptions validés.');
}

function testLongSessionPerformance() {
    console.log('--- Test 1.5 : Performance sur séance de 2 heures (7200 points) ---');

    const t7200 = [];
    const w7200 = [];
    const s7200 = [];
    const d7200 = [];
    for (let i = 1; i <= 7200; i++) {
        t7200.push(i);
        // Variations réalistes
        const base = 200 + Math.sin(i / 100) * 50;
        w7200.push(Math.round(base));
        s7200.push(28.5);
        d7200.push(i * 7.9);
    }

    const tStart = Date.now();
    const result = CycloAnalytics.analyzeSession(
        { time: t7200, watts: w7200, speed: s7200, distance: d7200 },
        220,
        true
    );
    const tElapsed = Date.now() - tStart;

    assert.strictEqual(result.hasDetailedData, true);
    assert.strictEqual(result.basicStats.available, true);
    assert.strictEqual(result.basicStats.totalDuration, 7200);
    assert.strictEqual(result.bestEfforts.length, 4);
    assert(result.bestEfforts.every(e => e.available === true), 'Tous les efforts (jusqu\'à 20 min) doivent être disponibles sur 2h');
    assert(result.chartData.power.length <= 305, 'Le sous-échantillonnage doit limiter les points à ~300');
    assert(tElapsed < 500, `L'analyse complète de 2h doit s'exécuter en moins de 500ms (pris ${tElapsed}ms)`);

    console.log(`✓ Analyse de 7200 points (2h) terminée en ${tElapsed}ms.`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. TESTS DE ZONES DE PUISSANCE FTP
// ══════════════════════════════════════════════════════════════════════════════

function testZoneDistribution() {
    console.log('--- Test 2.1 : Répartition par zones FTP et frontières strictes ---');

    const ftp = 200;
    // Z1: 0 à 110 W (< 55 %)
    // Z2: 110 à 150 W (55 % - 75 %)
    // Z3: 150 à 180 W (75 % - 90 %)
    // Z4: 180 à 210 W (90 % - 105 %)
    // Z5: 210 à 240 W (105 % - 120 %)
    // Z6: > 240 W (> 120 %)

    // Série avec 10s dans chaque zone exactement
    const t = [];
    const w = [];
    const testPowers = [
        50,  // Z1
        130, // Z2
        165, // Z3
        195, // Z4
        225, // Z5
        260  // Z6
    ];

    let curT = 1;
    for (const p of testPowers) {
        for (let i = 0; i < 10; i++) {
            t.push(curT++);
            w.push(p);
        }
    }

    const pts = CycloAnalytics.normalizeTimeSeries({ time: t, watts: w });
    const zd = CycloAnalytics.computeZoneDistribution(pts, ftp);

    assert.strictEqual(zd.available, true);
    assert.strictEqual(zd.ftp, 200);
    assert.strictEqual(zd.totalValidTime, 60);

    for (let i = 0; i < 6; i++) {
        const z = zd.zones[i];
        assert.strictEqual(z.duration, 10, `Zone ${z.id} doit durer 10s`);
        assert.strictEqual(z.percentage, 16.7, `Zone ${z.id} doit représenter ~16.7%`);
    }

    // Test d'une mesure réelle à 0 W -> doit appartenir à Z1
    const rawZero = { time: [1, 2], watts: [0, 0] };
    const zdZero = CycloAnalytics.computeZoneDistribution(CycloAnalytics.normalizeTimeSeries(rawZero), 200);
    assert.strictEqual(zdZero.zones[0].duration, 2, '0W réel doit appartenir à Z1');
    assert.strictEqual(zdZero.zones[0].percentage, 100);

    // Test mesure manquante (null) -> ne doit pas être comptabilisée
    const rawNull = { time: [1, 2, 3], watts: [100, null, 100] };
    const zdNull = CycloAnalytics.computeZoneDistribution(CycloAnalytics.normalizeTimeSeries(rawNull), 200);
    assert.strictEqual(zdNull.totalValidTime, 2, 'Les mesures nulles ne doivent pas être comptabilisées dans le temps valide');

    // Test frontières exactes
    const rawBorders = {
        time: [1, 2, 3, 4, 5, 6],
        watts: [109, 110, 150, 180, 210, 240]
    };
    const zdBorders = CycloAnalytics.computeZoneDistribution(CycloAnalytics.normalizeTimeSeries(rawBorders), 200);
    // 109 -> Z1
    // 110 -> Z2
    // 150 -> Z3
    // 180 -> Z4
    // 210 -> Z5
    // 240 -> Z6
    assert.strictEqual(zdBorders.zones[0].duration, 1, '109 W -> Z1');
    assert.strictEqual(zdBorders.zones[1].duration, 1, '110 W -> Z2');
    assert.strictEqual(zdBorders.zones[2].duration, 1, '150 W -> Z3');
    assert.strictEqual(zdBorders.zones[3].duration, 1, '180 W -> Z4');
    assert.strictEqual(zdBorders.zones[4].duration, 1, '210 W -> Z5');
    assert.strictEqual(zdBorders.zones[5].duration, 1, '240 W -> Z6');

    console.log('✓ Répartition par zones FTP et gestion des frontières validées.');
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. TESTS DE GESTION DES DONNÉES & CAS LIMITES
// ══════════════════════════════════════════════════════════════════════════════

function testDataEdgeCases() {
    console.log('--- Test 3.1 : Cas limites de données (null, vides, corrompues) ---');

    // Données nulles ou non-objet
    assert.strictEqual(CycloAnalytics.normalizeTimeSeries(null), null);
    assert.strictEqual(CycloAnalytics.normalizeTimeSeries({}), null);
    assert.strictEqual(CycloAnalytics.normalizeTimeSeries({ time: [] }), null);
    assert.strictEqual(CycloAnalytics.normalizeTimeSeries({ time: ['invalid'] }), null);

    // Analyse sur données absentes
    const emptyAnalysis = CycloAnalytics.analyzeSession(null, 200, false);
    assert.strictEqual(emptyAnalysis.hasDetailedData, false);
    assert.strictEqual(emptyAnalysis.basicStats.available, false);
    assert.strictEqual(emptyAnalysis.variability.available, false);
    assert.strictEqual(emptyAnalysis.zones.available, false);
    assert.strictEqual(emptyAnalysis.chartData, null);
    assert.strictEqual(emptyAnalysis.bestEfforts.length, 4);
    assert(emptyAnalysis.bestEfforts.every(e => !e.available));

    // Séries de longueurs différentes
    const mismatched = {
        time: [1, 2, 3, 4],
        watts: [100, 200], // plus court
        speed: [20, 25, 30, 35, 40] // plus long
    };
    const ptsMismatched = CycloAnalytics.normalizeTimeSeries(mismatched);
    assert.strictEqual(ptsMismatched.length, 4);
    assert.strictEqual(ptsMismatched[2].watts, null);
    assert.strictEqual(ptsMismatched[3].watts, null);
    assert.strictEqual(ptsMismatched[2].speed, 30);

    console.log('✓ Cas limites de données validés.');
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. TESTS DU CONTRAT DOM & SESSION-DETAIL
// ══════════════════════════════════════════════════════════════════════════════

function testSessionDetailLogic() {
    console.log('--- Test 4.1 : Logique de SessionDetail et FTP historique ---');

    // Charger SessionDetail dans un environnement VM simulé
    const domContext = vm.createContext({
        console,
        window: null,
        document: {
            getElementById: id => ({
                id,
                style: {},
                appendChild: () => {},
                classList: { add: () => {}, remove: () => {} },
                innerHTML: '',
                textContent: ''
            }),
            createElement: tag => ({
                tagName: tag,
                className: '',
                style: {},
                appendChild: () => {},
                append: () => {},
                setAttribute: () => {},
                classList: { add: () => {}, remove: () => {} }
            }),
            querySelector: () => ({ style: {} }),
            querySelectorAll: () => []
        },
        CycloAnalytics,
        requestAnimationFrame: cb => cb(),
        Date
    });
    domContext.window = domContext;
    vm.runInContext(source('js/session-detail.js'), domContext, { filename: 'js/session-detail.js' });
    const SD = domContext.SessionDetail;

    // Test de résolution FTP
    // Cas 1 : Séance avec FTP historique enregistrée
    const s1 = { id: 's1', ftp_at_session_watts: 245 };
    const p1 = { id: 'p1', ftp_watts: 200 };
    const r1 = SD.resolveFtp(s1, p1);
    assert.strictEqual(r1.ftp, 245);
    assert.strictEqual(r1.isHistorical, true);

    // Cas 2 : Séance ancienne sans FTP historique (NULL)
    const s2 = { id: 's2', ftp_at_session_watts: null };
    const p2 = { id: 'p2', ftp_watts: 230 };
    const r2 = SD.resolveFtp(s2, p2);
    assert.strictEqual(r2.ftp, 230);
    assert.strictEqual(r2.isHistorical, false);

    // Cas 3 : Séance sans FTP et profil sans FTP (défaut 200W)
    const s3 = { id: 's3' };
    const p3 = { id: 'p3' };
    const r3 = SD.resolveFtp(s3, p3);
    assert.strictEqual(r3.ftp, 200);
    assert.strictEqual(r3.isHistorical, false);

    console.log('✓ Résolution FTP (historique vs actuelle) validée.');
}

function testVisualAndContractChecks() {
    console.log('--- Test 4.2 : Contrat visuel et structure des fichiers Batch 4 ---');

    const html = source('index.html');
    const css = source('css/session-detail.css');
    const sw = source('service-worker.js');
    const historySrc = source('js/history.js');
    const profilesSrc = source('js/profiles.js');

    // Vérifications HTML
    assert(html.includes('sessionAnalyticsView'), 'index.html doit contenir sessionAnalyticsView');
    assert(html.includes('analyticsLoader'), 'index.html doit contenir analyticsLoader');
    assert(html.includes('analyticsContent'), 'index.html doit contenir analyticsContent');
    assert(html.includes('css/session-detail.css'), 'index.html doit inclure session-detail.css');
    assert(html.includes('js/analytics.js'), 'index.html doit inclure analytics.js');
    assert(html.includes('js/session-detail.js'), 'index.html doit inclure session-detail.js');

    // Vérifications CSS
    assert(css.includes('#sessionAnalyticsView'), 'CSS doit cibler sessionAnalyticsView');
    assert(css.includes('min-height: 44px') || css.includes('min-height: 48px'), 'Les boutons doivent respecter la taille tactile mobile');
    assert(css.includes('.sa-stats-grid'), 'Grille de statistiques présente');
    assert(css.includes('.sa-zone-bar'), 'Barre de zones FTP présente');
    assert(css.includes('.sa-effort-card'), 'Cartes de meilleurs efforts présentes');

    // Vérifications Service Worker
    assert(sw.includes('cyclodash-v20-analytics-v4'), 'Service Worker doit avoir le nouveau cache v20');
    assert(sw.includes('./css/session-detail.css'), 'Service Worker doit mettre en cache session-detail.css');
    assert(sw.includes('./js/analytics.js'), 'Service Worker doit mettre en cache analytics.js');
    assert(sw.includes('./js/session-detail.js'), 'Service Worker doit mettre en cache session-detail.js');

    // Vérifications History
    assert(historySrc.includes('Voir l\'analyse'), 'history.js doit contenir le bouton Voir l\'analyse');
    assert(historySrc.includes('ftp_at_session_watts'), 'history.js doit mémoriser ftp_at_session_watts à la fin de la séance');
    assert(historySrc.includes('onSessionDeleted'), 'history.js doit notifier SessionDetail lors de la suppression');

    // Vérifications Profiles
    assert(profilesSrc.includes('SessionDetail.close'), 'profiles.js doit fermer SessionDetail lors du changement de profil');

    // Vérification de la migration SQL
    const migration = source('supabase/migrations/20261024_003_session_analytics.sql');
    assert(migration.includes('ADD COLUMN IF NOT EXISTS ftp_at_session_watts INTEGER'), 'Migration SQL doit ajouter ftp_at_session_watts');

    console.log('✓ Contrat visuel, fichiers et intégrations validés.');
}

// ══════════════════════════════════════════════════════════════════════════════
// EXÉCUTION DE TOUS LES TESTS
// ══════════════════════════════════════════════════════════════════════════════

(() => {
    console.log('=======================================================');
    console.log('LANCEMENT DE LA SUITE DE TESTS DU BATCH 4 (ANALYTICS)');
    console.log('=======================================================');

    testBasicStatsAndWeightedAverage();
    testIrregularTimestamps();
    testVariabilityAndStandardDeviation();
    testBestEffortsSlidingWindow();
    testLongSessionPerformance();
    testZoneDistribution();
    testDataEdgeCases();
    testSessionDetailLogic();
    testVisualAndContractChecks();

    console.log('\n=======================================================');
    console.log('TOUS LES TESTS AUTOMATISÉS DU BATCH 4 SONT RÉUSSIS !');
    console.log('=======================================================');
})();
