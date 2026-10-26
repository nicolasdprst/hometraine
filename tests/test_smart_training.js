const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
function load(files, extras = {}) {
  const context = vm.createContext({ console, Date, Math, Number, Set, Map, Object, Array, JSON, ...extras });
  context.window = context;
  context.globalThis = context;
  files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  return context;
}
function session(id, p20, p5, daysAgo = 1, extra = {}) {
  return { id, profile_id: extra.profile_id || 'p1', started_at: new Date(Date.now() - daysAgo * 86400000).toISOString(), duration_seconds: 1800, active_duration_seconds: 1800, best_efforts: { 1200: p20, 300: p5 }, power_coverage_ratio: 0.98, ...extra };
}

const ctx = load(['js/training-library.js', 'js/ftp-estimator.js', 'js/training-recommendations.js']);
assert.strictEqual(ctx.CycloTrainingLibrary.list.length, 19, 'la bibliothèque contient 19 séances');
assert.strictEqual(ctx.CycloTrainingLibrary.get('endurance45').id, 'endurance45', 'identifiant historique conservé');
assert.strictEqual(ctx.CycloTrainingLibrary.get('intervals3030').duration_seconds, 1800, '30/30 conserve 30 minutes');
ctx.CycloTrainingLibrary.list.forEach(w => {
  assert(w.id && w.name && w.category && w.objective && w.description);
  assert.strictEqual(w.duration_seconds, w.steps.reduce((n, step) => n + step.duration, 0));
  w.steps.forEach(step => assert(step.target_pct > 0 && step.target_pct < 2));
});
const ftpTest = ctx.CycloTrainingLibrary.get('ftp-test-20');
assert(ftpTest.steps.every(step => step.rpe && step.effort_cue), 'le test FTP est guidé au ressenti à chaque étape');
assert.match(ftpTest.description, /aucune cible de watts/i);

const medium = ctx.CycloFtpEstimator.estimate([session('test', 230, 280, 1, { workout_id: 'ftp-test-20' })]);
assert.strictEqual(medium.ftp_watts, 219);
assert.strictEqual(medium.confidence, 'moyen');
const high = ctx.CycloFtpEstimator.estimate([session('a', 230, 280, 2), session('b', 234, 285, 10), session('c', 228, 275, 20)]);
assert.strictEqual(high.confidence, 'élevé');
assert(high.ftp_watts >= 217 && high.ftp_watts <= 223);
assert.strictEqual(ctx.CycloFtpEstimator.estimate([]).ftp_watts, null, 'historique vide sans valeur inventée');
assert.strictEqual(ctx.CycloFtpEstimator.estimate([session('easy', 100, 300)]).ftp_watts, null, 'effort facile rejeté');
assert.strictEqual(ctx.CycloFtpEstimator.estimate([session('gaps', 230, 280, 1, { power_coverage_ratio: 0.6 })]).ftp_watts, null, 'pertes de signal rejetées');
assert.strictEqual(ctx.CycloFtpEstimator.estimate([session('bad', 1500, 1600)]).ftp_watts, null, 'puissance aberrante rejetée');

const profile = { id: 'p1', ftp_watts: 220, ftp_confidence: 'moyen', training_goal: 'endurance', session_duration_minutes: 45, sessions_per_week: 3 };
const foreign = { id: 'foreign', profile_id: 'p2', started_at: new Date().toISOString(), duration_seconds: 3600, feedback_rating: 'too_difficult' };
const local = { id: 'local', profile_id: 'p1', started_at: new Date().toISOString(), duration_seconds: 2400, feedback_rating: 'easy' };
const rec = ctx.CycloTrainingRecommendations.recommend(profile, [foreign, local], ctx.CycloTrainingLibrary);
assert.strictEqual(rec.indicators.session_count_28d, 1, 'isolation stricte entre profils');
assert.strictEqual(rec.recommendations.length, 3);
const difficult = ctx.CycloTrainingRecommendations.recommend(profile, [
  { ...local, id: 'd1', feedback_rating: 'too_difficult' }, { ...local, id: 'd2', feedback_rating: 'difficult' }
], ctx.CycloTrainingLibrary);
assert(difficult.recommendations.some(item => item.workout.category === 'Récupération'), 'récupération après difficultés répétées');
const unknown = ctx.CycloTrainingRecommendations.recommend({ ...profile, ftp_watts: null, ftp_confidence: 'unknown' }, [], ctx.CycloTrainingLibrary);
assert(unknown.recommendations.every(item => !item.workout.requires_ftp || item.workout.is_ftp_test), 'fonctionne sans FTP et hors ligne');

let stored = [{ id: 's1', profile_id: 'p1' }, { id: 's2', profile_id: 'p2' }];
const feedbackCtx = load(['js/training-feedback.js'], {
  getStoredSessions: () => stored,
  saveStoredSessions: value => { stored = value; return true; },
  enqueueSync: () => {}
});
feedbackCtx.CycloTrainingFeedback.save('s1', 'p1', 'appropriate');
assert.strictEqual(stored[0].feedback_rating, 'appropriate');
assert.throws(() => feedbackCtx.CycloTrainingFeedback.save('s2', 'p1', 'easy'), /introuvable/, 'ressenti isolé par profil');

const geminiCtx = load(['js/training-library.js', 'js/gemini.js'], { navigator: { onLine: false } });
assert.deepStrictEqual(JSON.parse(JSON.stringify(geminiCtx.CycloGemini.validate({ explanation: 'Conseil', workout_ids: ['easy20'], tip: 'Souple.' }))), { explanation: 'Conseil', workout_ids: ['easy20'], tip: 'Souple.' });
assert.throws(() => geminiCtx.CycloGemini.validate({ explanation: 'x', workout_ids: ['invented'] }), /invalide/);
assert.match(geminiCtx.CycloGemini.availabilityError(), /Supabase/);
const offlineGeminiCtx = load(['js/training-library.js', 'js/gemini.js'], { navigator: { onLine: false }, supabaseClient: { isAuthenticated: () => true } });
assert.match(offlineGeminiCtx.CycloGemini.availabilityError(), /Internet/);

const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261026_006_intelligent_training.sql'), 'utf8');
assert(migration.includes('ALTER COLUMN ftp_watts DROP NOT NULL'));
assert(migration.includes('ENABLE ROW LEVEL SECURITY'));
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
['training-library.js', 'ftp-estimator.js', 'training-recommendations.js', 'training-feedback.js', 'gemini.js', 'training-ui.js'].forEach(name => assert(sw.includes(name), `${name} absent du cache`));
const edgeFunction = fs.readFileSync(path.join(root, 'supabase/functions/training-advice/index.ts'), 'utf8');
assert(edgeFunction.includes('thinkingBudget: 0'), 'Gemini 2.5 Flash doit réserver le budget à la réponse JSON');
const trainingUi = fs.readFileSync(path.join(root, 'js/training-ui.js'), 'utf8');
assert(trainingUi.includes('selectedWorkoutStatus'), 'la sélection doit rester visible');

console.log('✓ Smart training: 19 séances, FTP, recommandations, ressenti, Gemini et migration validés');
