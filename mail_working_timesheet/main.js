#!/usr/bin/env node
'use strict';

/**
 * Automatically sends attendance explanation emails from OPMS.
 *
 * Usage:
 *   node main.js            – Run normally and send email
 *   node main.js --dry-run  – Preview email without sending
 *   node main.js --debug    – Enable verbose logging
 *
 * Cron: 0 9 15,28,29,30 * *
 */

const fs = require('fs');
const path = require('path');

const { OPMSScraper } = require('./src/scraper');
const { analyzeTimesheet } = require('./src/analyzer');
const { buildEmail } = require('./src/template');
const { sendEmail } = require('./src/emailer');

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

  // Second half: run on the last day of the month, or day 30 for months with ≥30 days
  if (d === lastDay || (d === 30 && lastDay >= 30)) {
    return { start: new Date(y, m, 16), end: new Date(y, m, lastDay) };
  }

  // Day 28/29 in non-February months → skip
  return null;
}

function fmt(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Error: ${CONFIG_PATH} not found.`);
    console.error('Copy config.json.example to config.json and fill in your details.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const period = getPeriod();
  if (!period) {
    console.log('Not a report day. Exiting.');
    return;
  }

  const { start, end } = period;
  const half = start.getDate() === 1 ? '1' : '2';
  console.log(`[Period ${half}] Fetching attendance: ${fmt(start)} – ${fmt(end)}`);

  const scraper = new OPMSScraper(config.opms);
  const records = await scraper.getTimesheet(start, end);
  console.log(`Fetched ${records.length} attendance records.`);

  const violations = analyzeTimesheet(records, config.work_schedule);

  if (violations.length === 0) {
    console.log('No violations found this period. No email needed.');
    return;
  }

  console.log(`Found ${violations.length} day(s) with violations.`);

  const { subject, text, html } = buildEmail(violations, start, end, config);

  console.log('\n' + '='.repeat(60));
  console.log(`Subject: ${subject}`);
  console.log('='.repeat(60));
  console.log(text);
  console.log('='.repeat(60) + '\n');

  if (dryRun) {
    console.log('[Dry-run] Email not sent.');
    return;
  }

  console.log(`Sending email to: ${config.recipients.to.join(', ')} ...`);
  await sendEmail(config.gmail, config.recipients, subject, text, html);
  console.log('Email sent successfully!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
