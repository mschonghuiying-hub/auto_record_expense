# auto_record_expense

A serverless Telegram expense-logger. Send the bot a text message ("lunch uni
16.68") or a receipt photo, and a new row appears in your Google Sheet.

- Telegram Bot API → Google Apps Script Web App → Gemini API → Google Sheet
- No VM, no server, no cron. Runs entirely on Google's free tier.
- Gemini parses the message / receipt and returns a structured row
  (`date, category, amount, currency, description`).

## How it works

```
Telegram   ──POST──▶   Apps Script doPost   ──▶   Gemini 2.5 Flash
  ▲                         │                         │
  │                         ▼                         ▼
  └────── reply ◀── append row to "expense record" sheet
```

Secrets (bot token, Gemini key, allowed chat ID) live in **Script Properties**,
never in source. `doPost` ignores any message whose `chat.id` doesn't match the
allowed ID, so a random person who learns the webhook URL can't spam your sheet.

## Setup (zero-knowledge, ~15 min)

You will not install anything on your computer. Everything happens in a browser.

### 1. Create a fresh Telegram bot

1. Open Telegram, message `@BotFather`.
2. Send `/newbot`, pick a name, pick a username ending in `bot`.
3. BotFather replies with an **HTTP API token** like `12345:ABCDEF...`. Save it.

Keep your old n8n bot running — you'll switch over at the end only once the new
one works.

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

1. **Project Settings → Script Properties → Add script property**. Add these
   four (names must match exactly):

   | Property             | Value                                         |
   | -------------------- | --------------------------------------------- |
   | `TELEGRAM_BOT_TOKEN` | the token from step 1                         |
   | `GEMINI_API_KEY`     | the key from step 3                           |
   | `ALLOWED_CHAT_ID`    | your chat ID from step 2                      |
   | `SHEET_NAME`         | the tab name in your sheet (e.g. `Sheet1`)    |

2. Save.

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
3. Sanity check: also run `getWebhookInfo`; the `url` field should match your
   `/exec` URL, and `pending_update_count` should be `0`.

### 10. Try it from Telegram

- Send `lunch uni 16.68` → expect a row and a ✅ confirmation reply.
- Send a receipt photo (with or without a caption) → same.
- From a different Telegram account, send a message → nothing should happen.

### 11. Decommission n8n

Once you've used the new bot for a day or two and everything's landing
correctly, shut down your n8n VM. Your old bot token still works — you can
delete that bot via BotFather (`/deletebot`) whenever.

## Updating the code later

Apps Script is the source of truth once deployed. If you change a `.gs` file
in the editor, you need to **Deploy → Manage deployments → edit (pencil) →
Version: New version → Deploy** for the live webhook URL to pick it up.
(Saving alone is enough for manual runs from the editor, but NOT for the
deployed Web App.)

## Troubleshooting

- **Telegram messages don't reach the sheet.** Run `getWebhookInfo` from
  `Setup.gs` and check `last_error_message`. Common causes: webhook URL is
  the `/dev` URL instead of `/exec`; `ALLOWED_CHAT_ID` doesn't match your
  actual chat ID (check via `getUpdates` as in step 2).
- **"Gemini 400 / 403".** The API key is wrong, disabled, or hitting quota.
  Regenerate in AI Studio.
- **Bot replies "Could not record: Bad category: X".** Gemini picked a value
  outside the enum — shouldn't happen with schema-constrained output, but if
  it does, tighten the prompt in `Gemini.gs`.
- **Nothing happens at all.** Open **Apps Script → Executions** tab to see
  webhook invocations and errors.

## Category list

Edit `CATEGORIES_` in `src/Gemini.gs` if you ever want to add/rename
categories — Gemini's response schema uses that list directly.

Current categories:
`rental, family, transport, car insurance, subcriptions, utilities,
groceries & household, eat-out, entertainment, other`.

## Free-tier limits (personal use context)

- Apps Script: 90 min/day runtime, 20,000 `UrlFetchApp` calls/day. A single
  expense uses 2–3 fetches and <5 s of runtime.
- Gemini 2.5 Flash: the free tier's daily RPD and TPM are well above what a
  handful of receipts per day uses.
- Telegram Bot API: free.
