/**
 * Webhook entry point for the calorie tracker Telegram bot.
 *
 * Runs in long-polling mode (see Poller.gs); doPost is kept as a fallback in
 * case the user re-registers a webhook.
 *
 * Flow (shared with the poller via processUpdate_):
 *   photo (optional caption) -> Gemini (image + text) -> meal JSON -> sheet + reply
 *   text message             -> Gemini (text prompt)   -> meal JSON -> sheet + reply
 */
function doPost(e) {
  try {
    var update = JSON.parse(e.postData.contents);
    processUpdate_(update);
  } catch (err) {
    console.error((err && (err.stack || err.message)) || String(err));
  }
  return ok_();
}

function processUpdate_(update) {
  var chatId = null;
  var updateId = null;
  try {
    var msg = update && (update.message || update.edited_message);
    if (!msg) return;

    chatId = msg.chat && msg.chat.id;
    if (!isAllowedChat_(chatId)) return;

    updateId = update.update_id;
    if (wasUpdateProcessed_(updateId)) {
      console.log('Skipping duplicate update_id=' + updateId);
      return;
    }

    if (msg.text && isSummaryCommand_(msg.text)) {
      handleSummaryCommand_(chatId);
      markUpdateProcessed_(updateId);
      return;
    }

    var meal;
    if (msg.photo && msg.photo.length) {
      var largest = msg.photo[msg.photo.length - 1];
      var blob = downloadTelegramFile_(largest.file_id);
      meal = callGemini_({
        text: msg.caption || '',
        imageBytes: blob.getBytes(),
        mimeType: 'image/jpeg'
      });
    } else if (msg.text) {
      meal = callGemini_({ text: msg.text });
    } else {
      sendMessage_(chatId, 'Send a meal photo (caption optional) or text like "tuna sandwich 350".');
      markUpdateProcessed_(updateId);
      return;
    }

    appendMeal_(meal);

    var confirmation = formatConfirmation_(meal);
    var progress = null;
    try {
      progress = readDailyProgress_();
    } catch (progErr) {
      console.warn('Progress read failed: ' + (progErr && progErr.stack || progErr));
    }

    if (progress) {
      var reply = escapeHtml_(confirmation) + '\n\n' + formatProgressTable_(progress);
      sendMessage_(chatId, reply, 'HTML');
    } else {
      sendMessage_(chatId, confirmation);
    }
    markUpdateProcessed_(updateId);
  } catch (err) {
    var detail = (err && (err.stack || err.message)) || String(err);
    console.error(detail);
    if (chatId) {
      try {
        sendMessage_(chatId, 'Could not log:\n' + detail.substring(0, 3500));
      } catch (notifyErr) {
        console.error('Notify failed: ' + (notifyErr && notifyErr.stack || notifyErr));
      }
    }
  }
}

function wasUpdateProcessed_(updateId) {
  if (updateId == null) return false;
  return Boolean(CacheService.getScriptCache().get('tg_upd_' + updateId));
}

function markUpdateProcessed_(updateId) {
  if (updateId == null) return;
  CacheService.getScriptCache().put('tg_upd_' + updateId, '1', 21600);
}

// ALLOWED_CHAT_ID accepts a single ID or comma/space-separated list, so
// multiple Telegram accounts can share one bot + sheet.
function isAllowedChat_(chatId) {
  if (chatId == null) return false;
  var raw = props_().getProperty('ALLOWED_CHAT_ID');
  if (!raw) return false;
  var target = String(chatId);
  var parts = String(raw).split(/[\s,]+/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] && parts[i] === target) return true;
  }
  return false;
}

function isSummaryCommand_(text) {
  var t = String(text || '').trim().toLowerCase();
  return t === '/summary' || t.indexOf('/summary@') === 0 || t.indexOf('/summary ') === 0;
}

function handleSummaryCommand_(chatId) {
  var progress = null;
  try {
    progress = readDailyProgress_();
  } catch (e) {
    console.warn('Progress read failed: ' + (e && e.stack || e));
  }
  if (!progress) {
    sendMessage_(chatId, 'No meals logged today yet.');
    return;
  }
  var commentary = '';
  try {
    commentary = callGeminiCommentary_(progress);
  } catch (e) {
    console.warn('Commentary failed: ' + (e && e.stack || e));
  }
  var reply = formatProgressTable_(progress);
  if (commentary) reply += '\n\n💬 ' + escapeHtml_(commentary);
  sendMessage_(chatId, reply, 'HTML');
}

function doGet() {
  return ContentService.createTextOutput('calorie bot up');
}

function formatConfirmation_(m) {
  return '🍽 ' + m.date + ' · ' + m.meal_type + ' · ' +
         Math.round(m.calories) + ' kcal\n' + m.food +
         (m.description ? ' (' + m.description + ')' : '') +
         '\n(estimate — edit row if off)';
}

/**
 * Per-meal bars are scaled to that meal's typical share of the day, so each
 * bar fills meaningfully on its own. The Total bar is scaled to the full
 * daily target.
 *
 * progress: { date, target, byMeal: {breakfast,lunch,dinner,snack}, total }
 */
function formatProgressTable_(progress) {
  var BAR_LEN = 10;
  var MEAL_SHARES = { breakfast: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 };
  var ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

  function row(label, actual, slice) {
    var slot = Math.max(1, Math.round(progress.target * slice));
    return {
      label: label,
      bar: makeBar_(actual, slot, BAR_LEN),
      actual: String(Math.round(actual))
    };
  }

  var rows = ORDER.map(function (k) {
    return row(k, progress.byMeal[k] || 0, MEAL_SHARES[k]);
  });
  var total = {
    label: 'Total',
    bar: makeBar_(progress.total, progress.target, BAR_LEN),
    actual: String(Math.round(progress.total)) + '/' + String(Math.round(progress.target))
  };
  var remaining = Math.round(progress.target - progress.total);
  var remainingStr = remaining >= 0 ? '(' + remaining + ' left)'
                                    : '(' + (-remaining) + ' over)';

  var all = rows.concat([total]);
  var labW = Math.max.apply(null, all.map(function (r) { return r.label.length; }));
  var actW = Math.max.apply(null, all.map(function (r) { return r.actual.length; }));

  function line(r) {
    return padRight_(r.label, labW) + '  ' + r.bar + ' ' + padLeft_(r.actual, actW);
  }
  var sep = repeat_('-', labW + 2 + BAR_LEN + 1 + actW);
  var body = rows.map(line).concat([sep, line(total) + '  ' + remainingStr]).join('\n');
  return '📊 ' + progress.date + '\n<pre>' + body + '</pre>';
}

function makeBar_(actual, budget, len) {
  if (!budget || budget <= 0) return repeat_('░', len);
  var ratio = actual / budget;
  var filled = Math.min(len, Math.max(0, Math.round(ratio * len)));
  return repeat_('█', filled) + repeat_('░', len - filled);
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function padLeft_(s, n) { while (s.length < n) s = ' ' + s; return s; }
function padRight_(s, n) { while (s.length < n) s = s + ' '; return s; }
function repeat_(ch, n) { var o = ''; for (var i = 0; i < n; i++) o += ch; return o; }

function ok_() { return ContentService.createTextOutput('ok'); }
function props_() { return PropertiesService.getScriptProperties(); }
