# auto_record_expense

A serverless Telegram expense-logger. Send the bot a text message ("lunch uni
16.68") or a receipt photo, and a new row appears in your Google Sheet. The
bot replies with a ✅ confirmation and a current-month budget progress table.
Send `/summary` for the table plus a friendly AI nudge about how the month is
tracking.

- Apps Script polls Telegram → Gemini API → Google Sheet
- No VM, no server, no cron. Runs entirely on Google's free tier.
- Gemini parses the message / receipt into a structured row
  (`date, category, amount, currency, description`); a second Gemini call,
  triggered by `/summary`, writes a short budget commentary based on an
  `insights` tab you maintain in the same sheet.

## How it works

```
Apps Script (1-min trigger) ──getUpdates──▶ Telegram
        │
        ├─▶ Gemini 2.5 Flash (parse text/photo → expense JSON)
        ▼
    append row to "expense record" tab
        │
        ▼
    sendMessage reply (confirmation + budget table)

/summary command:
        ├─▶ read current month from "insights" tab
        ├─▶ Gemini 2.5 Flash (commentary prompt → nudge text)
        ▼
    sendMessage reply (table + commentary)
```

### Why polling instead of a webhook?

Apps Script Web Apps return a 302 redirect for `/exec` URLs (the script
actually runs at `script.googleusercontent.com`). Telegram's webhook system
doesn't follow redirects — it treats every response as a failed delivery and
retries with exponential backoff. The retries pile up in the pending queue
behind real messages and chew through the daily execution quota.

Long-polling avoids the redirect issue entirely: Apps Script calls Telegram,
not the other way around. The trade-off is up to ~60 s latency between
sending a message and getting a reply, which is fine for an expense logger.

Secrets (bot token, Gemini key, allowed chat IDs) live in **Script Properties**,
never in source. `processUpdate_` ignores any message whose `chat.id` isn't
in `ALLOWED_CHAT_ID`, so even if your token leaks, only chats you've listed
are processed. `ALLOWED_CHAT_ID` accepts a single ID or a comma-separated
list, so multiple Telegram accounts can share one bot and write to the same
sheet.

## What the reply looks like

After every expense:

```
✅ 2026-04-25 · groceries & household · 35 AUD
Woolworths weekly shop

📊 2026-04
car insurance ██████████  200/ 200
eat-out       ██████████  410/ 250
entertainment ██████████  230/  50
family        ██████████  400/ 400
groceries & … █████░░░░░  280/ 600
rental        ██████████ 2000/2000
subscriptions ██████████  130/ 100
transport     ██████████  360/ 200
─────────────────────────────────
Total         ██████████ 4010/3800
```

Each row shows a 10-segment progress bar plus `actual/budget`. The bar
saturates at 100%, so over-budget categories show a full bar with the
overage visible in the numbers.

Send `/summary` any time for the same table plus a 💬 AI commentary line:

```
💬 You're $210 over for the month with 5 days left — entertainment
($180 over) and eat-out / transport ($160 each) are the main culprits.
Groceries are still healthy though, so try to ride those out and skip
eat-out this week.
```

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
   `Gemini.gs`, `Sheet.gs`, `Setup.gs`, `Poller.gs`):
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
| `ALLOWED_CHAT_ID`    | your chat ID from step 2 (comma-separate to allow multiple accounts, e.g. `123456789,987654321`) |
| `SHEET_NAME`         | the expense tab name (e.g. `expense record`)  |

Optional:

| Property              | Effect |
| --------------------- | ------ |
| `INSIGHTS_SHEET_NAME` | Name of the monthly aggregation tab. Defaults to `insights`. |
| `WEBHOOK_URL`         | Only needed if you ever switch back to webhook mode via `disablePolling`. |

### 7. Smoke-test Gemini + sheet before touching Telegram

1. In the editor, open `Setup.gs`, pick `testParseText` from the function
   dropdown, click **Run**.
2. First run: Apps Script asks for permissions (sheet access + external
   fetch). Approve.
3. A new row should appear in your sheet: `today | eat-out | 16.68 | AUD | Lunch uni`.
4. Delete that test row.

If this doesn't work, fix it here before moving on — the Telegram layer
just adds a webhook on top of this.

### 8. Switch the bot to long-polling

1. In the editor, open `Setup.gs`, pick `enablePolling` → **Run**.
2. View → **Logs**. You should see `{"ok":true,...}` (webhook removed) and
   a reminder to add the trigger.
3. Click the clock icon (**Triggers**) on the left rail → **+ Add Trigger**.
4. Function: `pollUpdates`. Event source: **Time-driven**. Type:
   **Minutes timer** → **Every 1 minute**. Save.
5. Sanity check: run `getWebhookInfo`. The `url` field should be empty.

### 9. Try it from Telegram

- Send `lunch uni 16.68` → within ~60 s, expect a new row in
  `expense record` and a ✅ confirmation + budget table reply.
- Send a receipt photo (with or without a caption) → same.
- Send `/summary` → expect the table plus a 💬 commentary line.
- From a Telegram account whose chat ID is **not** in `ALLOWED_CHAT_ID`,
  send a message → nothing should happen.

### Adding a second user

To let another person contribute to the same sheet via the same bot:

1. Have them message the bot once from their own Telegram account (any text).
2. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and find the new
   `"chat":{"id":...}` value for that account.
3. Edit `ALLOWED_CHAT_ID` in **Project Settings → Script Properties** to
   include both IDs, comma-separated, e.g. `123456789,987654321`. Save.
4. Their next message will be processed; rows land in the same `expense
   record` sheet and their reply (confirmation + budget table) is sent back
   to their own chat.

No redeploy needed — the next `pollUpdates` run picks up the new property.

## Updating the code later

Apps Script is the source of truth. After editing a `.gs` file, **Save**
is enough for the next `pollUpdates` trigger run to pick it up — there's
no Web App deployment to redeploy in polling mode.

## Troubleshooting

- **No reply arrives on Telegram.** Open **Apps Script → Executions** and
  check `pollUpdates`. It should run every minute. If it's failing, click a
  failed row to see the error.
- **`pollUpdates` runs but does nothing.** Run `getWebhookInfo`. If `url`
  is non-empty, the webhook is still set and Telegram is delivering updates
  to it instead of the polling queue — run `enablePolling` again.
- **`ALLOWED_CHAT_ID` mismatch.** `processUpdate_` silently drops messages
  whose `chat.id` doesn't match. Verify via `getUpdates` (step 2).
- **"Gemini 400 / 403".** The API key is wrong, disabled, or hitting quota.
  Regenerate in AI Studio.
- **Bot replies "Could not record: Bad category: X".** Gemini picked a value
  outside the enum — shouldn't happen with schema-constrained output, but if
  it does, tighten the prompt in `Gemini.gs`.
- **Reply has the ✅ confirmation but no budget table.** Either the
  `insights` tab doesn't exist (create it, see Prerequisites) or it has no
  rows for the current month yet (expected until you log one expense that
  flows into `insights` for today's month).
- **`/summary` 💬 commentary is truncated or wrong.** The commentary call
  logs its `finishReason` in Executions when it's not `STOP`.
- **Want to switch back to webhook mode anyway?** Run `disablePolling` and
  delete the `pollUpdates` trigger. Be aware of the 302 retry storm.

## Category list

Edit `CATEGORIES_` in `src/Gemini.gs` if you ever want to add/rename
categories — Gemini's response schema uses that list directly. If you
rename a category here, rename the matching row in your `insights` tab
too; the bot looks them up by exact string match.

Current categories:
`rental, family, transport, car insurance, subscriptions, utilities,
groceries & household, eat-out, entertainment, other`.

## Free-tier limits (personal use context)

- **Apps Script**: 90 min/day runtime, 20,000 `UrlFetchApp` calls/day.
  Polling at 1/min costs ~1440 fetches and ~24 min/day of runtime baseline,
  plus 2–3 fetches per expense (Gemini parse, optional photo download,
  Telegram reply). `/summary` adds one extra Gemini call. Comfortably under
  both caps for personal use.
- **Gemini 2.5 Flash**: 1 call per expense (parse) + 1 call per `/summary`
  (commentary). Personal-use volume is far under the free tier's RPD/TPM.
  The commentary call runs with `thinkingConfig.thinkingBudget: 0` so it
  doesn't burn thinking tokens.
- **Telegram Bot API**: free.
