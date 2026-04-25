/**
 * Gemini client. Given text and/or an image, returns a structured expense:
 *   { date, category, amount, currency, description }
 *
 * Uses Gemini's JSON-schema-constrained output so no regex parsing is needed.
 */

var GEMINI_MODEL_ = 'gemini-2.5-flash';

// IMPORTANT: this list must stay in sync with the Category column in your
// `insights` sheet. If you rename one here, rename the matching rows in the
// sheet too — the bot keys variance lookups by exact string match.
var CATEGORIES_ = [
  'rental', 'family', 'transport', 'car insurance', 'subscriptions',
  'utilities', 'groceries & household', 'eat-out', 'entertainment', 'other'
];

function callGemini_(input) {
  var apiKey = props_().getProperty('GEMINI_API_KEY');
  var tz = Session.getScriptTimeZone() || 'Australia/Melbourne';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var parts = [{ text: buildPrompt_(input.text || '', today) }];
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
          category:    { type: 'STRING', enum: CATEGORIES_ },
          amount:      { type: 'NUMBER' },
          currency:    { type: 'STRING' },
          description: { type: 'STRING' }
        },
        required: ['date', 'category', 'amount', 'currency', 'description']
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
  if (code < 200 || code >= 300) {
    throw new Error('Gemini ' + code + ': ' + text);
  }

  var data = JSON.parse(text);
  var candidate = data.candidates && data.candidates[0];
  var jsonText = candidate && candidate.content && candidate.content.parts &&
                 candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!jsonText) throw new Error('Gemini returned no content: ' + text);

  var expense = JSON.parse(jsonText);
  validateExpense_(expense);
  return expense;
}

function buildPrompt_(userText, todayIso) {
  return [
    'You extract a single expense record from the user input and/or the',
    'attached receipt image, and return strict JSON.',
    '',
    'Rules:',
    '- date: YYYY-MM-DD. If the input does not give a date, use today: ' + todayIso + '.',
    '  If the receipt shows a transaction date, prefer that.',
    '- category: must be exactly one of: ' + CATEGORIES_.join(', ') + '.',
    '  Infer from merchant/items. Use "other" only if truly nothing fits.',
    '- amount: the final total paid (not subtotal, not tax alone). Number, not string.',
    '- currency: 3-letter ISO code. Default to AUD if not obvious.',
    '- description: short human-readable summary (max ~60 chars).',
    '  For a text message like "lunch uni 16.68", use "Lunch uni".',
    '  For a receipt, use the merchant name and maybe one detail, e.g. "Woolworths groceries".',
    '',
    'User text: ' + JSON.stringify(userText || '(none)')
  ].join('\n');
}

function validateExpense_(x) {
  if (!x || typeof x !== 'object') throw new Error('Expense not an object');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new Error('Bad date: ' + x.date);
  if (CATEGORIES_.indexOf(x.category) === -1) throw new Error('Bad category: ' + x.category);
  if (typeof x.amount !== 'number' || !isFinite(x.amount)) throw new Error('Bad amount: ' + x.amount);
  if (!x.currency) throw new Error('Missing currency');
  if (!x.description) throw new Error('Missing description');
}

/**
 * Friendly 1-3 sentence commentary on the month's budget state.
 * Uses the per-category rows + total from readInsightsSummary_() and the
 * just-recorded expense, and returns plain text suitable for appending to
 * the Telegram reply. Returns '' on any error so the caller can no-op.
 */
function callGeminiCommentary_(expense, summary) {
  var apiKey = props_().getProperty('GEMINI_API_KEY');
  if (!apiKey) return '';

  var tz = Session.getScriptTimeZone() || 'Australia/Melbourne';
  var now = new Date();
  var todayIso = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var dayOfMonth = Number(Utilities.formatDate(now, tz, 'd'));
  var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var daysRemaining = daysInMonth - dayOfMonth;

  var rowLines = summary.rows.map(function (r) {
    return '- ' + r.category + ': budget ' + r.budget +
           ', actual ' + r.actual + ', variance ' + r.variance;
  }).join('\n');
  var totalLine = 'Total: budget ' + summary.total.budget +
                  ', actual ' + summary.total.actual +
                  ', variance ' + summary.total.variance;

  var expenseLine = expense
    ? 'Most recent expense (only mention if it meaningfully moved a category, ' +
      'e.g. pushed it over for the first time; otherwise ignore it): "' +
      expense.description + '" (' + expense.category + ', ' + expense.amount +
      ' ' + expense.currency + ').'
    : 'No specific recent expense to highlight — just summarize the month.';

  var prompt = [
    'You are writing a 2-3 sentence friendly nudge about the user\'s monthly',
    'budget, shown beneath a budget table in their Telegram expense bot.',
    'Tone: warm, encouraging, like a money-savvy friend.',
    '',
    'Today: ' + todayIso + ' (day ' + dayOfMonth + ' of ' + daysInMonth +
      ' in ' + summary.month + ', ' + daysRemaining + ' days remaining).',
    '',
    'Month-to-date by category (negative variance = over budget):',
    rowLines,
    totalLine,
    '',
    expenseLine,
    '',
    'Required content:',
    '1. Lead with how the month is tracking overall (total budget vs actual,',
    '   in dollars, plus days remaining).',
    '2. Name the 1-2 worst over-budget categories with the dollar amount over.',
    '3. End with a small, concrete suggestion for the days remaining.',
    '',
    'Do NOT just acknowledge that the expense was logged. Do NOT say things',
    'like "That\'s X AUD logged" or "Expense recorded" — the user already',
    'sees the confirmation above this commentary.',
    '',
    'Example output:',
    '"You\'re $1,400 over for the month with 5 days left — entertainment',
    '($870 over) and transport ($615) are the main culprits. Groceries are',
    'still healthy though, so try to ride those out and skip eat-out this week."',
    '',
    'Plain text only, no markdown, no emoji, 200-350 characters.'
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
