function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getZoneTargetString(zoneStr) {
    if (!Number(state.ftp)) return 'au ressenti';
    switch(zoneStr) {
        case 'Z1': return `< ${Math.round(state.ftp * 0.55)} W`;
        case 'Z2': return `${Math.round(state.ftp * 0.55)} - ${Math.round(state.ftp * 0.75)} W`;
        case 'Z3': return `${Math.round(state.ftp * 0.76)} - ${Math.round(state.ftp * 0.90)} W`;
        case 'Z4': return `${Math.round(state.ftp * 0.91)} - ${Math.round(state.ftp * 1.05)} W`;
        case 'Z5': return `${Math.round(state.ftp * 1.06)} - ${Math.round(state.ftp * 1.20)} W`;
        case 'Z6': return `> ${Math.round(state.ftp * 1.20)} W`;
        default: return '--- W';
    }
}

function getWorkoutStepGuidance(workout, step) {
    if (!step) return 'Sans consigne';
    if (workout && workout.is_ftp_test) {
        const rpe = step.rpe ? `RPE ${step.rpe}` : 'Au ressenti';
        return step.effort_cue ? `${rpe} · ${step.effort_cue}` : rpe;
    }
    return `Zone ${step.type} (${getZoneTargetString(step.type)})`;
}

function getZoneColor(zoneStr) {
    const root = getComputedStyle(document.documentElement);
    switch(zoneStr) {
        case 'Z1': return root.getPropertyValue('--z1').trim();
        case 'Z2': return root.getPropertyValue('--z2').trim();
        case 'Z3': return root.getPropertyValue('--z3').trim();
        case 'Z4': return root.getPropertyValue('--z4').trim();
        case 'Z5': return root.getPropertyValue('--z5').trim();
        case 'Z6': return root.getPropertyValue('--z6').trim();
        default: return '#334155';
    }
}

function selectWorkout(workoutId) {
    if (!workoutId) {
        state.activeWorkout = null;
        if (window.showAppToast) window.showAppToast('Mode roule libre sélectionné.');
    } else {
        const selectedWorkout = config.workoutsDB[workoutId];
        if (!selectedWorkout) return;
        if (selectedWorkout.requires_ftp && !Number(state.ftp)) {
            alert('Cette séance nécessite une FTP connue. Vous pouvez saisir votre FTP, lancer le test guidé ou choisir une séance facile au ressenti.');
            return;
        }
        state.activeWorkout = selectedWorkout;
        if (window.showAppToast) window.showAppToast(`Entraînement « ${state.activeWorkout.name} » sélectionné.`);
    }
    renderWorkoutStepList();
    updateWorkoutBanner();
    if (window.updateKioskWorkoutBanner) window.updateKioskWorkoutBanner();
    if (window.CycloUI) window.CycloUI.renderCounter();
    if (window.CycloTrainingUI) window.CycloTrainingUI.renderWorkouts();
    if (window.switchTab) {
        window.switchTab(state.currentTab === 'dashboard' ? 'dashboard' : 'compteur');
    }
}

function renderWorkoutStepList() {
    const listContainer = document.getElementById('workoutStepList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (!state.activeWorkout) {
        listContainer.style.display = 'none';
        return;
    }
    
    listContainer.style.display = 'flex';
    const steps = state.activeWorkout.steps;
    const currentIdx = state.currentWorkoutStepIndex;
    
    // moving window: 1 completed, current active, and next 2 upcoming steps
    const startIdx = Math.max(0, currentIdx - 1);
    const endIdx = Math.min(steps.length, currentIdx + 3);
    
    for (let i = startIdx; i < endIdx; i++) {
        const step = steps[i];
        const stepItem = document.createElement('div');
        stepItem.className = 'step-item';
        
        let icon = '•';
        if (i < currentIdx) {
            stepItem.classList.add('completed');
            icon = '✓';
        } else if (i === currentIdx) {
            stepItem.classList.add('active');
            icon = '▶';
        }
        
        stepItem.innerHTML = `
            <div class="step-left">
                <span class="step-icon">${icon}</span>
                <span class="step-desc">${step.desc}</span>
                <span class="step-duration">${formatTime(step.duration)}</span>
            </div>
            <span class="step-badge" style="background-color: ${getZoneColor(step.type)}">${step.type}</span>
        `;
        listContainer.appendChild(stepItem);
    }
    
    // footer if there are more steps remaining
    if (endIdx < steps.length) {
        const remainingCount = steps.length - endIdx;
        let remainingDuration = 0;
        for (let i = endIdx; i < steps.length; i++) {
            remainingDuration += steps[i].duration;
        }
        
        const footer = document.createElement('div');
        footer.className = 'step-list-footer';
        footer.innerText = `... et ${remainingCount} autres étapes (${formatTime(remainingDuration)})`;
        listContainer.appendChild(footer);
    }
}

function updateWorkoutBanner() {
    const banner = document.getElementById('workoutBanner');
    const listContainer = document.getElementById('workoutStepList');
    if (!banner) return;
    
    if (!state.activeWorkout) {
        banner.classList.remove('active');
        if (listContainer) listContainer.style.display = 'none';
        return;
    }
    banner.classList.add('active');
    if (listContainer) listContainer.style.display = 'flex';

    if (!state.isRecording) {
        document.getElementById('workoutNameDisplay').innerText = `Sélectionné : ${state.activeWorkout.name}`;
        document.getElementById('workoutTargetDisplay').innerText = `${Math.round(state.activeWorkout.duration_seconds / 60)} min · ${state.activeWorkout.objective}`;
        document.getElementById('workoutTimeDisplay').innerText = 'Prêt à démarrer';
        document.getElementById('zoneBar').style.width = '0%';
        renderWorkoutStepList();
        return;
    }

    if (state.currentWorkoutStepIndex >= state.activeWorkout.steps.length) {
        document.getElementById('workoutNameDisplay').innerText = "Entraînement terminé ! (Roule libre)";
        document.getElementById('workoutTargetDisplay').innerText = "Cible : ---";
        document.getElementById('workoutTimeDisplay').innerText = "";
        document.getElementById('zoneBar').style.width = "0%";
        banner.style.borderLeftColor = "var(--success)";
        if (listContainer) listContainer.style.display = 'none';
        return;
    }

    const steps = state.activeWorkout.steps;
    const step = steps[state.currentWorkoutStepIndex];
    const timeRemaining = step.duration - state.workoutStepTimeElapsed;

    document.getElementById('workoutNameDisplay').innerText = `${state.activeWorkout.name} - ${step.desc} (${state.currentWorkoutStepIndex + 1}/${steps.length})`;
    document.getElementById('workoutTargetDisplay').innerText = `Consigne : ${getWorkoutStepGuidance(state.activeWorkout, step)}`;
    document.getElementById('workoutTimeDisplay').innerText = `Temps restant : ${formatTime(timeRemaining)}`;
    
    const color = getZoneColor(step.type);
    banner.style.borderLeftColor = color;
    document.getElementById('zoneBar').style.background = color;
    
    let pct = (state.currentWatts / (state.ftp * 1.5)) * 100;
    if (pct > 100) pct = 100;
    document.getElementById('zoneBar').style.width = `${pct}%`;

}

function advanceWorkout(elapsedSeconds) {
    if (!state.activeWorkout || !state.isRecording || elapsedSeconds <= 0) return;
    const previousStep = state.currentWorkoutStepIndex;
    state.workoutStepTimeElapsed += elapsedSeconds;

    while (state.currentWorkoutStepIndex < state.activeWorkout.steps.length) {
        const step = state.activeWorkout.steps[state.currentWorkoutStepIndex];
        if (state.workoutStepTimeElapsed < step.duration) break;
        state.workoutStepTimeElapsed -= step.duration;
        state.currentWorkoutStepIndex++;
    }

    if (state.currentWorkoutStepIndex !== previousStep && state.currentTab === 'dashboard') {
        renderWorkoutStepList();
    }
}

// Expose functions globally
window.formatTime = formatTime;
window.getZoneTargetString = getZoneTargetString;
window.getWorkoutStepGuidance = getWorkoutStepGuidance;
window.getZoneColor = getZoneColor;
window.selectWorkout = selectWorkout;
window.renderWorkoutStepList = renderWorkoutStepList;
window.updateWorkoutBanner = updateWorkoutBanner;
window.advanceWorkout = advanceWorkout;
