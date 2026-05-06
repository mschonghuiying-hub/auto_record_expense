/**
 * One-off utilities you run manually from the Apps Script editor during setup.
 * None of these are called by the polling trigger.
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
 * Switch the bot to long-polling mode. After running this, add a time-driven
 * trigger for `pollUpdates` (clock icon → Add Trigger → every 1 minute).
 */
function enablePolling() {
  unregisterWebhook();
  props_().deleteProperty('TG_OFFSET');
  console.log('Webhook removed. Now add a 1-minute time-driven trigger ' +
              'for pollUpdates (Apps Script editor → clock icon → Add Trigger).');
}

function disablePolling() {
  registerWebhook();
  console.log('Webhook re-registered. Remember to delete the pollUpdates ' +
              'time-driven trigger so the bot doesn\'t double-process updates.');
}

/**
 * Sanity-check the Mifflin-St Jeor + activity + goal math without touching
 * Telegram. Profile must be populated in row 2 of the profile tab.
 */
function testComputeTarget() {
  var profile = readProfile_();
  console.log('Profile: ' + JSON.stringify(profile));
  console.log('Daily target: ' + computeDailyTarget_(profile) + ' kcal');
}

/**
 * Parse a sample text input and append it. Confirms Gemini + sheet wiring
 * end to end before turning on Telegram polling.
 */
function testParseText() {
  var meal = callGemini_({ text: 'two slices of avocado toast with poached egg' });
  console.log(meal);
  appendMeal_(meal);
}

/**
 * Read today's progress and log it. Useful after seeding a few rows manually
 * to confirm the table math is right.
 */
function testProgress() {
  var p = readDailyProgress_();
  console.log(JSON.stringify(p, null, 2));
}
