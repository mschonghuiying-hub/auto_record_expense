/**
 * Sheet I/O.
 *
 * `meals` columns (the bot appends here):
 *   A date (YYYY-MM-DD)  B meal_type  C food  D calories  E description
 *
 * `profile` row 2 (you maintain by hand):
 *   A gender  B age  C height_cm  D weight_kg  E activity_level  F goal
 */

// Mifflin-St Jeor activity multipliers (clinical standard).
var ACTIVITY_MULT_ = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9
};

// Goal-based daily kcal delta on top of TDEE.
var GOAL_DELTA_ = { lose: -500, maintain: 0, gain: 300 };

function appendMeal_(m) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = props_().getProperty('MEALS_SHEET_NAME') || 'meals';
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  sheet.appendRow([m.date, m.meal_type, m.food, Math.round(m.calories), m.description]);
  SpreadsheetApp.flush();
}

function readProfile_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = props_().getProperty('PROFILE_SHEET_NAME') || 'profile';
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Profile sheet not found: ' + name);
  if (sheet.getLastRow() < 2) throw new Error('Profile sheet has no data row (row 2 expected)');
  var v = sheet.getRange(2, 1, 1, 6).getValues()[0];
  var profile = {
    gender: String(v[0]).trim().toLowerCase(),
    age: Number(v[1]),
    height_cm: Number(v[2]),
    weight_kg: Number(v[3]),
    activity_level: String(v[4]).trim().toLowerCase().replace(/\s+/g, '_'),
    goal: String(v[5]).trim().toLowerCase()
  };
  if (profile.gender !== 'male' && profile.gender !== 'female') {
    throw new Error('profile.gender must be male/female, got ' + JSON.stringify(profile.gender));
  }
  if (!isFinite(profile.age) || !isFinite(profile.height_cm) || !isFinite(profile.weight_kg)) {
    throw new Error('profile age/height/weight must be numbers');
  }
  if (!(profile.activity_level in ACTIVITY_MULT_)) {
    throw new Error('profile.activity_level must be one of ' +
                    Object.keys(ACTIVITY_MULT_).join(', ') +
                    ', got ' + JSON.stringify(profile.activity_level));
  }
  if (!(profile.goal in GOAL_DELTA_)) {
    throw new Error('profile.goal must be lose/maintain/gain, got ' + JSON.stringify(profile.goal));
  }
  return profile;
}

/**
 * Mifflin-St Jeor BMR + activity multiplier + goal delta.
 *   Male:   BMR = 10·kg + 6.25·cm − 5·age + 5
 *   Female: BMR = 10·kg + 6.25·cm − 5·age − 161
 */
function computeDailyTarget_(profile) {
  var bmr = 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age;
  bmr += profile.gender === 'male' ? 5 : -161;
  var tdee = bmr * ACTIVITY_MULT_[profile.activity_level];
  return Math.round(tdee + GOAL_DELTA_[profile.goal]);
}

/**
 * Returns { date, target, byMeal: {breakfast,lunch,dinner,snack}, total }
 * for today's meals. Falls back to a 2000 kcal target if profile is missing
 * or invalid so the bot still replies with a usable progress table.
 */
function readDailyProgress_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = props_().getProperty('MEALS_SHEET_NAME') || 'meals';
  var sheet = ss.getSheetByName(name);
  if (!sheet) return null;

  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var byMeal = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  var total = 0;
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (var i = 0; i < values.length; i++) {
      var raw = values[i][0];
      var date = raw instanceof Date
        ? Utilities.formatDate(raw, tz, 'yyyy-MM-dd')
        : String(raw).trim();
      if (date !== today) continue;
      var mealType = String(values[i][1]).trim().toLowerCase();
      var cals = Number(values[i][3]) || 0;
      if (mealType in byMeal) byMeal[mealType] += cals;
      total += cals;
    }
  }

  var target;
  try {
    target = computeDailyTarget_(readProfile_());
  } catch (e) {
    console.warn('Profile/target unavailable, defaulting to 2000: ' + (e && e.message || e));
    target = 2000;
  }

  return {
    date: today,
    target: target,
    byMeal: byMeal,
    total: Math.round(total)
  };
}
