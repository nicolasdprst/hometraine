// --- GESTION DE L'HISTORIQUE INDIVIDUEL, EXPORT TCX & SYNCHRONISATION ---

// Sauvegarde principale appelée à la fin d'une séance (dans stopSession)
async function saveSessionToHistory() {
    if (state.pedalingTime < 10) {
        alert("Session trop courte (< 10s), non sauvegardée.");
        // Nettoyage de la sauvegarde temporaire
        localStorage.removeItem('cyclodash_active_session_backup');
        return;
    }

    const activeProfile = window.profilesManager ? window.profilesManager.activeProfile : null;
    const profileId = activeProfile ? activeProfile.id : 'default-profile';
    const sessionId = state.currentSessionId || crypto.randomUUID();

    const avgWatts = Math.round(state.sumWatts / state.pedalingTime);
    const maxWatts = Math.round(state.maxWatts);
    const avgSpeed = parseFloat((state.sumSpeed / state.pedalingTime).toFixed(1));
    const maxSpeed = parseFloat(state.maxSpeed.toFixed(1));
    const totalDistM = state.totalDistanceM;
    const totalWorkKJ = Math.round(state.sumWatts / 1000);
    const energyKcal = totalWorkKJ;

    const sessionSummary = {
        id: sessionId,
        profile_id: profileId,
        started_at: state.startTime ? state.startTime.toISOString() : new Date().toISOString(),
        ended_at: state.stopTime ? state.stopTime.toISOString() : new Date().toISOString(),
        duration_seconds: state.pedalingTime,
        distance_meters: totalDistM,
        avg_power_watts: avgWatts,
        max_power_watts: maxWatts,
        avg_speed_kmh: avgSpeed,
        max_speed_kmh: maxSpeed,
        total_work_kj: totalWorkKJ,
        energy_kcal: energyKcal,
        workout_name: (state.activeWorkout && state.activeWorkout.name) ? state.activeWorkout.name : 'Roule Libre',
        synced: false
    };

    const detailedData = {
        time: [...state.sessionData.time],
        watts: [...state.sessionData.watts],
        speed: [...state.sessionData.speed]
    };

    // 1. Sauvegarde locale immédiate (historique résumés)
    let sessions = getStoredSessions();
    // Éviter tout doublon éventuel
    sessions = sessions.filter(s => s.id !== sessionId);
    sessions.unshift(sessionSummary);
    // Limite raisonnable en cache local
    if (sessions.length > 100) sessions.pop();
    saveStoredSessions(sessions);

    // 2. Sauvegarde locale des séries temporelles détaillées pour export TCX ultérieur
    try {
        localStorage.setItem(`cyclodash_raw_${sessionId}`, JSON.stringify(detailedData));
    } catch (e) {
        console.warn("Stockage local séries temporelles saturé:", e);
    }

    // 3. Suppression du backup temporaire
    localStorage.removeItem('cyclodash_active_session_backup');

    // 4. Synchronisation Supabase en arrière-plan
    if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
        try {
            await window.supabaseClient.saveSession(sessionSummary, detailedData);
            sessionSummary.synced = true;
            saveStoredSessions(sessions);
            console.log("Séance synchronisée avec Supabase avec succès");
        } catch (err) {
            console.warn("Échec synchronisation Supabase immédiate, mise en file d'attente:", err);
            enqueueSync(sessionId);
        }
    } else {
        enqueueSync(sessionId);
    }

    // 5. Proposer le téléchargement direct du fichier Strava TCX
    if (confirm("Séance enregistrée ! Voulez-vous télécharger le fichier Strava (.tcx) maintenant ?")) {
        downloadTCX(sessionId, sessionSummary, detailedData);
    }

    renderHistory();
}

// Récupérer les séances depuis le stockage local
function getStoredSessions() {
    try {
        const raw = localStorage.getItem('cyclodash_sessions_v2');
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error("Erreur lecture cyclodash_sessions_v2:", e);
        return [];
    }
}

function saveStoredSessions(sessions) {
    try {
        localStorage.setItem('cyclodash_sessions_v2', JSON.stringify(sessions));
    } catch (e) {
        console.error("Erreur écriture cyclodash_sessions_v2:", e);
    }
}

// Queue de synchronisation hors-ligne
function enqueueSync(sessionId) {
    try {
        let queue = JSON.parse(localStorage.getItem('cyclodash_sync_queue') || '[]');
        if (!queue.includes(sessionId)) queue.push(sessionId);
        localStorage.setItem('cyclodash_sync_queue', JSON.stringify(queue));
    } catch(e) {}
}

async function processSyncQueue() {
    if (!window.supabaseClient || !window.supabaseClient.isAuthenticated()) return;
    try {
        let queue = JSON.parse(localStorage.getItem('cyclodash_sync_queue') || '[]');
        if (queue.length === 0) return;

        const sessions = getStoredSessions();
        const newQueue = [];

        for (const id of queue) {
            const sess = sessions.find(s => s.id === id);
            if (!sess) continue;

            let detailed = null;
            try {
                const raw = localStorage.getItem(`cyclodash_raw_${id}`);
                if (raw) detailed = JSON.parse(raw);
            } catch(e) {}

            try {
                await window.supabaseClient.saveSession(sess, detailed);
                sess.synced = true;
                console.log(`Séance ${id} synchronisée depuis la file d'attente.`);
            } catch (err) {
                console.warn(`Échec synchronisation séance ${id}:`, err);
                newQueue.push(id);
            }
        }

        saveStoredSessions(sessions);
        localStorage.setItem('cyclodash_sync_queue', JSON.stringify(newQueue));
        renderHistory();
    } catch (err) {
        console.warn("Erreur processSyncQueue:", err);
    }
}

// Écouteur de retour réseau pour vider la file
window.addEventListener('online', () => {
    console.log("Connexion rétablie, tentative de synchronisation des séances...");
    processSyncQueue();
});

// Rendu de l'historique filtré par profil actif
async function renderHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;

    const activeProfile = window.profilesManager ? window.profilesManager.activeProfile : null;
    const profileId = activeProfile ? activeProfile.id : null;

    // Vérifier si des anciennes séances du Batch 1 doivent être migrées
    checkLegacyHistoryBanner();

    let allSessions = getStoredSessions();

    // Si connecté à Supabase, fusionner les séances distantes pour ce profil
    if (window.supabaseClient && window.supabaseClient.isAuthenticated() && profileId) {
        try {
            const remoteSessions = await window.supabaseClient.fetchSessions(profileId, 50);
            if (Array.isArray(remoteSessions) && remoteSessions.length > 0) {
                const map = new Map();
                remoteSessions.forEach(s => {
                    s.synced = true;
                    map.set(s.id, s);
                });
                allSessions.forEach(s => {
                    if (!map.has(s.id)) map.set(s.id, s);
                });
                allSessions = Array.from(map.values());
                allSessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
                saveStoredSessions(allSessions);
            }
        } catch (e) {
            console.warn("Consultation des séances Supabase différée:", e);
        }
    }

    // Filtrer pour le profil actif
    const profileSessions = profileId ? allSessions.filter(s => s.profile_id === profileId) : allSessions;

    // Rendu des statistiques personnelles agrégées
    renderPersonalStats(profileSessions);

    if (profileSessions.length === 0) {
        list.innerHTML = `
            <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-secondary);">
                <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🚴</div>
                <div style="font-weight: 600; font-size: 1.05rem; color: var(--text-primary);">Aucune activité pour ${activeProfile ? activeProfile.display_name : 'ce profil'}</div>
                <p style="font-size: 0.85rem; margin-top: 0.35rem;">Démarrez une séance sur le Compteur pour enregistrer vos premiers tours de roue !</p>
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    profileSessions.forEach(s => {
        const dateObj = new Date(s.started_at || s.date);
        const dateStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + 
                        ' à ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const syncBadge = s.synced 
            ? '<span title="Synchronisé avec Supabase" style="color: var(--success); font-size: 0.75rem;">☁️ Sync</span>'
            : '<span title="En attente de synchronisation" style="color: var(--warning); font-size: 0.75rem;">⏳ Local</span>';

        const item = document.createElement('div');
        item.className = 'list-item history-item-card';
        item.style.marginBottom = '0.75rem';

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; width: 100%;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                        <span style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${s.workout_name || 'Roule Libre'}</span>
                        ${syncBadge}
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.4rem;">
                        📅 ${dateStr}
                    </div>
                    <div class="history-metrics-row" style="display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.85rem;">
                        <span>⏱ <strong>${formatTime(s.duration_seconds || s.duration || 0)}</strong></span>
                        <span>📏 <strong>${((s.distance_meters || s.distance || 0) / 1000).toFixed(2)} km</strong></span>
                        <span>⚡ <strong>${s.avg_power_watts || s.avgWatts || 0} W</strong> moy ${s.max_power_watts ? `(${s.max_power_watts} max)` : ''}</span>
                        <span>🚴 <strong>${s.avg_speed_kmh || s.avgSpeed || '0.0'} km/h</strong></span>
                        ${s.total_work_kj ? `<span>🔥 <strong>${s.total_work_kj} kJ</strong></span>` : ''}
                    </div>
                </div>
                <div style="flex-shrink: 0; align-self: center;">
                    <button class="btn btn-sm btn-primary" onclick="exportTCXById('${s.id}')" title="Télécharger le fichier Strava TCX">
                        📥 TCX
                    </button>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

// Statistiques agrégées du profil
function renderPersonalStats(sessions) {
    const statsContainer = document.getElementById('personalStatsContainer');
    if (!statsContainer) return;

    if (!sessions || sessions.length === 0) {
        statsContainer.style.display = 'none';
        return;
    }

    statsContainer.style.display = 'block';

    const count = sessions.length;
    let totalSec = 0;
    let totalDistM = 0;
    let weightedWattsSum = 0;
    let validDurationForWatts = 0;

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 3600 * 1000);
    let count30d = 0;

    sessions.forEach(s => {
        const dur = s.duration_seconds || s.duration || 0;
        const dist = s.distance_meters || s.distance || 0;
        const w = s.avg_power_watts || s.avgWatts || 0;
        const dateTs = new Date(s.started_at || s.date).getTime();

        totalSec += dur;
        totalDistM += dist;
        if (w > 0 && dur > 0) {
            weightedWattsSum += (w * dur);
            validDurationForWatts += dur;
        }

        if (dateTs >= thirtyDaysAgo) {
            count30d++;
        }
    });

    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
    const distKm = (totalDistM / 1000).toFixed(1);
    const avgWattsWeighted = validDurationForWatts > 0 ? Math.round(weightedWattsSum / validDurationForWatts) : 0;

    document.getElementById('statTotalSessions').innerText = count;
    document.getElementById('statTotalTime').innerText = timeStr;
    document.getElementById('statTotalDist').innerText = `${distKm} km`;
    document.getElementById('statAvgWatts').innerText = `${avgWattsWeighted} W`;
    document.getElementById('stat30Days').innerText = count30d;
}

// Téléchargement d'un fichier TCX par identifiant de session
async function exportTCXById(sessionId) {
    const sessions = getStoredSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
        alert("Séance introuvable.");
        return;
    }

    // 1. Chercher d'abord les données détaillées en cache local
    let detailed = null;
    try {
        const raw = localStorage.getItem(`cyclodash_raw_${sessionId}`);
        if (raw) detailed = JSON.parse(raw);
    } catch(e) {}

    // 2. Si non trouvées en local et connecté à Supabase, chercher sur Supabase session_data
    if ((!detailed || !detailed.time || detailed.time.length === 0) && window.supabaseClient && window.supabaseClient.isAuthenticated()) {
        try {
            detailed = await window.supabaseClient.fetchSessionData(sessionId);
        } catch (e) {
            console.warn("Échec récupération séries Supabase:", e);
        }
    }

    // 3. Si toujours aucune donnée détaillée (ex: ancienne séance migrée du Batch 1 qui n'avait qu'un résumé)
    if (!detailed || !detailed.time || detailed.time.length === 0) {
        alert("Les mesures seconde par seconde de cette ancienne séance ne sont pas disponibles. Le fichier TCX détaillé ne peut pas être généré artificiellement.");
        return;
    }

    downloadTCX(sessionId, session, detailed);
}

// Génération et téléchargement effectif du XML TCX
function downloadTCX(sessionId, session, detailedData) {
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

    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
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

    const blob = new Blob([tcx], { type: "application/vnd.garmin.tcx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CycloDash_${dateIso.replace(/[:.]/g, '-')}.tcx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- MIGRATION DES ANCIENS HISTORIQUES (CYCLODASH_HISTORY) ---
function checkLegacyHistoryBanner() {
    const banner = document.getElementById('legacyMigrationBanner');
    if (!banner) return;

    const migrated = localStorage.getItem('cyclodash_legacy_migrated') === 'true';
    if (migrated) {
        banner.style.display = 'none';
        return;
    }

    try {
        const rawLegacy = localStorage.getItem('cyclodash_history');
        if (!rawLegacy) {
            banner.style.display = 'none';
            return;
        }
        const legacyList = JSON.parse(rawLegacy);
        if (Array.isArray(legacyList) && legacyList.length > 0) {
            banner.style.display = 'block';
            const countEl = document.getElementById('legacySessionCount');
            if (countEl) countEl.innerText = legacyList.length;
        } else {
            banner.style.display = 'none';
        }
    } catch (e) {
        banner.style.display = 'none';
    }
}

async function migrateLegacyHistory() {
    try {
        const rawLegacy = localStorage.getItem('cyclodash_history');
        if (!rawLegacy) return;
        const legacyList = JSON.parse(rawLegacy);
        if (!Array.isArray(legacyList) || legacyList.length === 0) return;

        const activeProfile = window.profilesManager ? window.profilesManager.activeProfile : null;
        if (!activeProfile) {
            alert("Veuillez sélectionner un profil avant d'importer l'historique.");
            return;
        }

        const confirmImport = confirm(`Importer ${legacyList.length} ancienne(s) séance(s) dans le profil "${activeProfile.display_name}" ?`);
        if (!confirmImport) return;

        let sessions = getStoredSessions();
        const existingDates = new Set(sessions.map(s => s.started_at));

        let importedCount = 0;
        legacyList.forEach(item => {
            const dateIso = item.date ? new Date(item.date).toISOString() : new Date().toISOString();
            if (!existingDates.has(dateIso)) {
                const migratedItem = {
                    id: crypto.randomUUID(),
                    profile_id: activeProfile.id,
                    started_at: dateIso,
                    ended_at: dateIso,
                    duration_seconds: item.duration || 0,
                    distance_meters: item.distance || 0,
                    avg_power_watts: item.avgWatts || 0,
                    max_power_watts: item.maxWatts || item.avgWatts || 0,
                    avg_speed_kmh: parseFloat(item.avgSpeed || 0),
                    max_speed_kmh: parseFloat(item.avgSpeed || 0),
                    total_work_kj: Math.round((item.avgWatts || 0) * (item.duration || 0) / 1000),
                    energy_kcal: Math.round((item.avgWatts || 0) * (item.duration || 0) / 1000),
                    workout_name: 'Séance importée',
                    synced: false
                };
                sessions.push(migratedItem);
                importedCount++;
            }
        });

        sessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
        saveStoredSessions(sessions);

        localStorage.setItem('cyclodash_legacy_migrated', 'true');
        alert(`${importedCount} séance(s) importée(s) avec succès dans le profil "${activeProfile.display_name}".`);

        checkLegacyHistoryBanner();
        renderHistory();

        // Tenter synchronisation si connecté
        processSyncQueue();
    } catch (e) {
        alert(`Erreur pendant la migration : ${e.message}`);
    }
}

// Expositions globales
window.saveSessionToHistory = saveSessionToHistory;
window.renderHistory = renderHistory;
window.exportTCXById = exportTCXById;
window.migrateLegacyHistory = migrateLegacyHistory;
window.processSyncQueue = processSyncQueue;
