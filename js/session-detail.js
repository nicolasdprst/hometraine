// --- CYCLODASH BATCH 4 : FICHE DÉTAILLÉE D'UNE SÉANCE ---
// Gère le chargement, le rendu et les graphiques d'analyse de séance.

const SessionDetail = (() => {
    'use strict';

    let currentSessionId = null;
    let currentAnalysis = null;
    let powerChartInstance = null;
    let speedChartInstance = null;
    let activeChartMode = 'power'; // 'power' | 'speed'

    // ── Navigation ────────────────────────────────────────────────────

    /**
     * Ouvre la fiche d'analyse pour une séance donnée.
     * Charge les données détaillées (IndexedDB > Supabase), calcule les
     * statistiques et affiche la fiche complète.
     */
    async function open(sessionSummary) {
        if (!sessionSummary || !sessionSummary.id) return;

        const activeProfile = window.profilesManager && window.profilesManager.activeProfile;
        if (!activeProfile || sessionSummary.profile_id !== activeProfile.id) {
            if (window.showAppToast) window.showAppToast('Cette séance n\'appartient pas au profil actif.', 'error');
            return;
        }

        // Vérifier que la séance n'est pas dans la file de suppression
        const deletedIds = new Set((window.getDeletionQueue ? window.getDeletionQueue() : []).map(i => i.id));
        if (deletedIds.has(sessionSummary.id)) {
            if (window.showAppToast) window.showAppToast('Cette séance a été supprimée.', 'warning');
            return;
        }

        // Vérifier que la séance existe encore localement
        const storedSessions = window.getStoredSessions ? window.getStoredSessions() : [];
        if (storedSessions.length > 0 && !storedSessions.some(s => s.id === sessionSummary.id)) {
            if (window.showAppToast) window.showAppToast('Cette séance n\'existe plus.', 'warning');
            return;
        }

        currentSessionId = sessionSummary.id;
        showView();
        showLoading(true);

        try {
            // 1. Charger les données détaillées (IndexedDB > Supabase)
            const detailedData = await loadDetailedData(sessionSummary.id);

            // 2. Déterminer la FTP utilisée
            const ftpInfo = resolveFtp(sessionSummary, activeProfile);

            // 3. Analyser via le moteur de calcul pur
            if (detailedData) {
                currentAnalysis = window.CycloAnalytics.analyzeSession(
                    detailedData,
                    ftpInfo.ftp,
                    ftpInfo.isHistorical
                );
            } else {
                currentAnalysis = {
                    hasDetailedData: false,
                    basicStats: { available: false },
                    variability: { available: false },
                    zones: { available: false, zones: [] },
                    bestEfforts: window.CycloAnalytics.BEST_EFFORT_DURATIONS.map(d => ({
                        duration: d,
                        label: window.CycloAnalytics.formatEffortDuration(d),
                        power: null,
                        available: false
                    })),
                    ftp: ftpInfo.ftp,
                    ftpIsHistorical: ftpInfo.isHistorical,
                    chartData: null
                };
            }

            // 4. Rendre la fiche
            renderDetailView(sessionSummary, currentAnalysis, activeProfile);

        } catch (err) {
            console.error('Erreur analyse séance:', err);
            renderError(err.message || 'Erreur inattendue');
        } finally {
            showLoading(false);
        }
    }

    function close() {
        destroyCharts();
        currentSessionId = null;
        currentAnalysis = null;
        hideView();
    }

    function onSessionDeleted(sessionId) {
        if (currentSessionId === sessionId) {
            close();
            if (window.showAppToast) window.showAppToast('La séance affichée a été supprimée.', 'info');
        }
    }

    function showView() {
        const view = document.getElementById('sessionAnalyticsView');
        if (view) {
            view.style.display = 'block';
            view.scrollTop = 0;
        }
        // Masquer l'historique
        const history = document.getElementById('history');
        if (history) history.style.display = 'none';
        // Masquer la barre de navigation
        const nav = document.querySelector('nav');
        if (nav) nav.style.display = 'none';
        // Masquer la barre de profil global
        const bar = document.getElementById('globalProfileBar');
        if (bar) bar.style.display = 'none';
    }

    function hideView() {
        const view = document.getElementById('sessionAnalyticsView');
        if (view) view.style.display = 'none';
        // Restaurer l'historique
        const history = document.getElementById('history');
        if (history) history.style.display = '';
        // Restaurer la barre de navigation
        const nav = document.querySelector('nav');
        if (nav) nav.style.display = '';
        // Restaurer la barre de profil
        const bar = document.getElementById('globalProfileBar');
        if (bar) bar.style.display = '';
    }

    function showLoading(show) {
        const loader = document.getElementById('analyticsLoader');
        const content = document.getElementById('analyticsContent');
        if (loader) loader.style.display = show ? 'flex' : 'none';
        if (content) content.style.display = show ? 'none' : 'block';
    }

    // ── Chargement des données ────────────────────────────────────────

    async function loadDetailedData(sessionId) {
        // 1. Chercher localement dans IndexedDB
        let data = null;
        if (window.cycloDb && typeof window.cycloDb.get === 'function') {
            try {
                data = await window.cycloDb.get('session-data', sessionId);
            } catch (e) {
                console.warn('IndexedDB lecture impossible:', e);
            }
        }

        if (data && data.time && data.time.length > 0) {
            return data;
        }

        // 2. Si absent et connecté, chercher sur Supabase
        if (window.supabaseClient && window.supabaseClient.isAuthenticated()) {
            try {
                data = await window.supabaseClient.fetchSessionData(sessionId);
                if (data && data.time && data.time.length > 0) {
                    // Mettre en cache localement dans IndexedDB pour la prochaine fois
                    if (window.cycloDb && typeof window.cycloDb.put === 'function') {
                        try {
                            await window.cycloDb.put('session-data', sessionId, data);
                        } catch (e) {
                            console.warn('Cache local IndexedDB impossible:', e);
                        }
                    }
                    return data;
                }
            } catch (e) {
                console.warn('Récupération Supabase impossible:', e);
            }
        }

        return null;
    }

    function resolveFtp(session, profile) {
        // Priorité : FTP historique stockée au départ de la séance > FTP actuelle du profil
        if (session.ftp_at_session_watts && Number(session.ftp_at_session_watts) > 0) {
            return { ftp: Math.round(Number(session.ftp_at_session_watts)), isHistorical: true };
        }
        const currentFtp = (profile && profile.ftp_watts) || 200;
        return { ftp: Math.round(currentFtp), isHistorical: false };
    }

    // ── Rendu de la fiche ─────────────────────────────────────────────

    function renderDetailView(session, analysis, profile) {
        const container = document.getElementById('analyticsContent');
        if (!container) return;
        container.innerHTML = '';

        // En-tête
        container.appendChild(renderHeader(session, profile));

        // Résumé statistiques (6 blocs)
        container.appendChild(renderSummaryStats(session, analysis));

        // Graphiques (si données détaillées)
        if (analysis.hasDetailedData && analysis.chartData) {
            container.appendChild(renderChartSection(analysis));
        } else {
            container.appendChild(renderNoDetailedData());
        }

        // Zones FTP
        container.appendChild(renderZones(analysis));

        // Meilleurs efforts
        container.appendChild(renderBestEfforts(analysis));

        // Régularité
        container.appendChild(renderVariability(analysis));

        // Statistiques complémentaires complètes
        container.appendChild(renderDetailedStats(session, analysis));

        // Boutons d'actions
        container.appendChild(renderActions(session));
    }

    function renderError(message) {
        const container = document.getElementById('analyticsContent');
        if (!container) return;
        container.innerHTML = `
            <div class="sa-error-card">
                <div class="sa-error-icon">⚠️</div>
                <div class="sa-error-title">Erreur de chargement</div>
                <p class="sa-error-msg">${escapeHtml(message)}</p>
                <button class="btn btn-primary sa-btn-back" onclick="SessionDetail.close()">Retour à l'historique</button>
            </div>
        `;
    }

    // ── Composants de rendu ───────────────────────────────────────────

    function renderHeader(session, profile) {
        const dateObj = new Date(session.started_at || session.date || Date.now());
        const dateStr = dateObj.toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
        const timeStr = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        const el = createElement('div', 'sa-header');
        el.innerHTML = `
            <button class="sa-back-btn" onclick="SessionDetail.close()" aria-label="Retour à l'historique">
                ← Historique
            </button>
            <div class="sa-header-title">ANALYSE DE SÉANCE</div>
            <div class="sa-header-date">${capitalizeFirst(dateStr)} — ${timeStr}</div>
            <div class="sa-header-meta">
                <span class="sa-header-profile" style="border-color: ${profile.avatar_color || '#3b82f6'}">
                    🚴 ${escapeHtml(profile.display_name)}
                </span>
                <span class="sa-header-workout">${escapeHtml(session.workout_name || 'Roule Libre')}</span>
            </div>
        `;
        return el;
    }

    function renderSummaryStats(session, analysis) {
        const stats = analysis.hasDetailedData && analysis.basicStats.available
            ? analysis.basicStats
            : null;

        const duration = session.duration_seconds || session.duration || 0;
        const distance = ((session.distance_meters || session.distance || 0) / 1000).toFixed(2);
        const avgPower = stats ? stats.avgPower : (session.avg_power_watts || session.avgWatts || 0);
        const maxPower = stats ? stats.maxPower : (session.max_power_watts || session.maxWatts || 0);
        const avgSpeed = stats ? stats.avgSpeed : (session.avg_speed_kmh || session.avgSpeed || 0);
        const workKJ = stats ? stats.totalWorkKJ : (session.total_work_kj || 0);

        const el = createElement('div', 'sa-section');
        el.innerHTML = `
            <div class="sa-section-title">📊 Résumé</div>
            <div class="sa-stats-grid">
                <div class="sa-stat-card">
                    <div class="sa-stat-value">${formatTime(duration)}</div>
                    <div class="sa-stat-label">Durée</div>
                </div>
                <div class="sa-stat-card">
                    <div class="sa-stat-value">${distance}</div>
                    <div class="sa-stat-label">km</div>
                </div>
                <div class="sa-stat-card sa-stat-accent">
                    <div class="sa-stat-value">${avgPower || '—'}</div>
                    <div class="sa-stat-label">W moy</div>
                </div>
                <div class="sa-stat-card">
                    <div class="sa-stat-value">${maxPower || '—'}</div>
                    <div class="sa-stat-label">W max</div>
                </div>
                <div class="sa-stat-card">
                    <div class="sa-stat-value">${avgSpeed || '—'}</div>
                    <div class="sa-stat-label">km/h moy</div>
                </div>
                <div class="sa-stat-card">
                    <div class="sa-stat-value">${workKJ}</div>
                    <div class="sa-stat-label">kJ</div>
                </div>
            </div>
        `;
        return el;
    }

    function renderChartSection(analysis) {
        const el = createElement('div', 'sa-section');
        el.innerHTML = `
            <div class="sa-section-title">📈 Graphiques</div>
            <div class="sa-chart-toggle">
                <button id="saChartPowerBtn" class="sa-toggle-btn active" onclick="SessionDetail.switchChart('power')">
                    ⚡ Puissance
                </button>
                <button id="saChartSpeedBtn" class="sa-toggle-btn" onclick="SessionDetail.switchChart('speed')">
                    🚴 Vitesse
                </button>
            </div>
            <div class="sa-chart-wrapper">
                <canvas id="saPowerChart"></canvas>
            </div>
            <div class="sa-chart-wrapper" style="display:none;">
                <canvas id="saSpeedChart"></canvas>
            </div>
        `;

        // Initialisation des graphiques après insertion dans le DOM
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => initCharts(analysis));
        } else {
            setTimeout(() => initCharts(analysis), 0);
        }

        return el;
    }

    function renderNoDetailedData() {
        const el = createElement('div', 'sa-section');
        el.innerHTML = `
            <div class="sa-section-title">📈 Graphiques</div>
            <div class="sa-no-data-card">
                <div class="sa-no-data-icon">📊</div>
                <p>Les mesures détaillées seconde par seconde ne sont pas disponibles pour cette séance.</p>
                <p class="sa-no-data-hint">Les séances anciennes ou importées peuvent ne pas contenir de séries temporelles complètes.</p>
            </div>
        `;
        return el;
    }

    function renderZones(analysis) {
        const el = createElement('div', 'sa-section');
        const zones = analysis.zones;

        if (!zones.available) {
            el.innerHTML = `
                <div class="sa-section-title">🎯 Répartition par zones FTP</div>
                <div class="sa-no-data-card">
                    <p>Données de puissance insuffisantes pour calculer la répartition par zones.</p>
                </div>
            `;
            return el;
        }

        const ftpNote = analysis.ftpIsHistorical
            ? `FTP de la séance : ${analysis.ftp} W`
            : `Zones estimées avec la FTP actuelle (${analysis.ftp} W)`;
        const ftpClass = analysis.ftpIsHistorical ? '' : ' sa-ftp-estimated';

        let zoneRows = '';
        for (const z of zones.zones) {
            const minutes = Math.floor(z.duration / 60);
            const seconds = z.duration % 60;
            const durationStr = minutes > 0 ? `${minutes}m${seconds > 0 ? seconds.toString().padStart(2, '0') + 's' : ''}` : `${seconds}s`;
            const barWidth = Math.max(2, z.percentage);

            zoneRows += `
                <div class="sa-zone-row">
                    <div class="sa-zone-label">
                        <span class="sa-zone-dot" style="background:${z.color}"></span>
                        <span class="sa-zone-name">${z.id} — ${z.name}</span>
                    </div>
                    <div class="sa-zone-bar-container">
                        <div class="sa-zone-bar" style="width:${barWidth}%;background:${z.color}"></div>
                    </div>
                    <div class="sa-zone-stats">
                        <span class="sa-zone-time">${durationStr}</span>
                        <span class="sa-zone-pct">${z.percentage}%</span>
                    </div>
                </div>
            `;
        }

        el.innerHTML = `
            <div class="sa-section-title">🎯 Répartition par zones FTP</div>
            <div class="sa-ftp-note${ftpClass}">${ftpNote}</div>
            <div class="sa-zones-container">
                ${zoneRows}
            </div>
            <div class="sa-zone-total">Temps mesuré : ${formatTime(zones.totalValidTime)}</div>
        `;
        return el;
    }

    function renderBestEfforts(analysis) {
        const el = createElement('div', 'sa-section');
        let rows = '';
        for (const effort of analysis.bestEfforts) {
            const powerStr = effort.available ? `${effort.power} W` : '—';
            const cls = effort.available ? '' : ' sa-effort-na';
            rows += `
                <div class="sa-effort-card${cls}">
                    <div class="sa-effort-duration">${effort.label}</div>
                    <div class="sa-effort-power">${powerStr}</div>
                </div>
            `;
        }

        el.innerHTML = `
            <div class="sa-section-title">🏆 Meilleurs efforts</div>
            <div class="sa-efforts-grid">
                ${rows}
            </div>
            ${!analysis.hasDetailedData ? '<p class="sa-no-data-hint">Données détaillées requises pour le calcul des meilleurs efforts.</p>' : ''}
        `;
        return el;
    }

    function renderVariability(analysis) {
        const el = createElement('div', 'sa-section');
        const v = analysis.variability;

        if (!v.available) {
            el.innerHTML = `
                <div class="sa-section-title">📐 Régularité de l'effort</div>
                <div class="sa-no-data-card">
                    <p>Données insuffisantes pour analyser la régularité de la puissance.</p>
                </div>
            `;
            return el;
        }

        el.innerHTML = `
            <div class="sa-section-title">📐 Régularité de l'effort</div>
            <div class="sa-variability-card">
                <div class="sa-var-stats">
                    <div class="sa-var-item">
                        <span class="sa-var-label">Puissance moyenne</span>
                        <span class="sa-var-value">${v.mean} W</span>
                    </div>
                    <div class="sa-var-item">
                        <span class="sa-var-label">Écart-type</span>
                        <span class="sa-var-value">±${v.stdDev} W</span>
                    </div>
                    <div class="sa-var-item">
                        <span class="sa-var-label">Coefficient de variation</span>
                        <span class="sa-var-value">${v.cv}%</span>
                    </div>
                    <div class="sa-var-item">
                        <span class="sa-var-label">Couverture des mesures</span>
                        <span class="sa-var-value">${formatTime(v.measureTime)}</span>
                    </div>
                </div>
                <div class="sa-var-interpretation">${v.interpretation}</div>
            </div>
        `;
        return el;
    }

    function renderDetailedStats(session, analysis) {
        const stats = analysis.hasDetailedData && analysis.basicStats.available
            ? analysis.basicStats
            : null;

        const duration = session.duration_seconds || session.duration || 0;
        const activeTime = stats ? stats.activeTime : (session.active_duration_seconds || 0);
        const validDataTime = stats ? stats.validDataTime : (session.reliable_data_seconds || 0);
        const distance = ((session.distance_meters || session.distance || 0) / 1000).toFixed(2);
        const avgPower = stats ? stats.avgPower : (session.avg_power_watts || 0);
        const maxPower = stats ? stats.maxPower : (session.max_power_watts || 0);
        const avgSpeed = stats ? stats.avgSpeed : (session.avg_speed_kmh || 0);
        const maxSpeed = stats ? stats.maxSpeed : (session.max_speed_kmh || 0);
        const workKJ = stats ? stats.totalWorkKJ : (session.total_work_kj || 0);
        const kcal = stats ? stats.energyKcal : (session.energy_kcal || workKJ);
        const coverage = stats ? `${Math.round(stats.dataCoverage * 100)}%` : '—';

        const ftpInfo = analysis.ftpIsHistorical
            ? `${analysis.ftp} W (FTP de la séance)`
            : `${analysis.ftp} W (FTP actuelle)`;

        const rows = [
            ['Durée totale', formatTime(duration)],
            ['Temps de pédalage actif', activeTime > 0 ? formatTime(activeTime) : '—'],
            ['Temps couvert par des mesures', validDataTime > 0 ? formatTime(validDataTime) : '—'],
            ['Couverture des données', coverage],
            ['Distance', `${distance} km`],
            ['Puissance moyenne', avgPower ? `${avgPower} W` : '—'],
            ['Puissance maximale', maxPower ? `${maxPower} W` : '—'],
            ['Vitesse moyenne', avgSpeed ? `${avgSpeed} km/h` : '—'],
            ['Vitesse maximale', maxSpeed ? `${maxSpeed} km/h` : '—'],
            ['Travail mécanique', `${workKJ} kJ`],
            ['Énergie (estimation)', `${kcal} kcal`],
            ['FTP utilisée', ftpInfo]
        ];

        const el = createElement('div', 'sa-section');
        let tableRows = '';
        for (const [label, value] of rows) {
            tableRows += `
                <div class="sa-detail-row">
                    <span class="sa-detail-label">${label}</span>
                    <span class="sa-detail-value">${value}</span>
                </div>
            `;
        }

        el.innerHTML = `
            <div class="sa-section-title">📋 Statistiques complètes</div>
            <div class="sa-details-table">
                ${tableRows}
            </div>
        `;
        return el;
    }

    function renderActions(session) {
        const el = createElement('div', 'sa-actions');
        el.innerHTML = `
            <button class="btn btn-primary sa-action-btn" onclick="exportTCXById('${session.id}')">
                📥 Télécharger TCX
            </button>
            <button class="btn btn-secondary sa-action-btn" onclick="SessionDetail.close()">
                ← Retour à l'historique
            </button>
        `;
        return el;
    }

    // ── Graphiques Chart.js ───────────────────────────────────────────

    function initCharts(analysis) {
        destroyCharts();
        if (!analysis.chartData) return;

        initPowerChart(analysis);
        initSpeedChart(analysis);
    }

    function initPowerChart(analysis) {
        const canvas = document.getElementById('saPowerChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const data = analysis.chartData.power;
        if (!data || data.length === 0) return;

        const labels = data.map(p => formatChartTime(p.t));
        const values = data.map(p => p.watts);

        const avgPower = analysis.basicStats.available ? analysis.basicStats.avgPower : null;
        const ftp = analysis.ftp;

        const datasets = [{
            label: 'Puissance (W)',
            data: values,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            borderWidth: 1.5,
            fill: true,
            tension: 0.1,
            pointRadius: 0,
            pointHitRadius: 8,
            spanGaps: false
        }];

        // Ligne de puissance moyenne
        if (avgPower !== null) {
            datasets.push({
                label: `Moyenne (${avgPower} W)`,
                data: new Array(values.length).fill(avgPower),
                borderColor: 'rgba(59, 130, 246, 0.5)',
                borderWidth: 1,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false
            });
        }

        // Ligne FTP de référence
        if (ftp && ftp > 0) {
            datasets.push({
                label: `FTP (${ftp} W)`,
                data: new Array(values.length).fill(ftp),
                borderColor: 'rgba(234, 179, 8, 0.5)',
                borderWidth: 1,
                borderDash: [4, 4],
                pointRadius: 0,
                fill: false
            });
        }

        const ctx = canvas.getContext('2d');
        if (typeof Chart.defaults !== 'undefined') Chart.defaults.color = '#94a3b8';
        powerChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: getChartOptions('Watts', analysis.basicStats.maxPower || 400)
        });
    }

    function initSpeedChart(analysis) {
        const canvas = document.getElementById('saSpeedChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const data = analysis.chartData.speed;
        if (!data || data.length === 0) return;

        const labels = data.map(p => formatChartTime(p.t));
        const values = data.map(p => p.speed);

        const avgSpeed = analysis.basicStats.available ? analysis.basicStats.avgSpeed : null;

        const datasets = [{
            label: 'Vitesse (km/h)',
            data: values,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderWidth: 1.5,
            fill: true,
            tension: 0.1,
            pointRadius: 0,
            pointHitRadius: 8,
            spanGaps: false
        }];

        if (avgSpeed !== null) {
            datasets.push({
                label: `Moyenne (${avgSpeed} km/h)`,
                data: new Array(values.length).fill(avgSpeed),
                borderColor: 'rgba(16, 185, 129, 0.5)',
                borderWidth: 1,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false
            });
        }

        const ctx = canvas.getContext('2d');
        speedChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: getChartOptions('km/h', analysis.basicStats.maxSpeed || 50)
        });
    }

    function getChartOptions(yLabel, suggestedMax) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 8,
                        font: { size: 11 },
                        color: '#94a3b8'
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(13, 19, 31, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: '#475569',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        title: function(items) {
                            return items[0] ? `⏱ ${items[0].label}` : '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: { color: 'rgba(71, 85, 105, 0.15)' },
                    ticks: {
                        maxTicksLimit: 8,
                        font: { size: 10 },
                        color: '#64748b'
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    suggestedMax: suggestedMax * 1.1,
                    title: {
                        display: true,
                        text: yLabel,
                        font: { size: 11 },
                        color: '#94a3b8'
                    },
                    grid: { color: 'rgba(71, 85, 105, 0.15)' },
                    ticks: {
                        font: { size: 10 },
                        color: '#64748b'
                    }
                }
            },
            elements: {
                line: { borderJoinStyle: 'round' }
            }
        };
    }

    function switchChart(mode) {
        activeChartMode = mode;
        const wrappers = document.querySelectorAll('.sa-chart-wrapper');
        const powerWrapper = wrappers[0];
        const speedWrapper = wrappers[1];
        const powerBtn = document.getElementById('saChartPowerBtn');
        const speedBtn = document.getElementById('saChartSpeedBtn');

        if (mode === 'power') {
            if (powerWrapper) powerWrapper.style.display = 'block';
            if (speedWrapper) speedWrapper.style.display = 'none';
            if (powerBtn) powerBtn.classList.add('active');
            if (speedBtn) speedBtn.classList.remove('active');
        } else {
            if (powerWrapper) powerWrapper.style.display = 'none';
            if (speedWrapper) speedWrapper.style.display = 'block';
            if (powerBtn) powerBtn.classList.remove('active');
            if (speedBtn) speedBtn.classList.add('active');
        }
    }

    function destroyCharts() {
        if (powerChartInstance) {
            powerChartInstance.destroy();
            powerChartInstance = null;
        }
        if (speedChartInstance) {
            speedChartInstance.destroy();
            speedChartInstance = null;
        }
    }

    // ── Utilitaires DOM ───────────────────────────────────────────────

    function createElement(tag, className) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        return el;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function formatChartTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // ── API publique ──────────────────────────────────────────────────

    return {
        open,
        close,
        switchChart,
        isOpen: () => currentSessionId !== null,
        getCurrentSessionId: () => currentSessionId,
        onSessionDeleted,
        resolveFtp
    };
})();

// Export double environnement (Node.js et Navigateur)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionDetail;
}
if (typeof window !== 'undefined') {
    window.SessionDetail = SessionDetail;
}
