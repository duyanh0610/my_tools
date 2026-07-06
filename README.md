# mail_working_timesheet

Automatically fetches attendance data from OPMS, detects violations, and sends explanation emails to the manager — runs via cron twice a month.

## Features

- Logs into OPMS via Google SSO using Chrome CDP (no manual password entry)
- Fetches attendance data via Odoo JSON-RPC API
- Detects violations: late check-in, missing check-in/check-out, insufficient work hours
- Auto-composes and sends explanation emails in Vietnamese
- Handles February edge cases (regular/leap year)

## Report periods

| Cron trigger | Period covered |
| --- | --- |
| 15th of the month | 1st – 15th |
| Last day of the month (28/29/30/31) | 16th – end of month |

## Setup

### 1. Install dependencies

```bash
cd mail_working_timesheet
npm install
```

### 2. Create config file

```bash
cp config.json.example config.json
```

Fill in your details in `config.json`:

```json
{
  "opms": {
    "login_url": "https://opms.insight.hblab.co.jp/web/login",
    "attendance_model": "ntq.attendance",
    "google_account": "email@company.com"
  },
  "work_schedule": {
    "latest_checkin": "08:30",
    "min_work_hours": 8.0,
    "lunch_break_hours": 1.5,
    "grace_period_minutes": 5
  },
  "gmail": {
    "sender_email": "email@company.com",
    "app_password": "xxxx xxxx xxxx xxxx"
  },
  "recipients": {
    "to": ["manager@company.com"],
    "cc": ["hr@company.com"]
  },
  "employee": {
    "name": "Full Name",
    "department": "Department",
    "manager_name": "Manager Name",
    "phone": "0900000000"
  }
}
```

> **Gmail App Password**: Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → create an App Password for "Mail".

### 3. First-time Chrome login

The tool uses a dedicated Chrome profile (`.chrome_profile/`) to keep the OPMS session separate from your personal Chrome.

On the first run, log in manually once:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="$(pwd)/.chrome_profile" \
  --no-first-run
```

Once Chrome opens, navigate to OPMS and sign in with Google. Close Chrome. The session is saved and reused automatically on subsequent runs (typically lasts several months).

### 4. Set up the cron job

```bash
bash setup_cron.sh
```

This schedules `node main.js` to run at **9:00 AM** on the 15th and the last day of each month.

## Manual usage

```bash
# Preview without sending
node main.js --dry-run

# Run normally
node main.js
```

Logs are written to `mail_log.txt`.

## How it works

```
Cron trigger (9:00 AM, 15th / last day of month)
  ↓
Determine report period
  ↓
Open Chrome with .chrome_profile + connect via CDP
  ↓
Log into OPMS via Google SSO (automatic if session is still valid)
  ↓
Fetch attendance records via Odoo JSON-RPC API
  ↓
Log out of OPMS (releases the single-session lock)
  ↓
Analyze violations
  ↓ (if any found)
Send explanation email → manager + CC HR department
```

## Notes

- OPMS only allows **one active session** at a time. The tool logs out automatically after fetching data.
- If Google requires re-authentication (session expired), repeat step 3 above.
- The tool's Chrome instance runs alongside your personal Chrome without interfering.
