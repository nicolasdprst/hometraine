(function (root) {
    'use strict';
    const DAY = 86400000;
    const DIFFICULT = new Set(['difficult', 'too_difficult']);
    const EASY = new Set(['very_easy', 'easy']);

    function summarize(profile, sessions, now = Date.now()) {
        const own = (sessions || []).filter(s => !profile || !profile.id || s.profile_id === profile.id);
        const recent = own.filter(s => now - new Date(s.started_at || s.date || 0).getTime() <= 28 * DAY);
        const last7 = recent.filter(s => now - new Date(s.started_at || s.date || 0).getTime() <= 7 * DAY);
        const feelings = recent.map(s => s.feedback_rating).filter(Boolean);
        return {
            session_count_28d: recent.length,
            session_count_7d: last7.length,
            minutes_28d: Math.round(recent.reduce((n, s) => n + Number(s.active_duration_seconds || s.duration_seconds || 0), 0) / 60),
            difficult_count: feelings.filter(v => DIFFICULT.has(v)).length,
            easy_count: feelings.filter(v => EASY.has(v)).length,
            last_session_at: recent[0] ? recent[0].started_at : null,
            recent
        };
    }

    function recommend(profile, sessions, library, limit = 3, now = Date.now()) {
        const lib = library && library.list ? library.list : [];
        const stats = summarize(profile, sessions, now);
        const goal = profile && profile.training_goal || 'general_progress';
        const maxMinutes = Number(profile && profile.session_duration_minutes) || 45;
        const unknownFtp = !(profile && Number(profile.ftp_watts) > 0 && profile.ftp_confidence !== 'unknown');
        const repeatedDifficulty = stats.difficult_count >= 2;
        const trainedRecently = stats.session_count_7d >= Math.max(2, Number(profile && profile.sessions_per_week) || 3);
        const intensityPreference = profile && profile.intensity_preference || 'balanced';
        const goalCategories = {
            restart: ['Découverte', 'Endurance', 'Récupération'], endurance: ['Endurance', 'Tempo / Sweet Spot'],
            general_progress: ['Endurance', 'Tempo / Sweet Spot', 'Récupération'], ftp: ['Tempo / Sweet Spot', 'Seuil', 'Endurance'],
            performance: ['Seuil', 'VO2max', 'Tempo / Sweet Spot']
        }[goal] || ['Endurance', 'Tempo / Sweet Spot'];

        const scored = lib.filter(w => {
            const minutes = w.duration_seconds / 60;
            return minutes <= maxMinutes + 15 && (!unknownFtp || !w.requires_ftp || w.is_ftp_test);
        }).map(w => {
            let score = goalCategories.includes(w.category) ? 40 : 5;
            const minutes = w.duration_seconds / 60;
            score -= Math.abs(minutes - maxMinutes) * 0.5;
            if (stats.session_count_28d < 3 && w.difficulty <= 2) score += 30;
            if (repeatedDifficulty && w.category === 'Récupération') score += 60;
            if (trainedRecently && w.category === 'Récupération') score += 35;
            if (stats.easy_count >= 2 && w.difficulty === 3) score += 20;
            if (intensityPreference === 'gentle') score += w.difficulty <= 2 ? 16 : -w.difficulty * 4;
            if (intensityPreference === 'intense' && !repeatedDifficulty) score += w.difficulty >= 4 ? 12 : 0;
            if (unknownFtp && w.is_ftp_test) score += 20;
            if (unknownFtp && w.id === 'easy20') score += 25;
            const sameRecent = stats.recent.filter(s => s.workout_id === w.id).length;
            score -= sameRecent * 18;
            let reason = `Adapté à votre objectif « ${goalLabel(goal)} » et à une disponibilité d’environ ${maxMinutes} min.`;
            if (repeatedDifficulty && w.category === 'Récupération') reason = 'Vos retours récents signalent plusieurs séances difficiles : une charge légère est plus prudente.';
            else if (unknownFtp && w.is_ftp_test) reason = 'Votre FTP est inconnue : ce protocole guidé peut fournir un premier repère, avec ses limites.';
            else if (stats.session_count_28d < 3) reason = 'Votre historique récent est encore limité : cette séance favorise une progression prudente.';
            return { workout: w, score, reason };
        }).sort((a, b) => b.score - a.score || a.workout.duration_seconds - b.workout.duration_seconds);
        const selected = [];
        for (const item of scored) {
            if (selected.some(other => other.workout.category === item.workout.category) && scored.length > limit) continue;
            selected.push(item);
            if (selected.length === limit) break;
        }
        for (const item of scored) if (selected.length < limit && !selected.includes(item)) selected.push(item);
        return { recommendations: selected.slice(0, limit), indicators: stats, generated_at: new Date(now).toISOString() };
    }

    function goalLabel(goal) {
        return ({ restart: 'reprise ou remise en forme', endurance: 'amélioration de l’endurance', general_progress: 'progression générale', ftp: 'amélioration de la FTP', performance: 'performance' })[goal] || 'progression générale';
    }
    root.CycloTrainingRecommendations = Object.freeze({ recommend, summarize, goalLabel });
})(typeof window !== 'undefined' ? window : globalThis);
