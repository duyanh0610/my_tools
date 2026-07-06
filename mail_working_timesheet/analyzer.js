'use strict';

const WEEKDAY_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/**
 * @typedef {{
 *   record: import('./scraper').TimesheetRecord,
 *   weekdayVi: string,
 *   absent: boolean,
 *   noCheckin: boolean,
 *   noCheckout: boolean,
 *   lateMinutes: number,
 *   missingHours: number
 * }} Violation
 */

/**
 * @param {import('./scraper').TimesheetRecord[]} records
 * @param {object} schedule
 * @returns {Violation[]}
 */
function analyzeTimesheet(records, schedule) {
  const latestCI = parseTime(schedule.latest_checkin);
  const minHours = schedule.min_work_hours;
  const grace = schedule.grace_period_minutes ?? 0;
  const lunchBreak = schedule.lunch_break_hours ?? 1.5;

  const violations = [];

  for (const r of records) {
    const dow = r.date.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue;

    const weekdayVi = WEEKDAY_VI[dow];
    const v = {
      record: r,
      weekdayVi,
      absent: false,
      noCheckin: false,
      noCheckout: false,
      lateMinutes: 0,
      missingHours: 0,
    };

    if (!r.checkIn && !r.checkOut) {
      v.absent = true;
    } else {
      if (!r.checkIn) {
        v.noCheckin = true;
      } else {
        const ci = parseTime(r.checkIn);
        if (ci !== null && latestCI !== null) {
          const deadlineMs = latestCI + grace * 60_000;
          if (ci > deadlineMs) {
            v.lateMinutes = Math.floor((ci - latestCI) / 60_000);
          }
        }
      }

      if (!r.checkOut) {
        v.noCheckout = true;
      } else if (r.checkIn) {
        const ci = parseTime(r.checkIn);
        const co = parseTime(r.checkOut);
        if (ci !== null && co !== null && co > ci) {
          const totalH = (co - ci) / 3_600_000;
          const workH = totalH - lunchBreak;
          if (workH < minHours) {
            v.missingHours = Math.round((minHours - workH) * 100) / 100;
          }
        }
      }
    }

    const hasIssue = v.absent || v.noCheckin || v.noCheckout || v.lateMinutes > 0 || v.missingHours > 0;
    if (hasIssue) violations.push(v);
  }

  return violations;
}

/** Chuyển "HH:MM" thành milliseconds từ đầu ngày */
function parseTime(text) {
  if (!text) return null;
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return (+m[1] * 60 + +m[2]) * 60_000;
}

module.exports = { analyzeTimesheet };
