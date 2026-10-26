// Estimation FTP prudente et déterministe. N'écrit jamais dans le profil.
(function (root) {
    'use strict';
    const DAY = 86400000;
    const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

    function candidateFromSession(session) {
        const efforts = session && (session.best_efforts || (session.analytics && session.analytics.bestEfforts));
        const p20 = finite(efforts && (efforts[1200] || efforts['1200'] || (efforts['20min'] && efforts['20min'].watts) || efforts['20min']));
        const p5 = finite(efforts && (efforts[300] || efforts['300'] || (efforts['5min'] && efforts['5min'].watts) || efforts['5min']));
        const duration = finite(session && (session.active_duration_seconds || session.duration_seconds)) || 0;
        const coverage = finite(session && session.power_coverage_ratio);
        if (!p20 || p20 < 50 || p20 > 700 || duration < 1200) return null;
        if (coverage !== null && coverage < 0.85) return null;
        if (p5 && (p20 > p5 * 1.02 || p20 < p5 * 0.55)) return null;
        const explicitTest = session.workout_id === 'ftp-test-20' || session.is_ftp_test === true;
        const intensityEvidence = explicitTest || (p5 && p20 >= p5 * 0.72) || session.twenty_minute_effort_confirmed === true;
        if (!intensityEvidence) return null;
        return {
            session_id: session.id || null,
            date: session.started_at || session.date || null,
            twenty_minute_watts: Math.round(p20),
            five_minute_watts: p5 ? Math.round(p5) : null,
            coverage_ratio: coverage,
            explicit_test: explicitTest,
            estimated_ftp: Math.round(p20 * 0.95)
        };
    }

    function estimate(sessions, options = {}) {
        const now = options.now ? new Date(options.now).getTime() : Date.now();
        const candidates = (Array.isArray(sessions) ? sessions : []).map(candidateFromSession).filter(Boolean)
            .filter(item => !item.date || now - new Date(item.date).getTime() <= 180 * DAY)
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        if (!candidates.length) return {
            ftp_watts: null, confidence: 'faible', estimated_at: new Date(now).toISOString(), contributors: [],
            explanation: 'Aucun effort de 20 minutes suffisamment continu et intense n’a été identifié. Conservez une FTP inconnue, saisissez une valeur manuelle ou effectuez le test guidé.'
        };
        const recent = candidates.slice(0, 4);
        const values = recent.map(item => item.estimated_ftp).sort((a, b) => a - b);
        const median = values.length % 2 ? values[(values.length - 1) / 2] : Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2);
        const consistent = recent.filter(item => Math.abs(item.estimated_ftp - median) / median <= 0.08);
        const hasTest = recent.some(item => item.explicit_test);
        let confidence = 'moyen';
        if (consistent.length >= 2 && (hasTest || consistent.length >= 3)) confidence = 'élevé';
        else if (!hasTest && recent.length === 1 && recent[0].coverage_ratio === null) confidence = 'faible';
        const ftp = confidence === 'faible' && !hasTest ? null : Math.round(consistent.reduce((sum, item) => sum + item.estimated_ftp, 0) / Math.max(1, consistent.length));
        return {
            ftp_watts: ftp, confidence, source: hasTest ? 'test' : 'estimated', estimated_at: new Date(now).toISOString(), contributors: recent,
            explanation: ftp
                ? `${recent.length} effort(s) exploitable(s) ont été comparés. La recommandation de ${ftp} W correspond à 95 % de la meilleure puissance moyenne de 20 minutes, avec contrôle de continuité et de cohérence.`
                : 'Un effort potentiellement utile a été trouvé, mais sa continuité ou sa confirmation est insuffisante pour proposer une valeur précise.'
        };
    }

    function shouldReevaluate(profile, sessions, now = Date.now()) {
        const last = Date.parse(profile && profile.ftp_last_evaluated_at || 0) || 0;
        if (!last || now - last >= 28 * DAY) return true;
        return (sessions || []).some(session => new Date(session.started_at || 0).getTime() > last && candidateFromSession(session));
    }

    root.CycloFtpEstimator = Object.freeze({ estimate, candidateFromSession, shouldReevaluate });
})(typeof window !== 'undefined' ? window : globalThis);
