(function (root) {
    'use strict';
    const RATINGS = Object.freeze(['very_easy', 'easy', 'appropriate', 'difficult', 'too_difficult']);
    function save(sessionId, profileId, rating) {
        if (!RATINGS.includes(rating)) throw new Error('Ressenti invalide');
        const sessions = root.getStoredSessions ? root.getStoredSessions() : root.localDataStore.getJSON('sessions', []);
        const session = sessions.find(item => item.id === sessionId && item.profile_id === profileId);
        if (!session) throw new Error('Séance introuvable pour ce profil');
        session.feedback_rating = rating;
        session.feedback_at = new Date().toISOString();
        session.sync_status = 'pending';
        if (!(root.saveStoredSessions ? root.saveStoredSessions(sessions) : root.localDataStore.setJSON('sessions', sessions))) throw new Error('Ressenti non enregistré');
        if (root.enqueueSync) root.enqueueSync(sessionId);
        return session;
    }
    root.CycloTrainingFeedback = Object.freeze({ RATINGS, save });
})(typeof window !== 'undefined' ? window : globalThis);
