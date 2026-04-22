/**
 * Appends one expense row to the target sheet.
 *
 * Column layout (matches the existing "expense record" sheet):
 *   A date (YYYY-MM-DD)  B category  C amount  D currency  E description  F yyyy-mm
 *
 * Column F is a formula so it always reflects column A.
 */
function appendExpense_(x) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log('Spreadsheet: ' + ss.getName() + ' (id=' + ss.getId() + ')');
  console.log('All tabs: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(' | '));

  var configured = props_().getProperty('SHEET_NAME');
  var sheetName = configured || ss.getSheets()[0].getName();
  console.log('SHEET_NAME property: ' + JSON.stringify(configured) + ' -> using tab: ' + JSON.stringify(sheetName));

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  var before = sheet.getLastRow();
  sheet.appendRow([x.date, x.category, x.amount, x.currency, x.description]);
  SpreadsheetApp.flush();
  var after = sheet.getLastRow();
  sheet.getRange(after, 6).setFormula('=TEXT(A' + after + ',"yyyy-mm")');
  console.log('Appended to ' + sheetName + ': row ' + before + ' -> ' + after);
}
