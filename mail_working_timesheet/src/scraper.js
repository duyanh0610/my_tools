'use strict';

const puppeteer = require('puppeteer-core');
const path = require('path');
const { execSync, spawn } = require('child_process');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PROFILE_DIR = path.join(__dirname, '.chrome_profile');
const OPMS_ORIGIN = 'https://opms.insight.hblab.co.jp';

// Vietnam UTC+7
const UTC_OFFSET_MS = 7 * 3600 * 1000;

/**
 * @typedef {{ date: Date, checkIn: string|null, checkOut: string|null }} TimesheetRecord
 */

class OPMSScraper {
  constructor(config) {
    this.cfg = config;
  }

  /** @returns {Promise<TimesheetRecord[]>} */
  async getTimesheet(start, end) {
    const browser = await this._openBrowser();
    const page = await browser.newPage();
    try {
      await this._ensureLogin(page);
      return await this._fetchRecords(page, start, end);
    } finally {
      await this._logout(page).catch(() => {});
      await page.close();
      browser.disconnect();
    }
  }

  async _openBrowser() {
    // Try connecting to Chrome already running on port 9222
    try {
      const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
      console.log('Connected to existing Chrome instance.');
      return b;
    } catch {}

    // Kill any previous tool Chrome instance, then spawn a new one
    try { execSync('pkill -f "remote-debugging-port=9222"', { stdio: 'ignore' }); } catch {}
    await sleep(1500);

    console.log('Starting Chrome...');
    spawn(CHROME_PATH, [
      `--user-data-dir=${CHROME_PROFILE_DIR}`,
      '--remote-debugging-port=9222',
      '--no-first-run',
      '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore' }).unref();

    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      try {
        return await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
      } catch {}
    }
    throw new Error('Could not connect to Chrome after 15 seconds. Please try again.');
  }

  async _ensureLogin(page) {
    await page.goto(this.cfg.login_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!page.url().includes('/web/login')) {
      console.log('Already logged into OPMS.');
      return;
    }

    console.log('Logging in via Google SSO...');

    // Find the "Log in with Google" button
    const btnHandle = await page.evaluateHandle(() =>
      [...document.querySelectorAll('a, button')].find(el => {
        const text = el.textContent.trim().toLowerCase();
        const href = el.getAttribute('href') || '';
        return text.includes('google') || href.includes('/auth_oauth/') || href.includes('google');
      })
    );
    const btn = btnHandle.asElement();
    if (!btn) throw new Error('Could not find "Log in with Google" button on OPMS.');

    await btn.click();
    await page.waitForNavigation({ timeout: 30000 }).catch(() => {});

    const url = page.url();

    // Successfully redirected back to OPMS
    if (url.includes(OPMS_ORIGIN) && !url.includes('/web/login')) {
      console.log('Login successful!');
      return;
    }

    // Still on Google page — try clicking the account in the picker
    if (url.includes('accounts.google.com')) {
      const account = this.cfg.google_account;
      if (account) {
        await sleep(2000); // wait for picker to load
        const accHandle = await page.evaluateHandle((email) =>
          document.querySelector(`[data-identifier="${email}"]`) ||
          [...document.querySelectorAll('li, div[role="link"], div[role="button"]')]
            .find(el => el.textContent.includes(email))
        , account);
        const accEl = accHandle.asElement();
        if (accEl) {
          await accEl.click();
          await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
          if (page.url().includes(OPMS_ORIGIN) && !page.url().includes('/web/login')) {
            console.log('Login successful via account picker!');
            return;
          }
        }
      }

      throw new Error(
        'Google requires manual login (session expired or first run).\n' +
        `Open Chrome with: --user-data-dir=${CHROME_PROFILE_DIR}\nand sign in with ${account || 'your company account'}.`
      );
    }

    throw new Error(`Login failed. Current URL: ${url}`);
  }

  async _fetchRecords(page, start, end) {
    const model = this.cfg.attendance_model || 'ntq.attendance';

    // 1-day buffer to handle timezone edge cases; filter client-side
    const startBuf = new Date(start); startBuf.setDate(startBuf.getDate() - 1);
    const endBuf = new Date(end); endBuf.setDate(endBuf.getDate() + 1);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    await page.goto(`${OPMS_ORIGIN}/web`, { waitUntil: 'domcontentloaded' });

    const raw = await page.evaluate(async (model, startStr, endStr) => {
      const callKw = async (method, args = [], kwargs = {}) => {
        const res = await fetch('/web/dataset/call_kw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'call', id: Date.now(),
            params: { model, method, args, kwargs },
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.data?.message || JSON.stringify(json.error));
        return json.result;
      };

      // Discover fields
      const fieldDefs = await callKw('fields_get', [], { attributes: ['string', 'type'] });
      const allFields = Object.keys(fieldDefs);

      const findField = (...names) => names.find(n => allFields.includes(n)) || null;
      const dateField = findField('check_in', 'date', 'attendance_date');
      const ciField   = findField('check_in', 'time_in', 'checkin');
      const coField   = findField('check_out', 'time_out', 'checkout');

      if (!dateField) {
        return { error: 'Date field not found in model ' + model + '. Available fields: ' + allFields.join(', ') };
      }

      const domain = [[dateField, '>=', startStr], [dateField, '<=', endStr + ' 23:59:59']];
      const fields = [...new Set([dateField, ciField, coField].filter(Boolean))];
      const records = await callKw('search_read', [domain], { fields, limit: 0, order: `${dateField} asc` });

      return { records, dateField, ciField, coField };
    }, model, dateStr(startBuf), dateStr(endBuf));

    if (raw.error) throw new Error(raw.error);
    console.log(`API returned ${raw.records.length} raw records.`);

    return raw.records
      .map(r => ({
        date: parseAPIDate(r[raw.dateField]),
        checkIn: extractTime(r[raw.ciField]),
        checkOut: extractTime(r[raw.coField]),
      }))
      .filter(r => r.date && r.date >= start && r.date <= end)
      .sort((a, b) => a.date - b.date);
  }

  async _logout(page) {
    await page.goto(`${OPMS_ORIGIN}/web/session/destroy`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log('Logged out of OPMS.');
  }
}

/** Parse Odoo API datetime (UTC) → local Date object (UTC+7) */
function parseAPIDate(val) {
  if (!val) return null;
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  if (!m[4]) return new Date(+m[1], +m[2] - 1, +m[3]);
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] || 0);
  const local = new Date(utc + UTC_OFFSET_MS);
  return new Date(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

/** Extract "HH:MM" from an Odoo field value (UTC datetime, float, or string) */
function extractTime(val) {
  if (val === null || val === undefined || val === false) return null;

  // Float: 8.5 → "08:30"
  if (typeof val === 'number') {
    const h = Math.floor(val);
    const min = Math.round((val - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  const s = String(val);

  // UTC datetime string → convert to UTC+7
  const dt = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (dt) {
    const utc = Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5]);
    const local = new Date(utc + UTC_OFFSET_MS);
    return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  }

  // Plain time string: "08:30" or "08:30:00"
  const t = s.match(/(\d{1,2}):(\d{2})/);
  if (t) return `${String(t[1]).padStart(2, '0')}:${t[2]}`;

  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { OPMSScraper };
