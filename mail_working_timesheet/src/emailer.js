'use strict';

const nodemailer = require('nodemailer');

async function sendEmail(gmailConfig, recipients, subject, text, html) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailConfig.sender_email,
      pass: gmailConfig.app_password,
    },
  });

  await transporter.sendMail({
    from: gmailConfig.sender_email,
    to: recipients.to.join(', '),
    cc: (recipients.cc || []).join(', ') || undefined,
    subject,
    text,
    html,
  });
}

module.exports = { sendEmail };
