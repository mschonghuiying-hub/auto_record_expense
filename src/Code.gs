/**
 * Webhook entry point for the Telegram bot.
 * Telegram POSTs every update (message, photo, etc.) to the Web App /exec URL.
 *
 * Flow:
 *   text message  -> Gemini (text prompt)   -> expense JSON -> sheet + reply
 *   photo message -> Gemini (image + text)  -> expense JSON -> sheet + reply
 */
function doPost(e) {
  var chatId = null;
  var updateId = null;
  try {
    var update = JSON.parse(e.postData.contents);
    var msg = update.message || update.edited_message;
    if (!msg) return ok_();

    chatId = msg.chat && msg.chat.id;
    var allowed = props_().getProperty('ALLOWED_CHAT_ID');
    if (!allowed || String(chatId) !== String(allowed)) {
      return ok_();
    }

    updateId = update.update_id;
    if (wasUpdateProcessed_(updateId)) {
      console.log('Skipping duplicate update_id=' + updateId);
      return ok_();
    }

    if (msg.text && isSummaryCommand_(msg.text)) {
      handleSummaryCommand_(chatId);
      markUpdateProcessed_(updateId);
      return ok_();
    }

    var expense;
    if (msg.photo && msg.photo.length) {
      var largest = msg.photo[msg.photo.length - 1];
      var blob = downloadTelegramFile_(largest.file_id);
      expense = callGemini_({
        text: msg.caption || '',
        imageBytes: blob.getBytes(),
        mimeType: 'image/jpeg'
      });
    } else if (msg.text) {
      expense = callGemini_({ text: msg.text });
    } else {
      sendMessage_(chatId, 'Send text like "lunch 16.68" or a receipt photo.');
      markUpdateProcessed_(updateId);
      return ok_();
    }

    appendExpense_(expense);

    var confirmation = formatConfirmation_(expense);
    var summary = null;
    try {
      summary = readInsightsSummary_();
    } catch (summaryErr) {
      console.warn('Summary read failed: ' + (summaryErr && summaryErr.stack || summaryErr));
    }

    if (summary) {
      var reply = escapeHtml_(confirmation) + '\n\n' + formatSummaryTable_(summary);
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
        sendMessage_(chatId, 'Could not record:\n' + detail.substring(0, 3500));
      } catch (notifyErr) {
        console.error('Notify failed: ' + (notifyErr && notifyErr.stack || notifyErr));
      }
    }
  }
  return ok_();
}

// Two-phase dedup: a retry from Telegram is only ignored once the original
// run has fully replied. If the first run errors out before sendMessage_, the
// retry gets to do the work — we don't lose the user's expense.
// TTL is CacheService max (6 hours) which covers Telegram's retry window.
function wasUpdateProcessed_(updateId) {
  if (updateId == null) return false;
  return Boolean(CacheService.getScriptCache().get('tg_upd_' + updateId));
}

function markUpdateProcessed_(updateId) {
  if (updateId == null) return;
  CacheService.getScriptCache().put('tg_upd_' + updateId, '1', 21600);
}

function isSummaryCommand_(text) {
  var t = String(text || '').trim().toLowerCase();
  return t === '/summary' || t.indexOf('/summary@') === 0 || t.indexOf('/summary ') === 0;
}

function handleSummaryCommand_(chatId) {
  var summary = null;
  try {
    summary = readInsightsSummary_();
  } catch (summaryErr) {
    console.warn('Summary read failed: ' + (summaryErr && summaryErr.stack || summaryErr));
  }
  if (!summary) {
    sendMessage_(chatId, 'No data for the current month yet.');
    return;
  }
  var commentary = '';
  try {
    commentary = callGeminiCommentary_(null, summary);
  } catch (commentaryErr) {
    console.warn('Commentary failed: ' + (commentaryErr && commentaryErr.stack || commentaryErr));
  }
  var reply = formatSummaryTable_(summary);
  if (commentary) reply += '\n\n💬 ' + escapeHtml_(commentary);
  sendMessage_(chatId, reply, 'HTML');
}

function doGet() {
  return ContentService.createTextOutput('expense bot up');
}

function formatConfirmation_(x) {
  return '✅ ' + x.date + ' · ' + x.category + ' · ' +
         x.amount + ' ' + x.currency + '\n' + x.description;
}

/**
 * Builds a monospace progress-bar summary wrapped in <pre>...</pre>.
 * One row per category: name, a 10-segment █/░ bar, and "actual/budget".
 * The bar saturates at 100%; the actual/budget pair carries the magnitude.
 *
 * summary shape: { month, rows: [{category, budget, actual, variance}], total }
 */
function formatSummaryTable_(summary) {
  var CAT_MAX = 13;
  var BAR_LEN = 10;

  function row(r) {
    return {
      category: truncate_(r.category, CAT_MAX),
      bar: makeBar_(r.actual, r.budget, BAR_LEN),
      actual: String(r.actual),
      budget: String(r.budget)
    };
  }
  var rows = summary.rows.map(row);
  var total = row({
    category: 'Total',
    actual: summary.total.actual,
    budget: summary.total.budget
  });

  var all = rows.concat([total]);
  var catW = Math.max.apply(null, all.map(function (r) { return r.category.length; }));
  var actW = Math.max.apply(null, all.map(function (r) { return r.actual.length; }));
  var budW = Math.max.apply(null, all.map(function (r) { return r.budget.length; }));

  function line(r) {
    return padRight_(r.category, catW) + '  ' + r.bar + ' ' +
           padLeft_(r.actual, actW) + '/' + padLeft_(r.budget, budW);
  }
  var sep = repeat_('-', catW + 2 + BAR_LEN + 1 + actW + 1 + budW);
  var body = rows.map(line).concat([sep, line(total)]).join('\n');
  return '📊 ' + summary.month + '\n<pre>' + body + '</pre>';
}

function makeBar_(actual, budget, len) {
  if (!budget || budget <= 0) return repeat_('░', len);
  var ratio = actual / budget;
  var filled = Math.min(len, Math.max(0, Math.round(ratio * len)));
  return repeat_('█', filled) + repeat_('░', len - filled);
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate_(s, n) {
  return s.length <= n ? s : s.substring(0, n - 1) + '…';
}

function padLeft_(s, n) {
  while (s.length < n) s = ' ' + s;
  return s;
}

function padRight_(s, n) {
  while (s.length < n) s = s + ' ';
  return s;
}

function repeat_(ch, n) {
  var out = '';
  for (var i = 0; i < n; i++) out += ch;
  return out;
}

function ok_() {
  return ContentService.createTextOutput('ok');
}

function props_() {
  return PropertiesService.getScriptProperties();
}
