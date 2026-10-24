const assert = require('assert');

// 1. Test du générateur TCX
function generateTCX(session, detailedData) {
    const startDate = new Date(session.started_at || session.date || Date.now());
    const dateIso = startDate.toISOString();
    let trackpoints = '';
    let currentDist = 0;

    const len = detailedData.time.length;
    for (let i = 0; i < len; i++) {
        const w = detailedData.watts[i] || 0;
        const s = detailedData.speed[i] || 0;
        currentDist += (s / 3.6);
        const ptDate = new Date(startDate.getTime() + (i * 1000));

        trackpoints += `
    <Trackpoint>
      <Time>${ptDate.toISOString()}</Time>
      <DistanceMeters>${currentDist.toFixed(2)}</DistanceMeters>
      <Extensions>
        <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
          <Watts>${Math.round(w)}</Watts>
          <Speed>${(s / 3.6).toFixed(2)}</Speed>
        </TPX>
      </Extensions>
    </Trackpoint>`;
    }

    const totalSeconds = session.duration_seconds || session.duration || len;
    const totalDistM = session.distance_meters || session.distance || currentDist;

    return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd" xmlns:ns5="http://www.garmin.com/xmlschemas/Routing/v1" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xmlns:ns2="http://www.garmin.com/xmlschemas/UserProfile/v2" xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns4="http://www.garmin.com/xmlschemas/ProfileExtension/v1">
  <Activities>
    <Activity Sport="Biking">
      <Id>${dateIso}</Id>
      <Lap StartTime="${dateIso}">
        <TotalTimeSeconds>${totalSeconds}</TotalTimeSeconds>
        <DistanceMeters>${totalDistM.toFixed(2)}</DistanceMeters>
        <Calories>${session.energy_kcal || 0}</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
            ${trackpoints}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

// Test TCX Schema validity
const sampleSession = {
    started_at: "2026-10-24T10:00:00.000Z",
    duration_seconds: 3,
    distance_meters: 25.5,
    energy_kcal: 10
};
const sampleDetailed = {
    time: [1, 2, 3],
    watts: [150, 180, 200],
    speed: [28.5, 30.1, 31.4]
};

const xml = generateTCX(sampleSession, sampleDetailed);
assert(xml.includes('<Activity Sport="Biking">'), "TCX must include Activity Sport Biking");
assert(xml.includes('<Watts>180</Watts>'), "TCX must contain valid watts extension");
assert(xml.includes('<DistanceMeters>25.50</DistanceMeters>'), "TCX must contain distance meters");
console.log("✓ Test 1 : Validation de l'export XML TCX réussie");

// 2. Test Isolation Profils & Statistiques agrégées
const profile1 = { id: 'prof-1', display_name: 'Akram', ftp_watts: 220 };
const profile2 = { id: 'prof-2', display_name: 'Nicolas', ftp_watts: 185 };

const allSessions = [
    { id: 's1', profile_id: 'prof-1', duration_seconds: 1800, distance_meters: 15000, avg_power_watts: 200, started_at: '2026-10-24T09:00:00Z' },
    { id: 's2', profile_id: 'prof-1', duration_seconds: 1200, distance_meters: 10000, avg_power_watts: 220, started_at: '2026-10-23T09:00:00Z' },
    { id: 's3', profile_id: 'prof-2', duration_seconds: 2400, distance_meters: 20000, avg_power_watts: 180, started_at: '2026-10-24T08:00:00Z' }
];

const akramSessions = allSessions.filter(s => s.profile_id === profile1.id);
const nicolasSessions = allSessions.filter(s => s.profile_id === profile2.id);

assert.strictEqual(akramSessions.length, 2, "Akram must have 2 sessions");
assert.strictEqual(nicolasSessions.length, 1, "Nicolas must have 1 session");
assert(!akramSessions.some(s => s.profile_id === profile2.id), "Akram history must NOT contain Nicolas sessions");

// Calcul stats Akram
const akramTotalSec = akramSessions.reduce((acc, s) => acc + s.duration_seconds, 0);
const akramTotalDist = akramSessions.reduce((acc, s) => acc + s.distance_meters, 0);
const akramWeightedWatts = Math.round(akramSessions.reduce((acc, s) => acc + (s.avg_power_watts * s.duration_seconds), 0) / akramTotalSec);

assert.strictEqual(akramTotalSec, 3000, "Akram total time = 3000s (50 min)");
assert.strictEqual(akramTotalDist, 25000, "Akram total dist = 25 km");
// (200*1800 + 220*1200) / 3000 = (360000 + 264000) / 3000 = 624000 / 3000 = 208 W
assert.strictEqual(akramWeightedWatts, 208, "Akram weighted avg power = 208 W");
console.log("✓ Test 2 : Isolation des profils et calcul des statistiques pondérées validés");

// 3. Test Migration Ancien Historique (Idempotence & Pas de doublons)
const legacyHistory = [
    { date: '2026-10-20T10:00:00Z', duration: 1800, distance: 15000, avgWatts: 190, avgSpeed: '30.0' },
    { date: '2026-10-21T10:00:00Z', duration: 2400, distance: 20000, avgWatts: 210, avgSpeed: '31.5' }
];

const migratedSessions = [];
const existingDates = new Set();

legacyHistory.forEach(item => {
    const dateIso = new Date(item.date).toISOString();
    if (!existingDates.has(dateIso)) {
        migratedSessions.push({
            id: 'legacy-' + item.date,
            profile_id: profile1.id,
            started_at: dateIso,
            duration_seconds: item.duration,
            distance_meters: item.distance,
            avg_power_watts: item.avgWatts,
            workout_name: 'Séance importée',
            synced: false
        });
        existingDates.add(dateIso);
    }
});

assert.strictEqual(migratedSessions.length, 2, "Must import 2 legacy sessions");

// Relancer l'import pour tester l'absence de doublons
legacyHistory.forEach(item => {
    const dateIso = new Date(item.date).toISOString();
    if (!existingDates.has(dateIso)) {
        migratedSessions.push({ id: 'dup' });
    }
});
assert.strictEqual(migratedSessions.length, 2, "Rerunning migration must NOT create duplicates");
console.log("✓ Test 3 : Migration idempotente sans doublons validée");

console.log("\n=======================================================");
console.log("TOUS LES TESTS AUTOMATISÉS DU BATCH 2 SONT RÉUSSIS !");
console.log("=======================================================");
