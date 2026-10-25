/**
 * Passerelle Gmail personnelle pour HomeTraine.
 * Le secret HOMETRAINE_SHARED_SECRET doit être enregistré dans les propriétés
 * du script, jamais écrit directement dans ce fichier.
 */

var MAX_REQUEST_CHARS = 7 * 1024 * 1024;
var MAX_TCX_BYTES = 5 * 1024 * 1024;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

// À exécuter une fois depuis l'éditeur pour afficher l'écran d'autorisation.
// Cette fonction ne transmet aucun e-mail.
function authorizeHomeTraine() {
  return MailApp.getRemainingDailyQuota();
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEquals_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var index = 0; index < length; index++) {
    mismatch |= (left.charCodeAt(index % Math.max(1, left.length)) || 0)
      ^ (right.charCodeAt(index % Math.max(1, right.length)) || 0);
  }
  return mismatch === 0;
}

function idempotencyProperty_(key) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    key,
    Utilities.Charset.UTF_8
  );
  return 'sent_' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function validatePayload_(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Requête invalide');
  if (!EMAIL_PATTERN.test(String(payload.recipient || '')) || String(payload.recipient).length > 254) {
    throw new Error('Destinataire invalide');
  }
  if (!payload.idempotency_key || String(payload.idempotency_key).length > 256) throw new Error('Clé idempotente invalide');
  if (!payload.subject || String(payload.subject).length > 180) throw new Error('Objet invalide');
  if (!payload.text || String(payload.text).length > 50000) throw new Error('Contenu texte invalide');
  if (!payload.html || String(payload.html).length > 100000) throw new Error('Contenu HTML invalide');
  if (!/^[A-Za-z0-9_.-]+\.tcx$/i.test(String(payload.filename || ''))) throw new Error('Nom de fichier invalide');
  if (!payload.tcx_base64 || String(payload.tcx_base64).length > MAX_REQUEST_CHARS) throw new Error('Pièce jointe invalide');
}

function publicError_(error) {
  var allowed = [
    'Requête invalide', 'Accès refusé', 'Destinataire invalide',
    'Clé idempotente invalide', 'Objet invalide', 'Contenu texte invalide',
    'Contenu HTML invalide', 'Nom de fichier invalide', 'Pièce jointe invalide',
    'TCX Base64 invalide', 'Taille TCX invalide', 'Contenu TCX invalide',
    'Quota Gmail quotidien atteint', 'Échec de l’envoi Gmail'
  ];
  var message = error && error.message ? String(error.message) : '';
  return allowed.indexOf(message) >= 0 ? message : 'Erreur d’envoi';
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw || raw.length > MAX_REQUEST_CHARS) return jsonResponse_({ ok: false, error: 'Requête invalide' });
    var payload = JSON.parse(raw);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('HOMETRAINE_SHARED_SECRET');
    if (!expectedSecret || !constantTimeEquals_(payload.secret, expectedSecret)) {
      return jsonResponse_({ ok: false, error: 'Accès refusé' });
    }
    validatePayload_(payload);

    var bytes;
    try {
      bytes = Utilities.base64Decode(payload.tcx_base64);
    } catch (decodeError) {
      throw new Error('TCX Base64 invalide');
    }
    if (!bytes.length || bytes.length > MAX_TCX_BYTES) throw new Error('Taille TCX invalide');
    var tcxText = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    if (tcxText.indexOf('<?xml') !== 0 || tcxText.indexOf('<TrainingCenterDatabase') === -1) {
      throw new Error('Contenu TCX invalide');
    }
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Quota Gmail quotidien atteint');

    var propertyName = idempotencyProperty_(String(payload.idempotency_key));
    var properties = PropertiesService.getScriptProperties();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var previousRequestId = properties.getProperty(propertyName);
      if (previousRequestId) return jsonResponse_({ ok: true, duplicate: true, request_id: previousRequestId.replace(/^(sending|sent):/, '') });
      var requestId = Utilities.getUuid();
      var attachment = Utilities.newBlob(bytes, 'application/vnd.garmin.tcx+xml', String(payload.filename));
      // Réserver la clé avant l'appel Gmail évite un doublon si l'exécution est
      // interrompue juste après que Gmail a accepté le message.
      properties.setProperty(propertyName, 'sending:' + requestId);
      try {
        MailApp.sendEmail({
          to: String(payload.recipient).trim(),
          subject: String(payload.subject),
          body: String(payload.text),
          htmlBody: String(payload.html),
          attachments: [attachment],
          name: 'HomeTraine'
        });
        properties.setProperty(propertyName, 'sent:' + requestId);
      } catch (mailError) {
        properties.deleteProperty(propertyName);
        throw new Error('Échec de l’envoi Gmail');
      }
      return jsonResponse_({ ok: true, duplicate: false, request_id: requestId });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error('HomeTraine mail error');
    return jsonResponse_({ ok: false, error: publicError_(error) });
  }
}
