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
        mimeType: blob.getContentType() || 'image/jpeg'
      });
    } else if (msg.text) {
      expense = callGemini_({ text: msg.text });
    } else {
      sendMessage_(chatId, 'Send text like "lunch 16.68" or a receipt photo.');
      return ok_();
    }

    appendExpense_(expense);
    sendMessage_(chatId, formatConfirmation_(expense));
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

function ok_() {
  return ContentService.createTextOutput('ok');
}

function props_() {
  return PropertiesService.getScriptProperties();
}
