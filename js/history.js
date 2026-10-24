// --- GESTION DE L'HISTORIQUE INDIVIDUEL, EXPORT TCX & SYNCHRONISATION ---

let syncQueuePromise = null;

function createLegacySessionId(profileId, dateIso) {
    const input = `${profileId}|${dateIso}`;
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const block = (hash >>> 0).toString(16).padStart(8, '0');
    return `${block}-${block.slice(0, 4)}-5${block.slice(1, 4)}-8${block.slice(1, 4)}-${block}${block.slice(0, 4)}`;
}

// Sauvegarde principale appelée à la fin d'une séance (dans stopSession)
async function saveSessionToHistory() {
    if (state.pedalingTime < 10) {
        alert("Session trop courte (< 10s), non sauvegardée.");
        // Nettoyage de la sauvegarde temporaire
        localDataStore.remove('active_session_backup');
        return;
    }

    const activeProfile = window.profilesManager ? window.profilesManager.activeProfile : null;
    const profileId = state.sessionProfileId || (activeProfile ? activeProfile.id : null);
    if (!profileId) throw new Error('Aucun profil associé à la séance');
    const sessionId = state.currentSessionId || createCycloDashId();

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
        duration_seconds: Math.round(state.pedalingTime),
        distance_meters: totalDistM,
        avg_power_watts: avgWatts,
        max_power_watts: maxWatts,
        avg_speed_kmh: avgSpeed,
        max_speed_kmh: maxSpeed,
        total_work_kj: totalWorkKJ,
        energy_kcal: energyKcal,
        workout_name: (state.activeWorkout && state.activeWorkout.name) ? state.activeWorkout.name : 'Roule Libre',
        synced: false,
        sync_status: 'pending'
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
    // Ne jamais évincer arbitrairement une séance, surtout si elle attend sa synchronisation.
    if (!saveStoredSessions(sessions)) {
        alert('La séance n’a pas pu être enregistrée localement. Libérez de l’espace puis réessayez.');
        return;
    }

    // 2. Sauvegarde locale des séries temporelles détaillées pour export TCX ultérieur
    try {
        await cycloDb.put('session-data', sessionId, detailedData);
    } catch (e) {
        alert('Le résumé est sauvegardé, mais les mesures détaillées n’ont pas pu être stockées. Ne fermez pas l’application avant la synchronisation.');
        console.warn("Stockage IndexedDB des séries impossible:", e);
        enqueueSync(sessionId);
        return;
    }

    // La sauvegarde de secours n'est supprimée qu'après les deux persistances.
    localDataStore.remove('active_session_backup');

    // 4. Synchronisation Supabase en arrière-plan
    if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
        try {
            await window.profilesManager.syncFromSupabase();
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
    return localDataStore.getJSON('sessions', []);
}

function saveStoredSessions(sessions) {
    return localDataStore.setJSON('sessions', sessions);
}

// Queue de synchronisation hors-ligne
function enqueueSync(sessionId) {
    try {
        let queue = localDataStore.getJSON('sync_queue', []);
        if (!queue.includes(sessionId)) queue.push(sessionId);
        if (!localDataStore.setJSON('sync_queue', queue)) throw new Error('File de synchronisation non persistée');
        return true;
    } catch(e) {
        console.error(e);
        alert('Impossible de mémoriser la synchronisation en attente. Ne supprimez pas les données locales.');
        return false;
    }
}

async function processSyncQueue() {
    if (!window.supabaseClient || !window.supabaseClient.isAuthenticated()) return;
    if (syncQueuePromise) return syncQueuePromise;
    syncQueuePromise = (async () => {
        await window.profilesManager.syncFromSupabase();
        let queue = localDataStore.getJSON('sync_queue', []);
        if (queue.length === 0) return;
        const retryState = localDataStore.getJSON('sync_retry', {});

        const sessions = getStoredSessions();
        const newQueue = [];

        for (const id of queue) {
            if (retryState[id] && retryState[id].next_at > Date.now()) {
                newQueue.push(id);
                continue;
            }
            const sess = sessions.find(s => s.id === id);
            if (!sess) continue;

            let detailed = null;
            try { detailed = await cycloDb.get('session-data', id); } catch (error) { console.warn(error); }

            try {
                await window.supabaseClient.saveSession(sess, detailed);
                sess.synced = true;
                sess.sync_status = 'synced';
                delete retryState[id];
                console.log(`Séance ${id} synchronisée depuis la file d'attente.`);
            } catch (err) {
                console.warn(`Échec synchronisation séance ${id}:`, err);
                newQueue.push(id);
                const attempts = ((retryState[id] && retryState[id].attempts) || 0) + 1;
                retryState[id] = {
                    attempts,
                    next_at: Date.now() + Math.min(300000, Math.pow(2, attempts - 1) * 5000)
                };
            }
        }

        if (!saveStoredSessions(sessions) || !localDataStore.setJSON('sync_queue', newQueue) || !localDataStore.setJSON('sync_retry', retryState)) {
            throw new Error('État de synchronisation non persisté');
        }
        renderHistory();
    })();
    try { return await syncQueuePromise; }
    catch (err) { console.warn("Erreur processSyncQueue:", err); }
    finally { syncQueuePromise = null; }
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
                    s.sync_status = 'synced';
                    map.set(s.id, s);
                });
                allSessions.forEach(s => {
                    if (!map.has(s.id) || !s.synced || s.sync_status === 'pending') map.set(s.id, s);
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
        list.textContent = '';
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:2.5rem 1rem;text-align:center;color:var(--text-secondary)';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;font-size:1.05rem;color:var(--text-primary)';
        title.textContent = `🚴 Aucune activité pour ${activeProfile ? activeProfile.display_name : 'ce profil'}`;
        const help = document.createElement('p');
        help.textContent = 'Démarrez une séance sur le Compteur pour enregistrer vos premiers tours de roue !';
        empty.append(title, help);
        list.appendChild(empty);
        return;
    }

    list.innerHTML = '';
    profileSessions.forEach(s => {
        const dateObj = new Date(s.started_at || s.date);
        const dateStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + 
                        ' à ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const item = document.createElement('div');
        item.className = 'list-item history-item-card';
        item.style.marginBottom = '0.75rem';

        const content = document.createElement('div');
        content.style.cssText = 'flex:1;min-width:0';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:700;color:var(--text-primary);font-size:0.95rem';
        title.textContent = s.workout_name || 'Roule Libre';
        const sync = document.createElement('span');
        sync.style.cssText = `font-size:0.75rem;color:${s.synced ? 'var(--success)' : 'var(--warning)'}`;
        sync.textContent = s.synced ? ' ☁️ Sync' : ' ⏳ Local';
        title.appendChild(sync);
        const date = document.createElement('div');
        date.style.cssText = 'font-size:0.78rem;color:var(--text-secondary);margin:0.25rem 0 0.4rem';
        date.textContent = `📅 ${dateStr}`;
        const metrics = document.createElement('div');
        metrics.className = 'history-metrics-row';
        metrics.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.75rem;font-size:0.85rem';
        const values = [
            `⏱ ${formatTime(s.duration_seconds || s.duration || 0)}`,
            `📏 ${((s.distance_meters || s.distance || 0) / 1000).toFixed(2)} km`,
            `⚡ ${s.avg_power_watts || s.avgWatts || 0} W moy`,
            `🚴 ${s.avg_speed_kmh || s.avgSpeed || '0.0'} km/h`
        ];
        if (s.total_work_kj) values.push(`🔥 ${s.total_work_kj} kJ`);
        values.forEach(value => { const span = document.createElement('span'); span.textContent = value; metrics.appendChild(span); });
        const button = document.createElement('button');
        button.className = 'btn btn-sm btn-primary';
        button.textContent = '📥 TCX';
        button.onclick = () => exportTCXById(s.id);
        content.append(title, date, metrics);
        item.append(content, button);
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
        detailed = await cycloDb.get('session-data', sessionId);
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
        const w = detailedData.watts[i];
        const s = detailedData.speed[i];
        const elapsed = Number(detailedData.time[i]) || 0;
        const previousElapsed = i > 0 ? (Number(detailedData.time[i - 1]) || 0) : 0;
        const deltaSeconds = Math.max(0, elapsed - previousElapsed);
        if (detailedData.distance && Number.isFinite(detailedData.distance[i])) currentDist = detailedData.distance[i];
        else if (Number.isFinite(s)) currentDist += (s / 3.6) * deltaSeconds;
        const recordedTimestamp = detailedData.timestamps && detailedData.timestamps[i];
        const ptDate = recordedTimestamp ? new Date(recordedTimestamp) : new Date(startDate.getTime() + elapsed * 1000);
        const powerXml = Number.isFinite(w) ? `\n          <Watts>${Math.round(w)}</Watts>` : '';
        const speedXml = Number.isFinite(s) ? `\n          <Speed>${(s / 3.6).toFixed(2)}</Speed>` : '';
        const extensionsXml = (powerXml || speedXml) ? `
      <Extensions>
        <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">${powerXml}${speedXml}
        </TPX>
      </Extensions>` : '';

        trackpoints += `
    <Trackpoint>
      <Time>${ptDate.toISOString()}</Time>
      <DistanceMeters>${currentDist.toFixed(2)}</DistanceMeters>${extensionsXml}
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

    const migrated = localDataStore.getJSON('legacy_migrated', false) === true;
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
                    id: createLegacySessionId(activeProfile.id, dateIso),
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
                    synced: false,
                    sync_status: 'pending'
                };
                sessions.push(migratedItem);
                existingDates.add(dateIso);
                enqueueSync(migratedItem.id);
                importedCount++;
            }
        });

        sessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
        if (!saveStoredSessions(sessions)) throw new Error('Stockage local saturé, migration annulée');
        if (!localDataStore.setJSON('legacy_migrated', true)) throw new Error('État de migration non persisté');
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
