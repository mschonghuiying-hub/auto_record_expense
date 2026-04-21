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
    if (chatId) {
      sendMessage_(chatId, 'Could not record: ' + err.message);
    }
    console.error(err);
  }
  return ok_();
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
