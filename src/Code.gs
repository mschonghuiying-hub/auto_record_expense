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
  try {
    var update = JSON.parse(e.postData.contents);
    var msg = update.message || update.edited_message;
    if (!msg) return ok_();

    chatId = msg.chat && msg.chat.id;
    var allowed = props_().getProperty('ALLOWED_CHAT_ID');
    if (!allowed || String(chatId) !== String(allowed)) {
      return ok_();
    }

    if (isDuplicateUpdate_(update.update_id)) {
      console.log('Skipping duplicate update_id=' + update.update_id);
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
      var commentary = '';
      var commentaryEnabled =
        String(props_().getProperty('ENABLE_COMMENTARY') || '').toLowerCase() !== 'false';
      if (commentaryEnabled) {
        try {
          commentary = callGeminiCommentary_(expense, summary);
        } catch (commentaryErr) {
          console.warn('Commentary failed: ' + (commentaryErr && commentaryErr.stack || commentaryErr));
        }
      }
      var reply = escapeHtml_(confirmation) + '\n\n' + formatSummaryTable_(summary);
      if (commentary) reply += '\n\n💬 ' + escapeHtml_(commentary);
      sendMessage_(chatId, reply, 'HTML');
    } else {
      sendMessage_(chatId, confirmation);
    }
  } catch (err) {
    var detail = (err && (err.stack || err.message)) || String(err);
    console.error(detail);
    if (chatId) {
      sendMessage_(chatId, 'Could not record:\n' + detail.substring(0, 3500));
    }
  }
  return ok_();
}

// TTL set to CacheService max (6 hours) so Telegram webhook retries of the
// same update_id are deduped even when delivery is delayed by backoff.
function isDuplicateUpdate_(updateId) {
  if (updateId == null) return false;
  var cache = CacheService.getScriptCache();
  var key = 'tg_upd_' + updateId;
  if (cache.get(key)) return true;
  cache.put(key, '1', 21600);
  return false;
}

function doGet() {
  return ContentService.createTextOutput('expense bot up');
}

function formatConfirmation_(x) {
  return '✅ ' + x.date + ' · ' + x.category + ' · ' +
         x.amount + ' ' + x.currency + '\n' + x.description;
}

/**
 * Builds a monospace budget-vs-actual table wrapped in <pre>...</pre>.
 * Telegram renders <pre> in a fixed-width font on every client, so columns
 * stay aligned on mobile.
 *
 * summary shape: { month, rows: [{category, budget, actual, variance}], total }
 */
function formatSummaryTable_(summary) {
  var CAT_MAX = 14;
  var rows = summary.rows.map(function (r) {
    return {
      category: truncate_(r.category, CAT_MAX),
      budget: String(r.budget),
      actual: String(r.actual),
      variance: String(r.variance)
    };
  });
  var total = {
    category: 'Total',
    budget: String(summary.total.budget),
    actual: String(summary.total.actual),
    variance: String(summary.total.variance)
  };

  var all = rows.concat([total]);
  var catW = Math.max.apply(null, all.map(function (r) { return r.category.length; }));
  var budW = Math.max(3, Math.max.apply(null, all.map(function (r) { return r.budget.length; })));
  var actW = Math.max(3, Math.max.apply(null, all.map(function (r) { return r.actual.length; })));
  var varW = Math.max(3, Math.max.apply(null, all.map(function (r) { return r.variance.length; })));

  function line(r) {
    return padRight_(r.category, catW) + '  ' +
           padLeft_(r.budget, budW)   + '  ' +
           padLeft_(r.actual, actW)   + '  ' +
           padLeft_(r.variance, varW);
  }

  var header = padRight_('Category', catW) + '  ' +
               padLeft_('Bud', budW) + '  ' +
               padLeft_('Act', actW) + '  ' +
               padLeft_('Var', varW);
  var sep = repeat_('-', catW + budW + actW + varW + 6);

  var body = [header].concat(rows.map(line)).concat([sep, line(total)]).join('\n');
  return '📊 ' + summary.month + '\n<pre>' + body + '</pre>';
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
