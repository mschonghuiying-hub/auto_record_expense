/**
 * One-off utilities you run manually from the Apps Script editor during setup.
 * None of these are called by the webhook.
 */

/**
 * Register this Web App deployment as the Telegram webhook.
 * Before running: Deploy > New deployment > Web app, copy the /exec URL,
 * and paste it into WEBHOOK_URL in Script Properties.
 */
function registerWebhook() {
  var token = props_().getProperty('TELEGRAM_BOT_TOKEN');
  var url = props_().getProperty('WEBHOOK_URL');
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN in Script Properties');
  if (!url)   throw new Error('Set WEBHOOK_URL in Script Properties (the /exec URL of your deployment)');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      url: url,
      drop_pending_updates: true,
      allowed_updates: ['message']
    }),
    muteHttpExceptions: true
  });
  console.log(res.getContentText());
}

function unregisterWebhook() {
  var token = props_().getProperty('TELEGRAM_BOT_TOKEN');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook', {
    method: 'post', muteHttpExceptions: true
  });
  console.log(res.getContentText());
}

function getWebhookInfo() {
  var token = props_().getProperty('TELEGRAM_BOT_TOKEN');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo', {
    muteHttpExceptions: true
  });
  console.log(res.getContentText());
}

/**
 * Flush updates queued in Telegram's retry buffer without touching the
 * webhook URL. Useful after an error flurry (e.g. Gemini 429, 302 access
 * issue) has piled up pending updates that would otherwise re-fire and
 * create duplicate rows once the webhook recovers.
 */
function dropPendingUpdates() {
  var token = props_().getProperty('TELEGRAM_BOT_TOKEN');
  var url   = props_().getProperty('WEBHOOK_URL');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      url: url,
      drop_pending_updates: true,
      allowed_updates: ['message']
    }),
    muteHttpExceptions: true
  });
  console.log(res.getContentText());
}



/**
 * Optional convenience: fill in your secrets here, run once, then DELETE
 * the values from this file. Prefer using the Script Properties UI.
 */
function setSecrets() {
  var values = {
    TELEGRAM_BOT_TOKEN: '',
    GEMINI_API_KEY:     '',
    ALLOWED_CHAT_ID:    '',
    SHEET_NAME:         '',
    WEBHOOK_URL:        ''
  };
  Object.keys(values).forEach(function (k) {
    if (values[k]) props_().setProperty(k, values[k]);
  });
  console.log('Script Properties now set:', Object.keys(props_().getProperties()));
}

/**
 * Parse a hardcoded text message and append the row. Useful before wiring up
 * Telegram — confirms Gemini + Sheet work end to end.
 */
function testParseText() {
  var expense = callGemini_({ text: 'lunch uni 16.68' });
  console.log(expense);
  appendExpense_(expense);
}

/**
 * Install a time-driven trigger that runs dropPendingUpdates every 30 min.
 * Use this to auto-flush the residual pending_update_count that Telegram
 * accumulates when a photo webhook takes longer than its 5-10s timeout.
 * Run once from the editor; idempotent (removes prior copy first).
 */
function installFlushTrigger() {
  uninstallFlushTrigger();
  ScriptApp.newTrigger('dropPendingUpdates')
    .timeBased()
    .everyMinutes(30)
    .create();
  console.log('Installed: dropPendingUpdates every 30 minutes');
}

function uninstallFlushTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dropPendingUpdates') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  console.log('Removed ' + removed + ' trigger(s)');
}

