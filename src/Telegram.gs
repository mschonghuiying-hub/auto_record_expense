/**
 * Telegram Bot API helpers.
 * Bot token is read from Script Properties.
 */

function sendMessage_(chatId, text) {
  var token = props_().getProperty('TELEGRAM_BOT_TOKEN');
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true
  });
}

function downloadTelegramFile_(fileId) {
  var token = props_().getProperty('TELEGRAM_BOT_TOKEN');
  var infoRes = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/getFile?file_id=' +
      encodeURIComponent(fileId),
    { muteHttpExceptions: true }
  );
  var info = JSON.parse(infoRes.getContentText());
  if (!info.ok) throw new Error('getFile failed: ' + infoRes.getContentText());
  var filePath = info.result.file_path;
  var fileRes = UrlFetchApp.fetch(
    'https://api.telegram.org/file/bot' + token + '/' + filePath,
    { muteHttpExceptions: true }
  );
  return fileRes.getBlob();
}
