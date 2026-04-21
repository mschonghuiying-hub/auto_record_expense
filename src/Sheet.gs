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
  var sheetName = props_().getProperty('SHEET_NAME') || ss.getSheets()[0].getName();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  sheet.appendRow([x.date, x.category, x.amount, x.currency, x.description]);
  var row = sheet.getLastRow();
  sheet.getRange(row, 6).setFormula('=TEXT(A' + row + ',"yyyy-mm")');
}
