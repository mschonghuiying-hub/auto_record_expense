# auto_record_expense

A serverless Telegram expense-logger. Send the bot a text message ("lunch uni
16.68") or a receipt photo, and a new row appears in your Google Sheet. The
bot replies with a ✅ confirmation, a current-month budget-vs-actual table,
and a friendly AI nudge about how the month is tracking.

- Telegram Bot API → Google Apps Script Web App → Gemini API → Google Sheet
- No VM, no server, no cron. Runs entirely on Google's free tier.
- Gemini parses the message / receipt into a structured row
  (`date, category, amount, currency, description`) and — on a second call —
  writes a short budget commentary based on an `insights` tab you maintain
  in the same sheet.

## How it works

```
Telegram ──POST──▶ Apps Script doPost
                       │
                       ├─▶ Gemini 2.5 Flash (parse text/photo → expense JSON)
                       ▼
                   append row to "expense record" tab
                       │
                       ├─▶ read this month's rows from "insights" tab
                       │
                       ├─▶ Gemini 2.5 Flash (commentary prompt → nudge text)
                       ▼
                   reply to Telegram
```

Secrets (bot token, Gemini key, allowed chat ID) live in **Script Properties**,
never in source. `doPost` ignores any message whose `chat.id` doesn't match the
allowed ID, so a random person who learns the webhook URL can't spam your sheet.

## What the reply looks like

```
✅ 2026-04-25 · groceries & household · 35 AUD
Woolworths weekly shop

📊 2026-04
Category        Bud   Act   Var
car insurance   200   200     0
eat-out         250   410  -160
entertainment    50   230  -180
family          400   400     0
groceries & h…  600   280   320
rental         2000  2000     0
subcriptions    100   130   -30
transport       200   360  -160
--------------------------------
Total          3800  4010  -210

💬 You're $210 over for the month with 5 days left — entertainment
($180 over) and eat-out / transport ($160 each) are the main culprits.
Groceries are still healthy though, so try to ride those out and skip
eat-out this week.
```

The 💬 commentary is on by default. Set the `ENABLE_COMMENTARY` Script
Property to `false` to skip it (the confirmation + table still fire).

## Prerequisites: two tabs in your sheet

- **`expense record`** tab (the bot appends rows here):
  `A date (YYYY-MM-DD)  B category  C amount  D currency  E description
  F yyyy-mm` — column F is auto-filled by formula.
- **`insights`** tab (the bot reads this for the summary table):
  `A Month (yyyy-MM)  B Budget Category  C Spent  D budget  E remaining`.
  Populate it however you like (typical: SUMIFS / QUERY against `expense
  record`, with a per-category `budget` column). The bot filters to today's
  month and treats column E as the variance.

If the `insights` tab doesn't exist, the bot falls back to sending only the
confirmation line — nothing breaks.

## Setup (zero-knowledge, ~15 min)

You will not install anything on your computer. Everything happens in a browser.

### 1. Create a fresh Telegram bot

1. Open Telegram, message `@BotFather`.
2. Send `/newbot`, pick a name, pick a username ending in `bot`.
3. BotFather replies with an **HTTP API token** like `12345:ABCDEF...`. Save it.

### 2. Get your Telegram chat ID

1. In Telegram, send **any** message to your new bot (e.g. "hi").
2. In a browser, open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`.
3. Find `"chat":{"id":123456789,...}`. That number is your chat ID. Save it.

### 3. Get a Gemini API key

1. Open [aistudio.google.com](https://aistudio.google.com/), sign in.
2. Click **Get API key** → **Create API key**. Copy it.

### 4. Open Apps Script bound to your sheet

1. Open your `expense record` Google Sheet.
2. **Extensions → Apps Script**. A new tab opens with an editor.
3. Rename the project (top-left) to `auto_record_expense`.

### 5. Paste the code

In the Apps Script editor:

1. Delete the default `Code.gs` content.
2. For each file in this repo's `src/` folder (`Code.gs`, `Telegram.gs`,
   `Gemini.gs`, `Sheet.gs`, `Setup.gs`):
   - Click the **+** next to "Files" → **Script** → name it exactly
     (e.g. `Telegram`) → paste the file's contents.
   - For `Code.gs`, just paste into the one that's already there.
3. Click the gear icon (**Project Settings**) → check
   **"Show 'appsscript.json' manifest file in editor"**.
4. Back in the editor, open `appsscript.json` and replace its contents with
   the `appsscript.json` from this repo. Save.

### 6. Add your secrets

**Project Settings → Script Properties → Add script property**. Required:

| Property             | Value                                         |
| -------------------- | --------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | the token from step 1                         |
| `GEMINI_API_KEY`     | the key from step 3                           |
| `ALLOWED_CHAT_ID`    | your chat ID from step 2                      |
| `SHEET_NAME`         | the expense tab name (e.g. `expense record`)  |

Optional:

| Property              | Effect |
| --------------------- | ------ |
| `INSIGHTS_SHEET_NAME` | Name of the monthly aggregation tab. Defaults to `insights`. |
| `ENABLE_COMMENTARY`   | Set to `false` to skip the 💬 AI nudge (saves one Gemini call per message). Any other value (or unset) keeps it on. |
| `WEBHOOK_URL`         | Filled in later in step 8. |

### 7. Smoke-test Gemini + sheet before touching Telegram

1. In the editor, open `Setup.gs`, pick `testParseText` from the function
   dropdown, click **Run**.
2. First run: Apps Script asks for permissions (sheet access + external
   fetch). Approve.
3. A new row should appear in your sheet: `today | eat-out | 16.68 | AUD | Lunch uni`.
4. Delete that test row.

If this doesn't work, fix it here before moving on — the Telegram layer
just adds a webhook on top of this.

### 8. Deploy as a Web App

1. **Deploy → New deployment**.
2. **Select type → Web app**.
3. Description: anything. **Execute as: Me**. **Who has access: Anyone**.
   (The chat-ID guard in `doPost` keeps strangers out; "Anyone" just lets
   Telegram's servers POST without a Google login.)
4. **Deploy**. Copy the resulting URL — it ends in `/exec`.
5. **Project Settings → Script Properties**, add `WEBHOOK_URL` = that URL.

### 9. Register the webhook with Telegram

1. In the editor, open `Setup.gs`, pick `registerWebhook` → **Run**.
2. View → **Logs**. You should see `{"ok":true,...}`.
3. Sanity check: also run `getWebhookInfo`; the `url` field should match
   your `/exec` URL, `pending_update_count` should be `0`, and
   `allowed_updates` should be `["message"]` (the bot only wants message
   events, nothing else).

### 10. Try it from Telegram

- Send `lunch uni 16.68` → expect a new row in `expense record`, a ✅
  confirmation, the budget table for the current month, and a 💬
  commentary line.
- Send a receipt photo (with or without a caption) → same.
- From a different Telegram account, send a message → nothing should happen.

### 11. (Recommended) Schedule `dropPendingUpdates`

Telegram retries failed webhook deliveries with backoff and queues new
messages behind them. If a transient error (Gemini 429, a network blip)
ever piles up the retry buffer, new messages won't arrive until the queue
is cleared.

Set up a time-driven trigger so the queue is flushed automatically:

1. In the Apps Script editor, click the clock icon (**Triggers**) →
   **+ Add Trigger**.
2. Function: `dropPendingUpdates`. Event source: **Time-driven**. Type:
   **Minutes timer** → **Every 30 minutes** (or longer; 30 min is a
   comfortable default).
3. Save.

If you ever notice "execution completed, no reply on Telegram", you can
also just run `dropPendingUpdates` manually to clear things on demand.

## Updating the code later

Apps Script is the source of truth once deployed. If you change a `.gs` file
in the editor, you need to **Deploy → Manage deployments → edit (pencil) →
Version: New version → Deploy** for the live webhook URL to pick it up.
(Saving alone is enough for manual runs from the editor, but NOT for the
deployed Web App.)

If you change what `allowed_updates` or other webhook settings should be,
re-run `registerWebhook` once for Telegram to learn the new config.

## Troubleshooting

- **Executions say "Completed" but no reply arrives on Telegram.** Telegram's
  pending-updates queue has backed up. Run `dropPendingUpdates` from
  `Setup.gs`, or wait for the scheduled trigger (step 11) to do it for you.
- **Telegram messages don't reach the sheet at all.** Run `getWebhookInfo`
  from `Setup.gs` and check `last_error_message`. Common causes: webhook URL
  is the `/dev` URL instead of `/exec`; `ALLOWED_CHAT_ID` doesn't match your
  actual chat ID (check via `getUpdates` as in step 2).
- **"Gemini 400 / 403".** The API key is wrong, disabled, or hitting quota.
  Regenerate in AI Studio.
- **Bot replies "Could not record: Bad category: X".** Gemini picked a value
  outside the enum — shouldn't happen with schema-constrained output, but if
  it does, tighten the prompt in `Gemini.gs`.
- **Reply has the ✅ confirmation but no budget table.** Either the
  `insights` tab doesn't exist (create it, see Prerequisites) or it has no
  rows for the current month yet (expected behaviour until you log one
  expense that flows into `insights` for today's month).
- **💬 commentary is truncated or wrong.** The commentary call logs its
  `finishReason` in Executions when it's not `STOP`. If you want to silence
  commentary entirely, set `ENABLE_COMMENTARY=false` in Script Properties —
  no redeploy needed.
- **Nothing happens at all.** Open **Apps Script → Executions** tab to see
  webhook invocations and errors.

## Category list

Edit `CATEGORIES_` in `src/Gemini.gs` if you ever want to add/rename
categories — Gemini's response schema uses that list directly.

Current categories:
`rental, family, transport, car insurance, subcriptions, utilities,
groceries & household, eat-out, entertainment, other`.

## Free-tier limits (personal use context)

- **Apps Script**: 90 min/day runtime, 20,000 `UrlFetchApp` calls/day. A
  single expense uses 3–4 fetches (Telegram read, Gemini parse, optional
  Gemini commentary, Telegram reply) and well under 5 s of runtime.
- **Gemini 2.5 Flash**: with commentary on, one expense = **2 Gemini calls**
  (parse + commentary); with commentary off, just 1. Personal-use volume
  is far under the free tier's RPD/TPM. The commentary call runs with
  `thinkingConfig.thinkingBudget: 0` so it doesn't burn thinking tokens.
- **Telegram Bot API**: free.
