#!/usr/bin/env node
'use strict';

/**
 * Tự động gửi mail giải trình chấm công từ OPMS.
 *
 * Cách dùng:
 *   node main.js            – Chạy bình thường, tự động gửi mail
 *   node main.js --dry-run  – Soạn mail nhưng không gửi (để kiểm tra)
 *   node main.js --debug    – Bật log chi tiết
 *
 * Cron: 0 9 15,28,29,30 * *
 */

const fs = require('fs');
const path = require('path');

const { OPMSScraper } = require('./scraper');
const { analyzeTimesheet } = require('./analyzer');
const { buildEmail } = require('./template');
const { sendEmail } = require('./emailer');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function getPeriod() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const lastDay = new Date(y, m + 1, 0).getDate();

  if (d === 15) {
    return { start: new Date(y, m, 1), end: new Date(y, m, 15) };
  }

  // Kỳ 2: chạy khi là ngày cuối tháng, hoặc ngày 30 với tháng có ≥30 ngày
  if (d === lastDay || (d === 30 && lastDay >= 30)) {
    return { start: new Date(y, m, 16), end: new Date(y, m, lastDay) };
  }

  // Ngày 28/29 của tháng không phải tháng 2 → bỏ qua
  return null;
}

function fmt(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Lỗi: Không tìm thấy ${CONFIG_PATH}`);
    console.error('Hãy sao chép config.json.example thành config.json và điền thông tin thực tế.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const period = getPeriod();
  if (!period) {
    console.log('Hôm nay không phải ngày chạy báo cáo. Thoát.');
    return;
  }

  const { start, end } = period;
  const half = start.getDate() === 1 ? '1' : '2';
  console.log(`[Kỳ ${half}] Đang lấy dữ liệu chấm công: ${fmt(start)} – ${fmt(end)}`);

  const scraper = new OPMSScraper(config.opms);
  const records = await scraper.getTimesheet(start, end);
  console.log(`Đã lấy ${records.length} ngày công.`);

  const violations = analyzeTimesheet(records, config.work_schedule);

  if (violations.length === 0) {
    console.log('Không có vi phạm trong kỳ này. Không cần gửi mail giải trình.');
    return;
  }

  console.log(`Phát hiện ${violations.length} ngày có bất thường.`);

  const { subject, text, html } = buildEmail(violations, start, end, config);

  console.log('\n' + '='.repeat(60));
  console.log(`Subject: ${subject}`);
  console.log('='.repeat(60));
  console.log(text);
  console.log('='.repeat(60) + '\n');

  if (dryRun) {
    console.log('[Dry-run] Mail không được gửi.');
    return;
  }

  console.log(`Đang gửi mail đến: ${config.recipients.to.join(', ')} ...`);
  await sendEmail(config.gmail, config.recipients, subject, text, html);
  console.log('Mail đã được gửi thành công!');
}

main().catch((err) => {
  console.error('Lỗi:', err.message);
  process.exit(1);
});
