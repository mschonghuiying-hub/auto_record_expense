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

/**
 * Reads the "insights" tab and returns this month's budget-vs-actual summary.
 *
 * Expected insights layout (per row, starting at row 2):
 *   A: Month (yyyy-MM)  B: Category  C: Spent  D: budget  E: remaining
 *
 * The "current month" is resolved in the spreadsheet's timezone so it
 * matches what the user sees in the sheet's TEXT(..., "yyyy-mm") formulas.
 *
 * Returns { month, rows: [{category, budget, actual, variance}], total: {...} }
 * or null if the sheet is missing or has no rows for this month.
 */
function readInsightsSummary_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = props_().getProperty('INSIGHTS_SHEET_NAME') || 'insights';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    console.warn('Insights sheet not found: ' + name);
    return null;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var currentMonth = Utilities.formatDate(
    new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM'
  );

  var rows = [];
  var sumBudget = 0, sumActual = 0, sumVariance = 0;
  for (var i = 0; i < values.length; i++) {
    var month = String(values[i][0]).trim();
    var category = String(values[i][1]).trim();
    if (month !== currentMonth || !category) continue;

    var actual = Number(values[i][2]) || 0;
    var budget = Number(values[i][3]) || 0;
    var variance = Number(values[i][4]) || 0;
    sumBudget += budget;
    sumActual += actual;
    sumVariance += variance;

    rows.push({
      category: category,
      budget: Math.round(budget),
      actual: Math.round(actual),
      variance: Math.round(variance)
    });
  }

  if (!rows.length) return null;

  return {
    month: currentMonth,
    rows: rows,
    total: {
      budget: Math.round(sumBudget),
      actual: Math.round(sumActual),
      variance: Math.round(sumVariance)
    }
  };
}
