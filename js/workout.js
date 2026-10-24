function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getZoneTargetString(zoneStr) {
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
        alert("Entraînement libre sélectionné.");
    } else {
        // Query FTP if not already configured in localStorage
        const savedFtp = localStorage.getItem('userFTP');
        if (!savedFtp) {
            let input = prompt("Pour adapter les zones d'intensité de cet entraînement, veuillez renseigner votre FTP en Watts :\n(Si vous ne la connaissez pas, cliquez sur Annuler ou laissez vide)");
            
            if (input === null) {
                // User cancelled the selection entirely, abort selection
                return;
            }
            
            let ftpVal = parseInt(input.trim());
            if (!isNaN(ftpVal) && ftpVal > 0) {
                state.ftp = ftpVal;
                localStorage.setItem('userFTP', state.ftp);
                const ftpInput = document.getElementById('ftpInput');
                if (ftpInput) ftpInput.value = state.ftp;
                if (window.updateZonesDisplay) window.updateZonesDisplay();
                alert(`Parfait ! Votre FTP a été configurée à ${state.ftp} W.`);
            } else {
                // Level selector prompt
                let level = prompt("Estimez votre niveau de cyclisme actuel pour configurer une FTP par défaut :\n\n1. Débutant (150 W)\n2. Intermédiaire (200 W)\n3. Semi-pro (280 W)\n4. Pro (350 W)\n\nEntrez le chiffre correspondant (1, 2, 3 ou 4) :");
                
                if (level === null) {
                    // Abort selection if user cancelled level prompt
                    return;
                }
                
                let estimatedFtp = 200;
                let levelName = "Intermédiaire";
                const choice = level.trim();
                
                if (choice === '1') { estimatedFtp = 150; levelName = "Débutant"; }
                else if (choice === '2') { estimatedFtp = 200; levelName = "Intermédiaire"; }
                else if (choice === '3') { estimatedFtp = 280; levelName = "Semi-pro"; }
                else if (choice === '4') { estimatedFtp = 350; levelName = "Pro"; }
                else {
                    alert("Choix invalide. Configuration par défaut en mode 'Intermédiaire' (200 W).");
                }
                
                state.ftp = estimatedFtp;
                localStorage.setItem('userFTP', state.ftp);
                const ftpInput = document.getElementById('ftpInput');
                if (ftpInput) ftpInput.value = state.ftp;
                if (window.updateZonesDisplay) window.updateZonesDisplay();
                alert(`Niveau "${levelName}" sélectionné. Votre FTP a été configurée à ${state.ftp} W.`);
            }
        }
        
        state.activeWorkout = config.workoutsDB[workoutId];
        alert(`Entraînement "${state.activeWorkout.name}" sélectionné.`);
    }
    renderWorkoutStepList();
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
    
    if (!state.activeWorkout || !state.isRecording) {
        banner.classList.remove('active');
        if (listContainer) listContainer.style.display = 'none';
        return;
    }
    banner.classList.add('active');
    if (listContainer) listContainer.style.display = 'flex';

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
    document.getElementById('workoutTargetDisplay').innerText = `Cible : Zone ${step.type} (${getZoneTargetString(step.type)})`;
    document.getElementById('workoutTimeDisplay').innerText = `Temps restant : ${formatTime(timeRemaining)}`;
    
    // Rerender the active checklist roadmap
    renderWorkoutStepList();
    
    const color = getZoneColor(step.type);
    banner.style.borderLeftColor = color;
    document.getElementById('zoneBar').style.background = color;
    
    let pct = (state.currentWatts / (state.ftp * 1.5)) * 100;
    if (pct > 100) pct = 100;
    document.getElementById('zoneBar').style.width = `${pct}%`;

    state.workoutStepTimeElapsed++;
    if (state.workoutStepTimeElapsed >= step.duration) {
        state.currentWorkoutStepIndex++;
        state.workoutStepTimeElapsed = 0;
    }
}

// Expose functions globally
window.formatTime = formatTime;
window.getZoneTargetString = getZoneTargetString;
window.getZoneColor = getZoneColor;
window.selectWorkout = selectWorkout;
window.renderWorkoutStepList = renderWorkoutStepList;
window.updateWorkoutBanner = updateWorkoutBanner;
