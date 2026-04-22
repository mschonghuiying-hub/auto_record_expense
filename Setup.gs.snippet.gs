/**
 * APPEND this function to the end of your existing Setup.gs
 * (do NOT replace the whole file — registerWebhook and getWebhookInfo stay).
 *
 * Drops any Telegram updates queued in the retry buffer. Run this once from
 * the editor to clear stuck updates (e.g. after a 429 or 302 error flurry).
 *
 *   Function dropdown -> dropPendingUpdates -> Run
 *   Expected log: {"ok":true,"result":true,"description":"Webhook was set"}
 */
function dropPendingUpdates() {
  var token = props_().getProperty('TELEGRAM_BOT_TOKEN');
  var url   = props_().getProperty('WEBHOOK_URL');
  var res = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/setWebhook' +
    '?url=' + encodeURIComponent(url) +
    '&drop_pending_updates=true'
  );
  console.log(res.getContentText());
}
