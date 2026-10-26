(function (root) {
    'use strict';

    const TARGET_TOLERANCE = 0.07;
    const TARGET_HYSTERESIS = 0.05;
    let targetState = 'neutral';

    function el(id) { return document.getElementById(id); }
    function number(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function totalDuration(workout) {
        if (!workout) return 0;
        return number(workout.duration_seconds) || (workout.steps || []).reduce((sum, step) => sum + number(step.duration), 0);
    }

    function stepAt(workout, elapsedSeconds) {
        if (!workout || !Array.isArray(workout.steps)) return null;
        let cursor = 0;
        for (let index = 0; index < workout.steps.length; index++) {
            const step = workout.steps[index];
            const end = cursor + number(step.duration);
            if (elapsedSeconds < end) return { step, index, start: cursor, end };
            cursor = end;
        }
        return null;
    }

    function stepTarget(step, ftp) {
        if (!step || !number(ftp)) return null;
        const pct = number(step.target_pct, ({ Z1: .50, Z2: .68, Z3: .84, Z4: .98, Z5: 1.12, Z6: 1.30 }[step.type] || 0));
        return pct > 0 ? Math.round(number(ftp) * pct) : null;
    }

    function rollingPower(seconds = 5) {
        const data = root.state && root.state.sessionData;
        if (!data || !Array.isArray(data.watts)) return number(root.state && root.state.currentWatts, null);
        const values = data.watts.slice(-seconds).filter(value => Number.isFinite(Number(value))).map(Number);
        if (Number.isFinite(Number(root.state.currentWatts))) values.push(Number(root.state.currentWatts));
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }

    function classifyTarget(power, target, previous = 'neutral') {
        if (!number(target) || !Number.isFinite(power)) return 'neutral';
        const deviation = (power - target) / target;
        if (previous === 'high' && deviation > TARGET_HYSTERESIS) return 'high';
        if (previous === 'low' && deviation < -TARGET_HYSTERESIS) return 'low';
        if (deviation > TARGET_TOLERANCE) return 'high';
        if (deviation < -TARGET_TOLERANCE) return 'low';
        return 'ok';
    }

    function pathPoints(values, width, height, maxValue) {
        const finite = values.map((value, index) => ({ value: Number(value), index })).filter(point => Number.isFinite(point.value));
        if (!finite.length) return '';
        const denominator = Math.max(1, values.length - 1);
        return finite.map(point => `${(point.index / denominator * width).toFixed(1)},${(height - Math.min(1, point.value / maxValue) * height).toFixed(1)}`).join(' ');
    }

    function renderTimeline() {
        const container = el('workoutTimeline');
        const elapsedLabel = el('workoutElapsedDisplay');
        if (!container || !root.state) return;
        const workout = root.state.activeWorkout;
        const elapsed = number(root.state.elapsedTime);

        if (!workout) {
            const watts = (root.state.sessionData.watts || []).slice(-600);
            const finiteWatts = watts.filter(value => Number.isFinite(Number(value))).map(Number);
            const max = Math.max(300, number(root.state.ftp) * 1.35, ...finiteWatts);
            const points = pathPoints(watts, 356, 70, max);
            container.innerHTML = `<svg class="timeline-power-line" viewBox="0 0 356 70" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
            container.setAttribute('aria-label', 'Puissance des dix dernières minutes en roule libre');
            if (elapsedLabel) elapsedLabel.textContent = `${root.formatTime ? root.formatTime(elapsed) : '00:00'} / libre`;
            return;
        }

        const duration = Math.max(1, totalDuration(workout));
        const ftp = number(root.state.ftp);
        const bars = workout.steps.map((step, index) => {
            const width = Math.max(.3, number(step.duration) / duration * 100);
            const pct = number(step.target_pct, .5);
            const height = Math.max(14, Math.min(100, pct / 1.35 * 100));
            const status = index < root.state.currentWorkoutStepIndex ? 'done' : index === root.state.currentWorkoutStepIndex ? 'current' : 'future';
            return `<span class="timeline-step ${status}" style="width:${width.toFixed(2)}%;height:${height.toFixed(1)}%" title="${escapeHtml(step.desc)}"></span>`;
        }).join('');
        const values = root.state.sessionData.watts || [];
        const points = pathPoints(values, 356, 70, Math.max(300, ftp * 1.35));
        container.innerHTML = `${bars}<svg class="timeline-power-line" viewBox="0 0 356 70" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
        container.setAttribute('aria-label', `Profil de ${workout.name}, ${root.state.currentWorkoutStepIndex + 1} sur ${workout.steps.length}`);
        if (elapsedLabel) elapsedLabel.textContent = `${root.formatTime(elapsed)} / ${root.formatTime(duration)}`;
    }

    function renderTargetFeedback() {
        if (!root.state) return;
        const current = stepAt(root.state.activeWorkout, number(root.state.elapsedTime));
        const target = stepTarget(current && current.step, root.state.ftp);
        const power = rollingPower(5);
        const enabled = root.state.displaySettings ? root.state.displaySettings.zoneFeedbackEnabled : localStorage.getItem('zoneFeedbackEnabled') !== 'false';
        targetState = enabled && root.state.isRecording && !root.state.isPaused ? classifyTarget(power, target, targetState) : 'neutral';
        document.body.classList.remove('zone-ok', 'zone-high', 'zone-low');
        if (targetState !== 'neutral') document.body.classList.add(`zone-${targetState}`);

        const badge = el('targetStatusBadge');
        const detail = el('targetDetailDisplay');
        if (!badge || !detail) return;
        badge.className = `target-badge ${targetState}`;
        if (!current || !target) {
            badge.textContent = root.state.isPaused ? 'En pause' : 'Pas de cible';
            detail.textContent = root.state.activeWorkout && !number(root.state.ftp) ? 'FTP requise pour afficher la cible' : 'Roule libre';
            return;
        }
        const labels = { ok: 'Dans la cible', high: 'Au-dessus', low: 'En dessous', neutral: 'Cible' };
        badge.textContent = labels[targetState];
        const pct = number(root.state.ftp) ? Math.round(target / number(root.state.ftp) * 100) : 0;
        detail.textContent = `${current.step.type} · ${target} W · ${pct}% FTP`;
    }

    function syncPauseButton() {
        const pause = el('kioskPauseBtn');
        if (!pause || !root.state) return;
        pause.style.display = root.state.isRecording ? 'flex' : 'none';
        pause.textContent = root.state.isPaused ? 'Reprendre' : 'Pause';
        pause.setAttribute('aria-pressed', root.state.isPaused ? 'true' : 'false');
    }

    function renderCounter() {
        renderTimeline();
        renderTargetFeedback();
        const max = el('wattsMaxVal');
        if (max && root.state) max.textContent = Math.round(number(root.state.maxWatts));
        syncPauseButton();
    }

    function togglePause() {
        if (!root.state || !root.state.isRecording) return;
        const now = root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now();
        if (!root.state.isPaused) {
            root.state.isPaused = true;
            root.state.sessionStatus = 'paused';
            root.state.pauseStartedMonotonic = now;
        } else {
            const pausedFor = Math.max(0, now - number(root.state.pauseStartedMonotonic, now));
            root.state.sessionStartMonotonic += pausedFor;
            root.state.lastTickMonotonic = now;
            root.state.lastTickWallTime = Date.now();
            root.state.pauseStartedMonotonic = null;
            root.state.isPaused = false;
            root.state.sessionStatus = 'recording';
        }
        renderCounter();
    }

    function targetBreakdown(workout, times, watts, ftp) {
        const totals = { ok: 0, high: 0, low: 0 };
        if (!workout || !number(ftp)) return totals;
        for (let index = 0; index < times.length; index++) {
            const stepInfo = stepAt(workout, number(times[index]));
            const target = stepTarget(stepInfo && stepInfo.step, ftp);
            const power = Number(watts[index]);
            const bucket = classifyTarget(power, target, 'neutral');
            if (bucket !== 'neutral') totals[bucket] += 1;
        }
        return totals;
    }

    function renderPostSession(session) {
        if (!session || !root.state) return;
        const values = root.state.sessionData.watts || [];
        const finiteValues = values.filter(value => Number.isFinite(Number(value))).map(Number);
        const ftp = number(session.ftp_at_session_watts || root.state.ftp);
        const max = Math.max(300, ftp * 1.35, ...finiteValues);
        const points = pathPoints(values, 356, 110, max);
        const graph = el('postSessionGraph');
        if (graph) graph.innerHTML = `<svg viewBox="0 0 356 110" preserveAspectRatio="none" role="img" aria-label="Courbe de puissance de la séance"><polyline points="${points}" fill="none" stroke="#7AA2F7" stroke-width="2" vector-effect="non-scaling-stroke"></polyline></svg>`;

        const breakdown = targetBreakdown(root.state.activeWorkout, root.state.sessionData.time || [], values, ftp);
        const total = Math.max(1, breakdown.ok + breakdown.high + breakdown.low);
        const targetBar = el('postSessionTargetBar');
        if (targetBar) targetBar.innerHTML = ['ok', 'high', 'low'].map(key => `<span class="${key}" style="width:${(breakdown[key] / total * 100).toFixed(1)}%"></span>`).join('');
        const legend = el('postSessionTargetLegend');
        if (legend) legend.innerHTML = `<span>Dans la cible ${Math.round(breakdown.ok / total * 100)}%</span><span>Au-dessus ${Math.round(breakdown.high / total * 100)}%</span><span>En dessous ${Math.round(breakdown.low / total * 100)}%</span>`;

        const stats = el('postSessionStats');
        if (stats) {
            const cells = [
                ['Durée', root.formatTime(number(session.duration_seconds))],
                ['Distance', `${(number(session.distance_meters) / 1000).toFixed(2)} km`],
                ['Puiss. moy.', `${number(session.avg_power_watts)} W`],
                ['Puiss. max', `${number(session.max_power_watts)} W`],
                ['Vitesse moy.', `${number(session.avg_speed_kmh).toFixed(1)} km/h`],
                ['Travail', `${number(session.total_work_kj)} kJ`]
            ];
            stats.innerHTML = cells.map(([label, value]) => `<div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div>`).join('');
        }
    }

    function init() {
        const pause = el('kioskPauseBtn');
        if (pause) pause.addEventListener('click', togglePause);
        const toggle = el('zoneFeedbackToggle');
        if (toggle) {
            toggle.checked = root.state.displaySettings ? root.state.displaySettings.zoneFeedbackEnabled : localStorage.getItem('zoneFeedbackEnabled') !== 'false';
            toggle.addEventListener('change', () => {
                localStorage.setItem('zoneFeedbackEnabled', toggle.checked ? 'true' : 'false');
                if (root.state.displaySettings) root.state.displaySettings.zoneFeedbackEnabled = toggle.checked;
                renderTargetFeedback();
            });
        }
        renderCounter();
    }

    root.CycloUI = Object.freeze({ init, renderCounter, renderTimeline, renderTargetFeedback, renderPostSession, classifyTarget, targetBreakdown, togglePause });
    document.addEventListener('DOMContentLoaded', init, { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
