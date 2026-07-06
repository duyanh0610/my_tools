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
    // Thử connect Chrome đang chạy trên port 9222
    try {
      const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
      console.log('Đã kết nối Chrome đang chạy.');
      return b;
    } catch {}

    // Kill Chrome phụ cũ (nếu có) rồi spawn mới
    try { execSync('pkill -f "remote-debugging-port=9222"', { stdio: 'ignore' }); } catch {}
    await sleep(1500);

    console.log('Đang mở Chrome...');
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
    throw new Error('Không thể kết nối Chrome sau 15 giây. Hãy thử lại.');
  }

  async _ensureLogin(page) {
    await page.goto(this.cfg.login_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!page.url().includes('/web/login')) {
      console.log('Đã đăng nhập OPMS.');
      return;
    }

    console.log('Đang đăng nhập qua Google SSO...');

    // Tìm nút "Log in with Google"
    const btnHandle = await page.evaluateHandle(() =>
      [...document.querySelectorAll('a, button')].find(el => {
        const text = el.textContent.trim().toLowerCase();
        const href = el.getAttribute('href') || '';
        return text.includes('google') || href.includes('/auth_oauth/') || href.includes('google');
      })
    );
    const btn = btnHandle.asElement();
    if (!btn) throw new Error('Không tìm thấy nút "Log in with Google" trên trang OPMS.');

    await btn.click();
    await page.waitForNavigation({ timeout: 30000 }).catch(() => {});

    const url = page.url();

    // Đã vào OPMS
    if (url.includes(OPMS_ORIGIN) && !url.includes('/web/login')) {
      console.log('Đăng nhập thành công!');
      return;
    }

    // Đang ở trang Google → thử click account trong picker
    if (url.includes('accounts.google.com')) {
      const account = this.cfg.google_account;
      if (account) {
        await sleep(2000); // chờ picker load
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
            console.log('Đăng nhập thành công qua account picker!');
            return;
          }
        }
      }

      throw new Error(
        'Google yêu cầu đăng nhập thủ công (session hết hạn hoặc lần đầu chạy).\n' +
        `Hãy mở Chrome với thư mục: ${CHROME_PROFILE_DIR}\nvà đăng nhập Google bằng tài khoản ${account || 'công ty'}.`
      );
    }

    throw new Error(`Đăng nhập thất bại. URL hiện tại: ${url}`);
  }

  async _fetchRecords(page, start, end) {
    const model = this.cfg.attendance_model || 'ntq.attendance';

    // Dùng buffer 1 ngày để tránh lệch múi giờ, rồi lọc client-side
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
        return { error: 'Không tìm thấy field ngày trong model ' + model + '. Fields: ' + allFields.join(', ') };
      }

      const domain = [[dateField, '>=', startStr], [dateField, '<=', endStr + ' 23:59:59']];
      const fields = [...new Set([dateField, ciField, coField].filter(Boolean))];
      const records = await callKw('search_read', [domain], { fields, limit: 0, order: `${dateField} asc` });

      return { records, dateField, ciField, coField };
    }, model, dateStr(startBuf), dateStr(endBuf));

    if (raw.error) throw new Error(raw.error);
    console.log(`API trả về ${raw.records.length} bản ghi thô.`);

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
    console.log('Đã đăng xuất OPMS.');
  }
}

/** Parse datetime từ Odoo API (UTC) → Date object theo giờ Việt Nam (UTC+7) */
function parseAPIDate(val) {
  if (!val) return null;
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  if (!m[4]) return new Date(+m[1], +m[2] - 1, +m[3]);
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] || 0);
  const local = new Date(utc + UTC_OFFSET_MS);
  return new Date(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

/** Trích xuất "HH:MM" từ giá trị field Odoo (datetime UTC, float, hoặc string) */
function extractTime(val) {
  if (val === null || val === undefined || val === false) return null;

  // Float: 8.5 → "08:30"
  if (typeof val === 'number') {
    const h = Math.floor(val);
    const min = Math.round((val - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  const s = String(val);

  // Datetime UTC: "2026-06-15 01:30:00" → convert sang UTC+7
  const dt = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (dt) {
    const utc = Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5]);
    const local = new Date(utc + UTC_OFFSET_MS);
    return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  }

  // String time: "08:30" hoặc "08:30:00"
  const t = s.match(/(\d{1,2}):(\d{2})/);
  if (t) return `${String(t[1]).padStart(2, '0')}:${t[2]}`;

  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { OPMSScraper };
