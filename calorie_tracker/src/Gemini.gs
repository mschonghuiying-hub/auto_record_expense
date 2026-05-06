/**
 * Gemini client. Given text and/or a meal photo, returns a structured meal:
 *   { date, meal_type, food, calories, description }
 *
 * Calorie estimates from photos are inherently noisy (~±20-40% on unfamiliar
 * dishes). The prompt pushes Gemini to surface its assumptions in
 * `description` so the user can spot-check, and the reply tells them to edit
 * the sheet row when off.
 */

var GEMINI_MODEL_ = 'gemini-2.5-flash';

var MEAL_TYPES_ = ['breakfast', 'lunch', 'dinner', 'snack'];

function callGemini_(input) {
  var apiKey = props_().getProperty('GEMINI_API_KEY');
  var tz = Session.getScriptTimeZone() || 'Australia/Melbourne';
  var now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(now, tz, 'H'));

  var parts = [{ text: buildPrompt_(input.text || '', today, hour) }];
  if (input.imageBytes) {
    parts.push({
      inline_data: {
        mime_type: input.mimeType || 'image/jpeg',
        data: Utilities.base64Encode(input.imageBytes)
      }
    });
  }

  var body = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          date:        { type: 'STRING' },
          meal_type:   { type: 'STRING', enum: MEAL_TYPES_ },
          food:        { type: 'STRING' },
          calories:    { type: 'NUMBER' },
          description: { type: 'STRING' }
        },
        required: ['date', 'meal_type', 'food', 'calories', 'description']
      },
      temperature: 0
    }
  };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            GEMINI_MODEL_ + ':generateContent?key=' + encodeURIComponent(apiKey);
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Gemini ' + code + ': ' + text);

  var data = JSON.parse(text);
  var candidate = data.candidates && data.candidates[0];
  var jsonText = candidate && candidate.content && candidate.content.parts &&
                 candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!jsonText) throw new Error('Gemini returned no content: ' + text);

  var meal = JSON.parse(jsonText);
  validateMeal_(meal);
  return meal;
}

function buildPrompt_(userText, todayIso, hour) {
  var hint = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
  return [
    'You extract a single meal record from the user input and/or the attached',
    'food photo, and return strict JSON. Calorie counts from photos are',
    'estimates — be honest about your assumptions in the description.',
    '',
    'Rules:',
    '- date: YYYY-MM-DD. Use today: ' + todayIso + ' unless the user says otherwise.',
    '- meal_type: must be exactly one of: ' + MEAL_TYPES_.join(', ') + '.',
    '  If the caption does not say, infer from the local hour (current: ' + hour +
      'h) — likely "' + hint + '" right now.',
    '- food: short name (1-6 words), e.g. "Chicken katsu curry".',
    '- calories: integer kcal. Estimate the *total* meal as shown.',
    '  If you assume a serving size, say so in description.',
    '- description: 1 short sentence with the assumption you made about',
    '  portion size, ingredients, or preparation, e.g.',
    '  "1 medium plate (~400g), with rice and tonkatsu sauce".',
    '  Honor the caption as ground truth (e.g. "half portion", "no rice").',
    '',
    'User caption: ' + JSON.stringify(userText || '(none)')
  ].join('\n');
}

function validateMeal_(m) {
  if (!m || typeof m !== 'object') throw new Error('Meal not an object');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) throw new Error('Bad date: ' + m.date);
  if (MEAL_TYPES_.indexOf(m.meal_type) === -1) throw new Error('Bad meal_type: ' + m.meal_type);
  if (typeof m.calories !== 'number' || !isFinite(m.calories)) throw new Error('Bad calories: ' + m.calories);
  if (m.calories < 0 || m.calories > 5000) throw new Error('Calories out of range: ' + m.calories);
  if (!m.food) throw new Error('Missing food');
  if (!m.description) throw new Error('Missing description');
}

/**
 * 2-3 sentence nutrition-coach commentary for /summary.
 * Returns '' on any error so the caller can no-op.
 */
function callGeminiCommentary_(progress) {
  var apiKey = props_().getProperty('GEMINI_API_KEY');
  if (!apiKey) return '';

  var keys = ['breakfast', 'lunch', 'dinner', 'snack'];
  var byMealLines = keys.map(function (k) {
    return '- ' + k + ': ' + (progress.byMeal[k] || 0) + ' kcal';
  }).join('\n');
  var remaining = progress.target - progress.total;

  var prompt = [
    'You are writing a 2-3 sentence friendly nudge about the user\'s daily',
    'calorie intake, shown beneath a progress table in their Telegram bot.',
    'Tone: warm, like a nutritionist friend.',
    '',
    'Today: ' + progress.date,
    'Daily target: ' + progress.target + ' kcal',
    'Total so far: ' + progress.total + ' kcal',
    'By meal:',
    byMealLines,
    'Remaining: ' + remaining + ' kcal.',
    '',
    'Required content:',
    '1. Lead with where they stand (under/over target, by how much).',
    '2. If under, suggest one concrete sensible next item using the',
    '   remaining kcal. If over, suggest something gentle (water, walk,',
    '   lighter tomorrow), no shame.',
    '3. Keep it concrete, no platitudes. No markdown, no emoji.',
    'Plain text only, 200-350 characters.'
  ].join('\n');

  var body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 400,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            GEMINI_MODEL_ + ':generateContent?key=' + encodeURIComponent(apiKey);
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    console.warn('Commentary Gemini ' + code + ': ' + text);
    return '';
  }
  var data = JSON.parse(text);
  var candidate = data.candidates && data.candidates[0];
  var out = candidate && candidate.content && candidate.content.parts &&
            candidate.content.parts[0] && candidate.content.parts[0].text;
  if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
    console.warn('Commentary finishReason=' + candidate.finishReason +
                 ' (output len=' + (out ? out.length : 0) + ')');
  }
  return out ? String(out).trim() : '';
}
