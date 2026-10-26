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

    function pathPoints(values, width, height, maxValue, xValues = null, maxX = null) {
        const finite = values.map((value, index) => ({ value: Number(value), index })).filter(point => Number.isFinite(point.value));
        if (!finite.length) return '';
        const denominator = Math.max(1, values.length - 1);
        return finite.map(point => {
            const xRatio = xValues && maxX ? Math.min(1, number(xValues[point.index]) / maxX) : point.index / denominator;
            return `${(xRatio * width).toFixed(1)},${(height - Math.min(1, point.value / maxValue) * height).toFixed(1)}`;
        }).join(' ');
    }

    const COGGAN_ZONES = {
        Z1: { num: 1, name: 'Récupération' },
        Z2: { num: 2, name: 'Endurance' },
        Z3: { num: 3, name: 'Tempo' },
        Z4: { num: 4, name: 'Seuil' },
        Z5: { num: 5, name: 'VO2max' },
        Z6: { num: 6, name: 'Anaérobie' }
    };

    function cogganZoneString(stepType, targetPct) {
        if (!stepType) return '';
        const norm = String(stepType).toUpperCase().trim();
        const m = norm.match(/Z([1-6])/);
        if (m) {
            const key = 'Z' + m[1];
            const info = COGGAN_ZONES[key];
            const pctStr = targetPct ? ` · ${targetPct} % FTP` : '';
            return `${info ? `Zone ${info.num} · ${info.name}` : `Zone ${m[1]}`}${pctStr}`;
        }
        return norm + (targetPct ? ` · ${targetPct} % FTP` : '');
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
            if (finiteWatts.length < 2) {
                container.style.display = 'none';
                container.innerHTML = '';
            } else {
                container.style.display = 'flex';
                const max = Math.max(300, number(root.state.ftp) * 1.35, ...finiteWatts);
                const points = pathPoints(watts, 356, 52, max);
                container.innerHTML = `<svg class="timeline-power-line" viewBox="0 0 356 52" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
            }
            container.setAttribute('aria-label', 'Puissance des dix dernières minutes en roule libre');
            if (elapsedLabel) elapsedLabel.textContent = `${root.formatTime ? root.formatTime(elapsed) : '00:00'} / libre`;
            return;
        }

        container.style.display = 'flex';
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
        const points = pathPoints(values, 356, 52, Math.max(300, ftp * 1.35), root.state.sessionData.time || [], duration);
        container.innerHTML = `${bars}<svg class="timeline-power-line" viewBox="0 0 356 52" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
        container.setAttribute('aria-label', `Profil de ${workout.name}, ${root.state.currentWorkoutStepIndex + 1} sur ${workout.steps.length}`);
        if (elapsedLabel) elapsedLabel.textContent = `${root.formatTime(elapsed)} / ${root.formatTime(duration)}`;
    }

    function renderTargetFeedback() {
        if (!root.state) return;
        const current = stepAt(root.state.activeWorkout, number(root.state.elapsedTime));
        const isFtpTest = !!(root.state.activeWorkout && root.state.activeWorkout.is_ftp_test);
        const target = stepTarget(current && current.step, root.state.ftp);
        const power = rollingPower(5);
        const enabled = root.state.displaySettings ? root.state.displaySettings.zoneFeedbackEnabled : localStorage.getItem('zoneFeedbackEnabled') !== 'false';

        const badge = el('targetStatusBadge');
        const detail = el('targetDetailDisplay');
        if (!badge || !detail) return;

        if (isFtpTest && current) {
            targetState = 'neutral';
            badge.style.display = 'inline-flex';
            badge.className = 'target-badge neutral';
            badge.textContent = 'Effort au ressenti';
            const rpe = current.step.rpe ? `RPE ${current.step.rpe}` : 'Au ressenti';
            detail.textContent = current.step.effort_cue ? `${rpe} · ${current.step.effort_cue}` : rpe;
            document.body.classList.remove('zone-ok', 'zone-high', 'zone-low');
            return;
        }

        if (!current || !target) {
            targetState = 'neutral';
            badge.style.display = 'none';
            if (root.state.activeWorkout && !number(root.state.ftp)) {
                detail.textContent = 'FTP requise pour afficher la cible';
            } else if (number(root.state.ftp) && Number.isFinite(power) && power > 0) {
                let zKey = 'Z1';
                if (power > root.state.ftp * 1.2) zKey = 'Z6';
                else if (power > root.state.ftp * 1.05) zKey = 'Z5';
                else if (power > root.state.ftp * 0.9) zKey = 'Z4';
                else if (power > root.state.ftp * 0.75) zKey = 'Z3';
                else if (power > root.state.ftp * 0.55) zKey = 'Z2';
                detail.textContent = cogganZoneString(zKey, Math.round(power / root.state.ftp * 100));
            } else {
                detail.textContent = 'Roule libre';
            }
            document.body.classList.remove('zone-ok', 'zone-high', 'zone-low');
            return;
        }

        badge.style.display = 'inline-flex';
        const rangeLow = Math.round(target * (1 - TARGET_TOLERANCE));
        const rangeHigh = Math.round(target * (1 + TARGET_TOLERANCE));
        const pct = number(root.state.ftp) ? Math.round(target / number(root.state.ftp) * 100) : 0;
        detail.textContent = cogganZoneString(current.step.type, pct);

        const isActivelyRiding = root.state.isRecording && !root.state.isPaused && Number.isFinite(power) && power > 0;
        if (isActivelyRiding) {
            targetState = classifyTarget(power, target, targetState);
        } else {
            targetState = 'neutral';
        }

        if (targetState === 'high') {
            const diff = Math.round(power - target);
            badge.className = 'target-badge high';
            badge.textContent = `↑ Trop haut · +${diff} W`;
        } else if (targetState === 'low') {
            const diff = Math.round(target - power);
            badge.className = 'target-badge low';
            badge.textContent = `↓ Trop bas · −${diff} W`;
        } else {
            badge.className = 'target-badge ok';
            badge.textContent = `Dans la cible · ${rangeLow}–${rangeHigh} W`;
        }

        document.body.classList.remove('zone-ok', 'zone-high', 'zone-low');
        if (enabled && isActivelyRiding && targetState !== 'neutral') {
            document.body.classList.add(`zone-${targetState}`);
        }
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
        const times = root.state.sessionData.time || [];
        const finiteValues = values.filter(value => Number.isFinite(Number(value))).map(Number);
        const ftp = number(session.ftp_at_session_watts || root.state.ftp);
        const max = Math.max(300, ftp * 1.35, ...finiteValues);

        let workout = root.state.activeWorkout;
        if (!workout && session.workout_id && root.CycloTrainingLibrary) {
            workout = root.CycloTrainingLibrary.getById ? root.CycloTrainingLibrary.getById(session.workout_id) : (root.CycloTrainingLibrary.get ? root.CycloTrainingLibrary.get(session.workout_id) : null);
        }
        const duration = Math.max(1, workout ? totalDuration(workout) : number(session.duration_seconds), number(session.duration_seconds));

        const W = 356;
        const H = 90;
        let barsSvg = '';
        if (workout && Array.isArray(workout.steps) && workout.steps.length > 0) {
            let curX = 0;
            barsSvg = workout.steps.map(step => {
                const stepDur = number(step.duration);
                const barW = (stepDur / duration) * W;
                const pct = number(step.target_pct, 0.5);
                const barH = Math.max(6, Math.min(H - 8, (pct / 1.35) * (H - 8)));
                const y = H - barH;
                const r = `<rect x="${curX.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="#4A5366"></rect>`;
                curX += barW;
                return r;
            }).join('');
        }

        const points = pathPoints(values, W, H, max, times, duration);
        const lineSvg = points ? `<polyline points="${points}" fill="none" stroke="#ECEEF2" stroke-width="1.8" stroke-linejoin="round"></polyline>` : '';

        const graph = el('postSessionGraph');
        if (graph) {
            graph.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil et courbe de puissance de la séance" style="display:block;width:100%;height:100%">${barsSvg}${lineSvg}</svg>`;
        }

        const breakdown = workout && workout.is_ftp_test ? { ok: 0, high: 0, low: 0 } : targetBreakdown(workout, times, values, ftp);
        const total = Math.max(1, breakdown.ok + breakdown.high + breakdown.low);
        const pctOk = Math.round(breakdown.ok / total * 100);
        const pctHigh = Math.round(breakdown.high / total * 100);
        const pctLow = Math.round(breakdown.low / total * 100);

        const targetPct = el('postSessionTargetPct');
        if (targetPct) targetPct.textContent = workout && workout.is_ftp_test ? 'Au ressenti' : `${pctOk} %`;

        const targetBar = el('postSessionTargetBar');
        if (targetBar) targetBar.innerHTML = workout && workout.is_ftp_test ? '' : ['ok', 'high', 'low'].map(key => `<span class="${key}" style="width:${(breakdown[key] / total * 100).toFixed(1)}%"></span>`).join('');
        const legend = el('postSessionTargetLegend');
        if (legend) legend.innerHTML = workout && workout.is_ftp_test
            ? '<span>Test guidé au ressenti, sans cible de watts.</span>'
            : `<span>Dans la cible · ${pctOk} %</span><span>Trop haut · ${pctHigh} %</span><span>Trop bas · ${pctLow} %</span>`;

        const stats = el('postSessionStats');
        if (stats) {
            const cells = [
                ['Durée', root.formatTime(number(session.duration_seconds))],
                ['Distance', `${(number(session.distance_meters) / 1000).toFixed(1)} km`],
                ['Moyenne', `${Math.round(number(session.avg_power_watts))} W`],
                ['Max', `${Math.round(number(session.max_power_watts))} W`],
                ['Travail', `${Math.round(number(session.total_work_kj))} kJ`],
                ['Énergie', `${Math.round(session.energy_kcal || number(session.total_work_kj))} kcal`]
            ];
            stats.innerHTML = cells.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
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
