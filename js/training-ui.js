(function (root) {
    'use strict';
    const FEEDBACK_LABELS = { very_easy: 'Très facile', easy: 'Facile', appropriate: 'Adaptée à mon niveau', difficult: 'Difficile', too_difficult: 'Trop difficile' };
    let currentSession = null;

    function activeProfile() { return root.profilesManager && root.profilesManager.activeProfile; }
    function ownSessions() {
        const profile = activeProfile();
        return profile && root.getStoredSessions ? root.getStoredSessions().filter(s => s.profile_id === profile.id) : [];
    }
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    async function enrichForFtp(sessions) {
        const enriched = [];
        for (const session of sessions.filter(s => Number(s.duration_seconds) >= 1200).slice(0, 20)) {
            let data = null;
            try { data = await root.cycloDb.get('session-data', session.id); } catch (_error) { /* local fallback only */ }
            if (!data && navigator.onLine !== false && root.supabaseClient && root.supabaseClient.isAuthenticated()) {
                try { data = await root.supabaseClient.fetchSessionData(session.id); } catch (_error) { /* offline engine remains usable */ }
            }
            if (!data || !root.CycloAnalytics) continue;
            const analysis = root.CycloAnalytics.analyzeSession(data, session.ftp_at_session_watts || null, true);
            const efforts = {};
            analysis.bestEfforts.forEach(item => { if (item.available) efforts[item.duration] = item.power; });
            enriched.push({ ...session, best_efforts: efforts, power_coverage_ratio: analysis.basicStats.dataCoverage });
        }
        return enriched;
    }

    async function analyzeFtp() {
        const profile = activeProfile();
        if (!profile) return;
        const button = document.getElementById('analyzeFtpBtn');
        if (button) { button.disabled = true; button.textContent = 'Analyse…'; }
        try {
            const enriched = await enrichForFtp(ownSessions());
            const result = root.CycloFtpEstimator.estimate(enriched);
            const updates = { ftp_last_evaluated_at: result.estimated_at };
            if (result.ftp_watts) updates.ftp_pending_estimate = result;
            await root.profilesManager.updateProfile(profile.id, updates);
            renderFtpPanel();
            if (result.ftp_watts) showFtpProposal(result);
            else alert(result.explanation);
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Analyser mes performances'; }
        }
    }

    function showFtpProposal(result) {
        const profile = activeProfile();
        const modal = document.getElementById('ftpProposalModal');
        const text = document.getElementById('ftpProposalText');
        if (!modal || !profile) return;
        text.textContent = profile.ftp_watts
            ? `Votre FTP actuelle est de ${profile.ftp_watts} W. Vos performances récentes suggèrent ${result.ftp_watts} W (confiance ${result.confidence}). Souhaitez-vous adopter cette nouvelle valeur ?`
            : `Vos performances suggèrent une FTP de ${result.ftp_watts} W (confiance ${result.confidence}). Souhaitez-vous adopter cette valeur ?`;
        document.getElementById('ftpProposalExplanation').textContent = result.explanation;
        modal.style.display = 'flex';
    }

    async function decideFtp(action) {
        const profile = activeProfile();
        if (!profile || !profile.ftp_pending_estimate) return;
        const estimate = profile.ftp_pending_estimate;
        const updates = {};
        if (action === 'accept') {
            const history = Array.isArray(profile.ftp_history) ? profile.ftp_history.slice() : [];
            const source = estimate.source === 'test' ? 'test' : 'estimated';
            history.push({ watts: estimate.ftp_watts, source, confidence: estimate.confidence, recorded_at: new Date().toISOString(), contributors: estimate.contributors.map(c => c.session_id).filter(Boolean) });
            Object.assign(updates, { ftp_watts: estimate.ftp_watts, ftp_origin: source, ftp_confidence: estimate.confidence, ftp_history: history, ftp_pending_estimate: null });
        } else if (action === 'reject') {
            updates.ftp_pending_estimate = null;
            updates.ftp_last_rejected_at = new Date().toISOString();
        } else {
            updates.ftp_pending_estimate = { ...estimate, deferred_until: new Date(Date.now() + 7 * 86400000).toISOString() };
        }
        await root.profilesManager.updateProfile(profile.id, updates);
        document.getElementById('ftpProposalModal').style.display = 'none';
        renderFtpPanel();
        renderWorkouts();
    }

    function renderFtpPanel() {
        const p = activeProfile();
        const status = document.getElementById('ftpSmartStatus');
        const history = document.getElementById('ftpHistoryList');
        if (!status || !history) return;
        if (!p) { status.textContent = 'Sélectionnez un profil.'; history.innerHTML = ''; return; }
        const source = ({ manual: 'saisie manuelle', estimated: 'estimation acceptée', test: 'test guidé', legacy_unknown: 'ancienne valeur non vérifiée', unknown: 'inconnue' })[p.ftp_origin] || 'inconnue';
        const reevaluation = root.CycloFtpEstimator.shouldReevaluate(p, []) ? ' · Réanalyse conseillée' : '';
        status.innerHTML = `<strong>${p.ftp_watts ? `${p.ftp_watts} W` : 'FTP inconnue'}</strong><span>Origine : ${escapeHtml(source)} · Confiance : ${escapeHtml(p.ftp_confidence || 'inconnue')}</span><span>Dernière analyse : ${p.ftp_last_evaluated_at ? new Date(p.ftp_last_evaluated_at).toLocaleDateString() : 'jamais'}${reevaluation}</span>`;
        const entries = (p.ftp_history || []).slice().reverse();
        history.innerHTML = entries.length ? entries.map(item => `<li><strong>${escapeHtml(item.watts)} W</strong> · ${escapeHtml(item.source)} · ${new Date(item.recorded_at).toLocaleDateString()}</li>`).join('') : '<li>Aucune évolution enregistrée.</li>';
    }

    function miniProfileSvg(w, selected) {
        const total = Math.max(1, w.duration_seconds);
        let x = 0;
        const rects = w.steps.map(step => {
            const width = step.duration / total * 56;
            const height = Math.max(4, Math.min(22, (step.target_pct || .5) / 1.35 * 22));
            const y = 24 - height;
            const r = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, width - 0.8).toFixed(1)}" height="${height.toFixed(1)}" rx="1.5" fill="${selected ? '#7AA2F7' : '#4A5366'}"></rect>`;
            x += width;
            return r;
        }).join('');
        return `<svg aria-hidden="true" width="56" height="24" viewBox="0 0 56 24" style="flex:0 0 56px">${rects}</svg>`;
    }

    function compactWorkoutRow(w, isRecommended = false) {
        const minutes = Math.round(w.duration_seconds / 60);
        const selected = root.state && root.state.activeWorkout && root.state.activeWorkout.id === w.id;
        const star = isRecommended ? '<span class="star-badge" aria-label="Recommandée">★ </span>' : '';
        return `<button class="workout-compact-row${selected ? ' selected' : ''}" role="button" data-category="${escapeHtml(w.category)}" data-duration="${minutes}" data-difficulty="${w.difficulty}" onclick="CycloTrainingUI.showWorkout('${w.id}')">
            <div class="workout-row-info">
                <div class="workout-row-title">${star}${escapeHtml(w.name)}</div>
                <div class="workout-row-meta">${escapeHtml(w.category)} · ${minutes} min · Niveau ${w.difficulty}/5</div>
            </div>
            ${miniProfileSvg(w, selected)}
        </button>`;
    }

    function featuredRecommendationCard(item) {
        const w = item.workout || item;
        const minutes = Math.round(w.duration_seconds / 60);
        const selected = root.state && root.state.activeWorkout && root.state.activeWorkout.id === w.id;
        const total = Math.max(1, w.duration_seconds);
        let x = 0;
        const bars = w.steps.map(step => {
            const width = step.duration / total * 318;
            const height = Math.max(8, Math.min(46, (step.target_pct || .5) / 1.35 * 46));
            const y = 52 - height;
            const bar = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, width - 1).toFixed(1)}" height="${height.toFixed(1)}" rx="2" fill="${selected ? '#7AA2F7' : '#4A5366'}"></rect>`;
            x += width;
            return bar;
        }).join('');
        return `<article class="featured-recommendation-card${selected ? ' selected' : ''}">
            <div class="featured-rec-title">${escapeHtml(w.name)}</div>
            <div class="featured-rec-meta">${minutes} min · ${escapeHtml(w.category)} · Niveau ${w.difficulty} sur 5</div>
            <svg role="img" aria-label="Profil de la séance ${escapeHtml(w.name)}" viewBox="0 0 318 52" class="featured-rec-svg">${bars}</svg>
            <div class="featured-rec-reason">${escapeHtml(item.reason || 'Adaptée à votre profil.')}</div>
            <button class="btn btn-primary btn-wide" style="height:48px;margin-top:14px" onclick="selectWorkout('${w.id}'); switchTab('compteur')">Choisir cette séance</button>
        </article>`;
    }

    function renderWorkouts() {
        const p = activeProfile();
        const rec = document.getElementById('recommendedWorkouts');
        const all = document.getElementById('allWorkouts');
        if (!rec || !all || !root.CycloTrainingLibrary) return;
        const result = root.CycloTrainingRecommendations.recommend(p, ownSessions(), root.CycloTrainingLibrary);
        const selectedStatus = document.getElementById('selectedWorkoutStatus');
        if (selectedStatus) {
            const selected = root.state && root.state.activeWorkout;
            selectedStatus.innerHTML = selected
                ? `<div><span><strong>${escapeHtml(selected.name)}</strong> · <span>${Math.round(selected.duration_seconds / 60)} min · ${escapeHtml(selected.objective)}</span></span><button class="text-action" onclick="selectWorkout(null); switchTab('compteur')">Roule libre</button></div>`
                : '<div><span><strong>Mode roule libre</strong> · <span>Aucun intervalle structuré</span></span></div>';
        }
        if (result.recommendations && result.recommendations.length > 0) {
            rec.innerHTML = featuredRecommendationCard(result.recommendations[0]);
        } else {
            rec.innerHTML = '<p class="empty-state">Sélectionnez un profil pour obtenir des recommandations.</p>';
        }

        const otherRecIds = new Set((result.recommendations || []).slice(1).map(r => (r.workout ? r.workout.id : r.id)));
        all.innerHTML = root.CycloTrainingLibrary.list.map(item => compactWorkoutRow(item, otherRecIds.has(item.id))).join('');
        filterWorkouts();
    }

    function filterWorkouts() {
        const category = (document.getElementById('workoutCategoryFilter') || {}).value || '';
        const duration = Number((document.getElementById('workoutDurationFilter') || {}).value) || 0;
        const difficulty = Number((document.getElementById('workoutDifficultyFilter') || {}).value) || 0;
        document.querySelectorAll('#allWorkouts .workout-compact-row, #allWorkouts .training-card').forEach(card => {
            const ok = (!category || card.dataset.category === category) && (!duration || Number(card.dataset.duration) <= duration) && (!difficulty || Number(card.dataset.difficulty) <= difficulty);
            card.style.display = ok ? 'flex' : 'none';
        });
    }

    function showWorkout(id) {
        const w = root.CycloTrainingLibrary.get(id);
        if (!w) return;
        const modal = document.getElementById('workoutDetailModal');
        document.getElementById('workoutDetailTitle').textContent = w.name;
        document.getElementById('workoutDetailContent').innerHTML = `
            <p>${escapeHtml(w.description)}</p>
            <p><strong>Objectif :</strong> ${escapeHtml(w.objective)}</p>
            <p class="muted">${Math.round(w.duration_seconds / 60)} min · ${escapeHtml(w.category)} · Niveau ${w.difficulty}/5</p>
            <ol>${w.steps.map(s => {
                const guidance = w.is_ftp_test
                    ? `${s.rpe ? `RPE ${s.rpe}` : 'Au ressenti'}${s.effort_cue ? ` · ${s.effort_cue}` : ''}`
                    : (state.ftp ? `${Math.round(state.ftp * s.target_pct)} W (${s.type})` : `${s.type}, au ressenti`);
                return `<li>${escapeHtml(s.desc)} — ${root.formatTime(s.duration)} — ${escapeHtml(guidance)}</li>`;
            }).join('')}</ol>
            ${w.is_ftp_test ? '<p class="training-warning">Limite : 95 % de 20 minutes est une approximation influencée par le protocole, la motivation et la fatigue.</p>' : ''}
            <div class="button-row" style="margin-top:20px">
                <button class="btn btn-primary btn-wide" onclick="selectWorkout('${w.id}'); document.getElementById('workoutDetailModal').style.display='none'; switchTab('compteur')">Choisir cette séance</button>
            </div>
        `;
        modal.style.display = 'flex';
    }

    function savePreferences() {
        const p = activeProfile();
        if (!p) return;
        root.profilesManager.updateProfile(p.id, {
            training_goal: document.getElementById('trainingGoalInput').value,
            sessions_per_week: Number(document.getElementById('sessionsPerWeekInput').value) || null,
            session_duration_minutes: Number(document.getElementById('sessionDurationInput').value) || null,
            intensity_preference: document.getElementById('intensityPreferenceInput').value
        }).then(() => { renderWorkouts(); root.showAppToast('Préférences enregistrées.'); });
    }

    function loadPreferences() {
        const p = activeProfile(); if (!p) return;
        document.getElementById('trainingGoalInput').value = p.training_goal || 'general_progress';
        document.getElementById('sessionsPerWeekInput').value = p.sessions_per_week || '';
        document.getElementById('sessionDurationInput').value = p.session_duration_minutes || '';
        document.getElementById('intensityPreferenceInput').value = p.intensity_preference || 'balanced';
    }

    function showPostSession(session) {
        currentSession = session;
        const modal = document.getElementById('postSessionModal');
        if (!modal) return;
        document.getElementById('postSessionTitle').textContent = 'Séance terminée';
        const dateStr = new Date(session.started_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        document.getElementById('postSessionSummary').textContent = `${session.workout_name || 'Roule libre'} · ${dateStr}`;
        const next = root.CycloTrainingRecommendations.recommend(activeProfile(), ownSessions(), root.CycloTrainingLibrary, 1).recommendations[0];
        const nextEl = document.getElementById('postSessionNext');
        if (nextEl) nextEl.textContent = next ? `Prochaine séance suggérée : ${next.workout.name}. ${next.reason}` : '';
        if (root.CycloUI) root.CycloUI.renderPostSession(session);
        modal.style.display = 'flex';
    }
    function submitFeedback(rating) {
        if (!currentSession) return;
        root.CycloTrainingFeedback.save(currentSession.id, currentSession.profile_id, rating);
        document.getElementById('postSessionModal').style.display = 'none';
        root.showAppToast(`Ressenti enregistré : ${FEEDBACK_LABELS[rating]}.`);
        currentSession = null;
        renderWorkouts();
    }
    function skipFeedback() { document.getElementById('postSessionModal').style.display = 'none'; currentSession = null; }
    function keepCurrentSession() {
        document.getElementById('postSessionModal').style.display = 'none';
        root.showAppToast('Séance enregistrée dans votre historique.');
        currentSession = null;
    }
    async function discardCurrentSession() {
        if (!currentSession) return;
        if (!confirm('Supprimer cette séance sans l’enregistrer ? Cette action est irréversible.')) return;
        if (!root.deleteSessionById) return;
        const id = currentSession.id;
        await root.deleteSessionById(id);
        const stillExists = root.getStoredSessions && root.getStoredSessions().some(session => session.id === id);
        if (!stillExists) {
            document.getElementById('postSessionModal').style.display = 'none';
            currentSession = null;
        }
    }
    function exportCurrentSession() {
        if (currentSession && root.exportTCXById) root.exportTCXById(currentSession.id);
    }
    function emailCurrentSession() {
        if (currentSession && root.CycloEmail) root.CycloEmail.openForSession(currentSession);
    }

    async function requestGeminiAdvice() {
        const p = activeProfile();
        const target = document.getElementById('geminiAdviceText');
        if (!p || !target) return;
        const local = root.CycloTrainingRecommendations.recommend(p, ownSessions(), root.CycloTrainingLibrary);
        const button = document.getElementById('geminiAdviceBtn');
        target.classList.remove('training-error');
        target.textContent = 'Génération du conseil…';
        if (button) button.disabled = true;
        const indicators = { ...local.indicators };
        delete indicators.recent;
        const summary = { profile_id: p.id, goal: p.training_goal, ftp_known: !!p.ftp_watts, indicators };
        try {
            const response = await root.CycloGemini.request(summary, local.recommendations.map(item => item.workout.id));
            target.textContent = `${response.explanation}${response.tip ? ` — ${response.tip}` : ''}`;
        } catch (error) {
            target.classList.add('training-error');
            target.textContent = error.message;
        } finally {
            if (button) button.disabled = false;
        }
    }

    function refresh() { renderFtpPanel(); loadPreferences(); renderWorkouts(); }
    root.CycloTrainingUI = Object.freeze({ refresh, renderWorkouts, filterWorkouts, showWorkout, analyzeFtp, decideFtp, savePreferences, showPostSession, submitFeedback, skipFeedback, keepCurrentSession, discardCurrentSession, exportCurrentSession, emailCurrentSession, requestGeminiAdvice });
})(typeof window !== 'undefined' ? window : globalThis);
