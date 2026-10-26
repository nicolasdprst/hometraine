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

    function workoutCard(item, reason) {
        const w = item.workout || item;
        const minutes = Math.round(w.duration_seconds / 60);
        const selected = root.state && root.state.activeWorkout && root.state.activeWorkout.id === w.id;
        const total = Math.max(1, w.duration_seconds);
        let x = 0;
        const bars = w.steps.map(step => {
            const width = step.duration / total * 100;
            const height = Math.max(8, Math.min(44, (step.target_pct || .5) / 1.35 * 44));
            const bar = `<rect x="${x.toFixed(2)}" y="${(46 - height).toFixed(2)}" width="${Math.max(.8, width - .6).toFixed(2)}" height="${height.toFixed(2)}" rx="1" class="${selected ? 'profile-accent' : ''}"></rect>`;
            x += width;
            return bar;
        }).join('');
        const reasonMarkup = reason ? `<p class="recommendation-reason">${escapeHtml(reason)}</p>` : '';
        return `<article class="training-card${selected ? ' selected' : ''}" role="button" tabindex="0" aria-label="Voir ${escapeHtml(w.name)}" data-category="${escapeHtml(w.category)}" data-duration="${minutes}" data-difficulty="${w.difficulty}" onclick="CycloTrainingUI.showWorkout('${w.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();CycloTrainingUI.showWorkout('${w.id}')}"><svg class="training-card-profile" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">${bars}</svg><div class="training-card-copy"><span class="training-category">${escapeHtml(w.category)}</span><h3>${escapeHtml(w.name)}</h3><p>${minutes} min · Difficulté ${w.difficulty}/5</p>${reasonMarkup}</div><div class="training-card-actions"><button class="btn btn-primary" onclick="event.stopPropagation();selectWorkout('${w.id}')">${selected ? 'Choisi' : 'Choisir'}</button></div></article>`;
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
                ? `<div><span><strong>${escapeHtml(selected.name)}</strong><span>${Math.round(selected.duration_seconds / 60)} min · ${escapeHtml(selected.objective)}</span></span><button class="text-action" onclick="selectWorkout(null)">Roule libre</button></div>`
                : '<div><span><strong>Mode roule libre</strong><span>Aucun intervalle structuré</span></span></div>';
        }
        rec.innerHTML = result.recommendations.map(item => workoutCard(item, item.reason)).join('');
        all.innerHTML = root.CycloTrainingLibrary.list.map(item => workoutCard(item)).join('');
        filterWorkouts();
    }

    function filterWorkouts() {
        const category = (document.getElementById('workoutCategoryFilter') || {}).value || '';
        const duration = Number((document.getElementById('workoutDurationFilter') || {}).value) || 0;
        const difficulty = Number((document.getElementById('workoutDifficultyFilter') || {}).value) || 0;
        document.querySelectorAll('#allWorkouts .training-card').forEach(card => {
            const ok = (!category || card.dataset.category === category) && (!duration || Number(card.dataset.duration) <= duration) && (!difficulty || Number(card.dataset.difficulty) <= difficulty);
            card.style.display = ok ? 'flex' : 'none';
        });
    }

    function showWorkout(id) {
        const w = root.CycloTrainingLibrary.get(id);
        if (!w) return;
        const modal = document.getElementById('workoutDetailModal');
        document.getElementById('workoutDetailTitle').textContent = w.name;
        document.getElementById('workoutDetailContent').innerHTML = `<p>${escapeHtml(w.description)}</p><p><strong>Objectif :</strong> ${escapeHtml(w.objective)}</p><ol>${w.steps.map(s => `<li>${escapeHtml(s.desc)} — ${root.formatTime(s.duration)} — ${state.ftp ? `${Math.round(state.ftp * s.target_pct)} W (${s.type})` : `${s.type}, au ressenti`}</li>`).join('')}</ol>${w.is_ftp_test ? '<p class="training-warning">Limite : 95 % de 20 minutes est une approximation influencée par le protocole, la motivation et la fatigue.</p>' : ''}`;
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
        document.getElementById('postSessionTitle').textContent = session.workout_name || 'Votre bilan';
        document.getElementById('postSessionSummary').textContent = `${new Date(session.started_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${Math.round(session.duration_seconds / 60)} min`;
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
        root.showAppToast('Séance conservée dans votre historique.');
        currentSession = null;
    }
    async function discardCurrentSession() {
        if (!currentSession || !root.deleteSessionById) return;
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
