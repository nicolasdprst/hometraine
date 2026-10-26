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
    const sessionProfile = window.profilesManager
        ? window.profilesManager.profiles.find(profile => profile.id === profileId)
        : null;
    const profileEmail = sessionProfile && sessionProfile.email_address ? String(sessionProfile.email_address).trim().toLowerCase() : null;
    const automaticEmailRequested = !!(sessionProfile && sessionProfile.email_auto_send && profileEmail);
    const sessionId = state.currentSessionId || createCycloDashId();

    const avgWatts = state.powerMeasureTime > 0 ? Math.round(state.sumWatts / state.powerMeasureTime) : 0;
    const maxWatts = Math.round(state.maxWatts);
    const avgSpeed = state.speedMeasureTime > 0 ? parseFloat((state.sumSpeed / state.speedMeasureTime).toFixed(1)) : 0;
    const maxSpeed = parseFloat(state.maxSpeed.toFixed(1));
    const totalDistM = state.totalDistanceM;
    const totalWorkKJ = Math.round(state.totalWorkJ / 1000);
    const energyKcal = totalWorkKJ;

    const sessionSummary = {
        id: sessionId,
        profile_id: profileId,
        started_at: state.startTime ? state.startTime.toISOString() : new Date().toISOString(),
        ended_at: state.stopTime ? state.stopTime.toISOString() : new Date().toISOString(),
        duration_seconds: Math.round(state.elapsedTime),
        active_duration_seconds: Math.round(state.pedalingTime),
        reliable_data_seconds: Math.round(state.reliableDataTime),
        distance_meters: totalDistM,
        avg_power_watts: avgWatts,
        max_power_watts: maxWatts,
        avg_speed_kmh: avgSpeed,
        max_speed_kmh: maxSpeed,
        total_work_kj: totalWorkKJ,
        energy_kcal: energyKcal,
        workout_id: (state.activeWorkout && state.activeWorkout.id) ? state.activeWorkout.id : null,
        workout_name: (state.activeWorkout && state.activeWorkout.name) ? state.activeWorkout.name : 'Roule Libre',
        ftp_at_session_watts: state.ftp || null,
        email_auto_requested: automaticEmailRequested,
        email_recipient_snapshot: automaticEmailRequested ? profileEmail : null,
        email_status: automaticEmailRequested ? 'pending' : null,
        synced: false,
        sync_status: 'pending'
    };

    const detailedData = {
        time: [...state.sessionData.time],
        timestamps: [...(state.sessionData.timestamps || [])],
        watts: [...state.sessionData.watts],
        speed: [...state.sessionData.speed],
        distance: [...(state.sessionData.distance || [])]
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

    // Cette opération ne fait qu'inscrire une demande locale et ne bloque jamais
    // la sauvegarde de la séance. Le serveur possède sa propre file persistante.
    if (window.CycloEmail) window.CycloEmail.enqueueAutomatic(sessionSummary);

    // 4. Synchronisation Supabase en arrière-plan
    if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
        try {
            await window.profilesManager.syncFromSupabase();
            await window.supabaseClient.saveSession(sessionSummary, detailedData);
            sessionSummary.synced = true;
            sessionSummary.sync_status = 'synced';
            saveStoredSessions(sessions);
            console.log("Séance synchronisée avec Supabase avec succès");
            if (window.CycloEmail) window.CycloEmail.processQueue();
        } catch (err) {
            console.warn("Échec synchronisation Supabase immédiate, mise en file d'attente:", err);
            enqueueSync(sessionId);
        }
    } else {
        enqueueSync(sessionId);
    }

    renderHistory();
    if (window.CycloTrainingUI) window.CycloTrainingUI.showPostSession(sessionSummary);
}

// Récupérer les séances depuis le stockage local
function getStoredSessions() {
    return localDataStore.getJSON('sessions', []);
}

function saveStoredSessions(sessions) {
    return localDataStore.setJSON('sessions', sessions);
}

function getDeletionQueue() {
    return localDataStore.getJSON('deletion_queue', []);
}

function saveDeletionQueue(queue) {
    return localDataStore.setJSON('deletion_queue', queue);
}

function enqueueDeletion(session) {
    const queue = getDeletionQueue();
    if (!queue.some(item => item.id === session.id)) {
        queue.push({
            id: session.id,
            profile_id: session.profile_id,
            owner_id: localDataStore.getOwnerId(),
            requested_at: new Date().toISOString()
        });
    }
    if (!saveDeletionQueue(queue)) throw new Error('Suppression en attente non persistée');
}

async function processDeletionQueue() {
    if (!window.supabaseClient || !window.supabaseClient.isAuthenticated()) return;
    const queue = getDeletionQueue();
    if (queue.length === 0) return;
    const ownerId = window.supabaseClient.getUser().id;
    const remaining = [];

    for (const operation of queue) {
        if (operation.owner_id !== ownerId) {
            remaining.push(operation);
            continue;
        }
        try {
            await window.supabaseClient.deleteSession(operation.id);
            const sessions = getStoredSessions().filter(session => session.id !== operation.id);
            const uploadQueue = localDataStore.getJSON('sync_queue', []).filter(id => id !== operation.id);
            const retryState = localDataStore.getJSON('sync_retry', {});
            delete retryState[operation.id];
            if (!saveStoredSessions(sessions)
                || !localDataStore.setJSON('sync_queue', uploadQueue)
                || !localDataStore.setJSON('sync_retry', retryState)) {
                throw new Error('Nettoyage local de la suppression non persisté');
            }
            await cycloDb.remove('session-data', operation.id).catch(() => null);
        } catch (error) {
            operation.last_error = error.message;
            operation.last_attempt_at = new Date().toISOString();
            remaining.push(operation);
        }
    }
    if (!saveDeletionQueue(remaining)) throw new Error('État des suppressions non persisté');
}

function confirmSessionDeletion(session) {
    return new Promise(resolve => {
        const modal = document.getElementById('deleteSessionModal');
        const description = document.getElementById('deleteSessionDescription');
        const cancel = document.getElementById('cancelDeleteSessionBtn');
        const confirmButton = document.getElementById('confirmDeleteSessionBtn');
        if (!modal || !cancel || !confirmButton) {
            resolve(confirm('Supprimer définitivement cette séance ?'));
            return;
        }
        const date = new Date(session.started_at || session.date);
        description.textContent = `Séance du ${date.toLocaleDateString('fr-FR')} — ${formatTime(session.duration_seconds || session.duration || 0)}. L'activité et ses mesures seront supprimées.`;
        modal.style.display = 'grid';
        const finish = result => {
            modal.style.display = 'none';
            cancel.onclick = null;
            confirmButton.onclick = null;
            resolve(result);
        };
        cancel.onclick = () => finish(false);
        confirmButton.onclick = () => finish(true);
        confirmButton.focus();
    });
}

async function deleteSessionById(sessionId) {
    const sessions = getStoredSessions();
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;
    const activeProfile = window.profilesManager && window.profilesManager.activeProfile;
    if (!activeProfile || session.profile_id !== activeProfile.id) throw new Error('Cette séance n’appartient pas au profil actif');
    if (!await confirmSessionDeletion(session)) return;

    const mayExistRemotely = session.synced || (window.supabaseClient && window.supabaseClient.isAuthenticated());
    if (mayExistRemotely) enqueueDeletion(session);

    // Si un upload est déjà en cours, la tombstone est enregistrée d'abord,
    // puis la suppression distante passe après lui et reste donc prioritaire.
    if (syncQueuePromise) await syncQueuePromise;

    if (!saveStoredSessions(sessions.filter(item => item.id !== sessionId))) {
        throw new Error('La suppression locale n’a pas pu être enregistrée');
    }
    const uploadQueue = localDataStore.getJSON('sync_queue', []).filter(id => id !== sessionId);
    const retryState = localDataStore.getJSON('sync_retry', {});
    delete retryState[sessionId];
    localDataStore.setJSON('sync_queue', uploadQueue);
    localDataStore.setJSON('sync_retry', retryState);
    await cycloDb.remove('session-data', sessionId).catch(error => console.warn('Mesures locales à nettoyer', error));

    let pending = mayExistRemotely;
    if (navigator.onLine !== false && window.supabaseClient && window.supabaseClient.isAuthenticated()) {
        await processDeletionQueue();
        pending = getDeletionQueue().some(item => item.id === sessionId);
    }
    if (window.SessionDetail && typeof SessionDetail.onSessionDeleted === 'function') {
        SessionDetail.onSessionDeleted(sessionId);
    }
    await renderHistory();
    if (window.showAppToast) {
        window.showAppToast(pending ? 'Séance masquée. Suppression cloud en attente de connexion.' : 'Séance supprimée.', pending ? 'warning' : 'success');
    }
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
        await processDeletionQueue();
        let queue = localDataStore.getJSON('sync_queue', []);
        if (queue.length === 0) {
            if (window.CycloEmail) await window.CycloEmail.processQueue();
            return;
        }
        const retryState = localDataStore.getJSON('sync_retry', {});

        const sessions = getStoredSessions();
        const deletedIds = new Set(getDeletionQueue().map(item => item.id));
        const newQueue = [];

        for (const id of queue) {
            if (deletedIds.has(id)) continue;
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
        if (window.CycloEmail) window.CycloEmail.processQueue();
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
    const deletedIds = new Set(getDeletionQueue().map(item => item.id));
    allSessions = allSessions.filter(session => !deletedIds.has(session.id));

    // Si connecté à Supabase, fusionner les séances distantes pour ce profil
    if (window.supabaseClient && window.supabaseClient.isAuthenticated() && profileId) {
        try {
            const remoteSessions = await window.supabaseClient.fetchSessions(profileId, 50);
            if (Array.isArray(remoteSessions) && remoteSessions.length > 0) {
                const map = new Map();
                remoteSessions.filter(s => !deletedIds.has(s.id)).forEach(s => {
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
    const profileSessions = profileId ? allSessions.filter(s => s.profile_id === profileId) : [];

    // Rendu des statistiques personnelles agrégées
    renderPersonalStats(profileSessions);

    if (profileSessions.length === 0) {
        list.textContent = '';
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:2.5rem 1rem;text-align:center;color:var(--text-secondary)';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;font-size:1.05rem;color:var(--text-primary)';
        title.textContent = `Aucune activité pour ${activeProfile ? activeProfile.display_name : 'ce profil'}`;
        const help = document.createElement('p');
        help.textContent = 'Démarrez une séance sur le Compteur pour enregistrer vos premiers tours de roue !';
        empty.append(title, help);
        list.appendChild(empty);
        return;
    }

    list.innerHTML = '';
    let currentMonthKey = '';
    let monthContainer = null;
    profileSessions.forEach(s => {
        const dateObj = new Date(s.started_at || s.date);
        const monthKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}`;
        if (monthKey !== currentMonthKey) {
            currentMonthKey = monthKey;
            const section = document.createElement('section');
            section.className = 'history-month';
            const heading = document.createElement('h2');
            heading.className = 'history-month-title';
            heading.textContent = dateObj.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
            monthContainer = document.createElement('div');
            monthContainer.className = 'history-month-items';
            section.append(heading, monthContainer);
            list.appendChild(section);
        }
        const dateStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }) +
            ' · ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const item = document.createElement('div');
        item.className = 'history-item-card';

        const content = document.createElement('div');
        content.className = 'history-item-content';
        const title = document.createElement('h3');
        title.textContent = s.workout_name || 'Roule Libre';
        const sync = document.createElement('span');
        sync.className = `history-sync-badge ${s.synced ? 'synced' : 'local'}`;
        sync.textContent = s.synced ? 'Synchronisée' : 'Locale';
        title.appendChild(sync);
        const date = document.createElement('div');
        date.className = 'history-date';
        date.textContent = dateStr;
        const metrics = document.createElement('div');
        metrics.className = 'history-metrics-row';
        const values = [
            formatTime(s.duration_seconds || s.duration || 0),
            `${((s.distance_meters || s.distance || 0) / 1000).toFixed(2)} km`,
            `${s.avg_power_watts || s.avgWatts || 0} W moy.`
        ];
        values.forEach(value => { const span = document.createElement('span'); span.textContent = value; metrics.appendChild(span); });
        const actions = document.createElement('div');
        actions.className = 'history-item-actions';
        const analyzeBtn = document.createElement('button');
        analyzeBtn.className = 'btn btn-secondary';
        analyzeBtn.textContent = 'Détails';
        analyzeBtn.onclick = (e) => { e.stopPropagation(); if (window.SessionDetail) SessionDetail.open(s); };
        actions.append(analyzeBtn);
        content.style.cursor = 'pointer';
        content.onclick = () => { if (window.SessionDetail) SessionDetail.open(s); };
        content.append(title, date, metrics);
        item.append(content, actions);
        monthContainer.appendChild(item);
    });
}

function showSessionDetails(session) {
    const modal = document.getElementById('sessionDetailsModal');
    const content = document.getElementById('sessionDetailsContent');
    const closeButton = document.getElementById('closeSessionDetailsBtn');
    if (!modal || !content || !closeButton) return;
    content.textContent = '';
    const values = [
        ['Entraînement', session.workout_name || 'Roule Libre'],
        ['Date', new Date(session.started_at || session.date).toLocaleString('fr-FR')],
        ['Durée', formatTime(session.duration_seconds || session.duration || 0)],
        ['Distance', `${((session.distance_meters || session.distance || 0) / 1000).toFixed(2)} km`],
        ['Puissance moyenne', `${session.avg_power_watts || session.avgWatts || 0} W`],
        ['Vitesse moyenne', `${session.avg_speed_kmh || session.avgSpeed || '0.0'} km/h`]
    ];
    values.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'session-detail-row';
        const key = document.createElement('span');
        const val = document.createElement('strong');
        key.textContent = label;
        val.textContent = value;
        row.append(key, val);
        content.appendChild(row);
    });
    modal.style.display = 'grid';
    closeButton.onclick = () => { modal.style.display = 'none'; };
    closeButton.focus();
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

// Génération TCX pure, réutilisable par les tests. Son équivalent serveur est
// maintenu dans supabase/functions/_shared/email-core.ts.
function buildTCX(session, detailedData) {
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
        if (detailedData.distance && Number.isFinite(detailedData.distance[i])) {
            currentDist = detailedData.distance[i];
        } else if (Number.isFinite(s)) {
            currentDist += (s / 3.6) * deltaSeconds;
        }
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

// Génération et téléchargement effectif du XML TCX
function downloadTCX(sessionId, session, detailedData) {
    const startDate = new Date(session.started_at || session.date || Date.now());
    const dateIso = startDate.toISOString();
    const tcx = buildTCX(session, detailedData);

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
window.buildTCX = buildTCX;
window.migrateLegacyHistory = migrateLegacyHistory;
window.processSyncQueue = processSyncQueue;
window.processDeletionQueue = processDeletionQueue;
window.deleteSessionById = deleteSessionById;
window.getStoredSessions = getStoredSessions;
window.saveStoredSessions = saveStoredSessions;
window.enqueueSync = enqueueSync;
