'use strict';

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const TEXT_TEMPLATE = path.join(__dirname, '../templates/email.ejs');
const HTML_TEMPLATE = path.join(__dirname, '../templates/email.html.ejs');

function buildEmail(violations, start, end, config) {
  const { name, department, phone, manager_name } = config.employee;
  const reason = config.default_reason || 'Lý do cá nhân';

  const half = start.getDate() === 1 ? '1' : '2';
  const month = String(start.getMonth() + 1).padStart(2, '0');
  const year = start.getFullYear();

  const subject = `Giải trình chấm công kỳ ${half} tháng ${month}/${year} - ${name}`;

  const formatDate = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

  const describe = (v) => {
    if (v.absent) return 'Không có dữ liệu check-in và check-out';
    const parts = [];
    if (v.noCheckin) parts.push('thiếu check-in');
    else if (v.lateMinutes > 0) parts.push(`check-in lúc ${v.record.checkIn} (muộn ${v.lateMinutes} phút)`);
    if (v.noCheckout) parts.push('thiếu check-out');
    if (v.missingHours > 0) {
      const h = Math.floor(v.missingHours);
      const m = Math.round((v.missingHours - h) * 60);
      parts.push(`thiếu ${m ? `${h} tiếng ${m} phút` : `${h} tiếng`} làm việc`);
    }
    return parts.join(', ');
  };

  const data = {
    managerName: manager_name || 'anh/chị',
    name,
    department,
    phone: phone || '',
    violations,
    reason,
    formatDate,
    describe,
  };

  const text = ejs.render(fs.readFileSync(TEXT_TEMPLATE, 'utf8'), data);
  const html = ejs.render(fs.readFileSync(HTML_TEMPLATE, 'utf8'), data);

  return { subject, text, html };
}

module.exports = { buildEmail };
