# calorie_tracker

A serverless Telegram calorie-logger. Snap a photo of your meal (caption
optional) and a new row appears in your Google Sheet. The bot replies with
a 🍽 confirmation and a daily progress table scaled to your personal calorie
target.

Same architecture as the parent `auto_record_expense` project — Apps Script
polling Telegram → Gemini → Google Sheet — running entirely on Google's
free tier.

## Differences from the expense bot

| | Expense bot | Calorie tracker |
|---|---|---|
| Primary input | Text ("lunch 16.68") | Photo of the meal (caption optional) |
| Schema | `{date, category, amount, currency, description}` | `{date, meal_type, food, calories, description}` |
| Daily target | Per-category budget table | Personalised daily kcal from your profile |
| Target source | `insights` tab maintained by you | Computed in code from `profile` tab using Mifflin-St Jeor BMR + activity multiplier + goal delta |
| Aggregation | Monthly | Daily (resets each day) |

Calorie counts from photos are **estimates** — expect ±20–40% error on
unfamiliar dishes. The bot includes its assumed serving size in the
description so you can spot-check, and the reply tells you to edit the
sheet row when off. Captions like "half portion" or "no rice" steer the
estimate.

## Sheet tabs

**`meals`** (the bot appends rows here):
`A date (YYYY-MM-DD)  B meal_type  C food  D calories  E description`

`meal_type` ∈ `breakfast / lunch / dinner / snack`.

**`profile`** (you maintain by hand — single data row at row 2):
`A gender  B age  C height_cm  D weight_kg  E activity_level  F goal`

- `gender`: `male` / `female`
- `activity_level`: `sedentary` / `light` / `moderate` / `active` / `very_active`
- `goal`: `lose` / `maintain` / `gain`

Example row 2: `male, 30, 180, 75, moderate, maintain` → BMR 1730,
TDEE 2682, target = 2682 kcal/day (no goal delta on maintain).

If the `profile` tab is missing or invalid the bot falls back to a 2000 kcal
default so it still replies; check Executions logs for the warning.

## Daily target math

Mifflin-St Jeor equation (clinical standard, more accurate than
Harris-Benedict for the general adult population):

```
BMR (male)   = 10·kg + 6.25·cm − 5·age + 5
BMR (female) = 10·kg + 6.25·cm − 5·age − 161

Activity multiplier:
  sedentary    1.2
  light        1.375
  moderate     1.55
  active       1.725
  very_active  1.9

TDEE = BMR × activity multiplier

Goal adjustment (kcal/day):
  lose      −500   (≈0.45 kg/week deficit)
  maintain     0
  gain      +300
```

Implemented in `src/Sheet.gs::computeDailyTarget_`.

## What the reply looks like

```
🍽 2026-05-05 · lunch · 520 kcal
Chicken katsu curry (1 medium plate ~400g, with rice and tonkatsu sauce)
(estimate — edit row if off)

📊 2026-05-05
breakfast  ████░░░░░░  340
lunch      ██████████  520
dinner     ░░░░░░░░░░    0
snack      ░░░░░░░░░░    0
──────────────────────────
Total      █████░░░░░  860/2682  (1822 left)
```

`/summary` triggers a Gemini commentary line:

```
💬 You're at 860 of 2682 kcal with dinner still ahead — plenty of room.
Aim for ~1500 kcal at dinner (e.g. salmon with greens and sweet potato)
and you'll land on target with room for an evening yogurt.
```

## Setup (~15 min)

### 1. Create a fresh Telegram bot

1. Message `@BotFather` → `/newbot` → pick a name & username ending in `bot`.
2. Save the **HTTP API token**.

### 2. Get your Telegram chat ID

1. Send any message to your new bot.
2. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and find
   `"chat":{"id":...}`. Save it.

### 3. Get a separate Gemini API key

If you're already running expense bots on Gemini, **create a new AI Studio
project** so the calorie tracker has its own quota:

1. [aistudio.google.com](https://aistudio.google.com/) → top-left project
   selector → **New project** (or create a new Google Cloud project).
2. With the new project active, **Get API key** → **Create API key**. Save it.

This gives you a fresh ~250 RPD / 10 RPM allotment, isolated from the
expense bots — a runaway loop in one project can't starve the others.

### 4. Create the Sheet

1. New Google Sheet. Add two tabs: `meals` and `profile`.
2. In `profile`, row 1 is headers (`gender`, `age`, etc.); row 2 holds
   your stats. Filling row 2 with sane values is the only setup needed —
   no formulas, no SUMIFS.
3. **Extensions → Apps Script** opens the editor.

### 5. Paste the code

For each file in `calorie_tracker/src/` (`Code.gs`, `Telegram.gs`, `Poller.gs`,
`Gemini.gs`, `Sheet.gs`, `Setup.gs`):
- Click **+** next to "Files" → **Script** → name it exactly → paste.
- For the default `Code.gs`, just replace the contents.

Project Settings → check "Show 'appsscript.json' manifest file in editor",
then paste in the `appsscript.json` from this folder.

### 6. Add Script Properties

| Property               | Value                                                        |
|------------------------|--------------------------------------------------------------|
| `TELEGRAM_BOT_TOKEN`   | Token from step 1                                            |
| `GEMINI_API_KEY`       | **New** key from step 3                                      |
| `ALLOWED_CHAT_ID`      | Your chat ID from step 2 (comma-separate for multiple users) |
| `MEALS_SHEET_NAME`     | `meals` (default if unset)                                   |
| `PROFILE_SHEET_NAME`   | `profile` (default if unset)                                 |

### 7. Smoke-test before Telegram

In the editor, open `Setup.gs` and run in this order:

1. `testComputeTarget` → logs your profile + computed kcal target. Cross-check
   the BMR/TDEE math against a calculator if you want.
2. `testParseText` → appends a test row using "two slices of avocado toast".
   Delete the test row when done.
3. `testProgress` → logs today's `byMeal` totals and target.

Fix any errors here before moving on to Telegram.

### 8. Switch the bot to long-polling

1. Run `enablePolling`. Logs should show `{"ok":true}` (webhook removed).
2. Clock icon → **+ Add Trigger** → function `pollUpdates`,
   event source **Time-driven**, **Every 1 minute**. Save.
3. Run `getWebhookInfo` — `url` should be empty.

### 9. Try it from Telegram

- Snap a meal photo → within ~60s, expect a row in `meals` and a 🍽
  confirmation + daily progress table reply.
- Send a meal text like "tuna sandwich, 1 small wholemeal, mayo" → same.
- Send `/summary` → expect the table plus a 💬 commentary line.
- From a different Telegram account, send a message → nothing should happen.

## Cost

- **Gemini 2.5 Flash** (new project): ~5–10 calls/day for personal use
  (3–5 meals + occasional `/summary`). Well under the ~250 RPD free tier.
- **Apps Script**: ~1440 polling fetches/day baseline + 2–3 per meal.
  Comfortably under the 20k/day fetch quota and 90 min/day runtime quota.
- **Telegram Bot API**: free.
- **Google Sheets**: free.

Net spend: **$0/month**.

## Troubleshooting

- **No reply on Telegram.** Open Apps Script → Executions and check
  `pollUpdates`. If it's failing, click a failed row to see the error.
- **`pollUpdates` runs but does nothing.** Run `getWebhookInfo`. If `url`
  is non-empty, the webhook is still set — re-run `enablePolling`.
- **`ALLOWED_CHAT_ID` mismatch.** `processUpdate_` silently drops messages
  whose chat ID isn't in the allowlist. Verify via `getUpdates`.
- **Reply target says 2000 kcal even though your profile is set.** Profile
  validation failed — check Executions for the warning. Common causes:
  typo in `activity_level` (`very active` instead of `very_active` is
  auto-corrected to underscore form, but `super active` would fail), or
  `gender` not exactly `male`/`female`.
- **Calories are way off.** Photos alone are inherently noisy. Add a
  caption next time ("half portion", "extra rice"), or just edit the
  number in the sheet — it's the source of truth.
- **Bot replies "Calories out of range".** Gemini guessed >5000 or <0
  kcal. Re-send with a caption that constrains the portion.
