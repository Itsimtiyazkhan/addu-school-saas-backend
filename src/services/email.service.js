const sgMail = require('@sendgrid/mail');
const nodemailer = require('nodemailer');

// Initialize SendGrid if key present
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Fallback nodemailer transporter (for dev/testing)
const devTransporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: { user: 'ethereal_user', pass: 'ethereal_pass' },
});

// ─── HTML Templates ───────────────────────────────────────────────────────────
const baseTemplate = (title, content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #1a2544; padding: 32px; text-align: center; }
    .header h1 { color: #f5a623; margin: 0; font-size: 24px; }
    .header p { color: rgba(255,255,255,0.7); margin: 8px 0 0; font-size: 14px; }
    .body { padding: 32px; }
    .body h2 { color: #1a2544; font-size: 20px; margin-top: 0; }
    .body p { color: #555; line-height: 1.6; }
    .btn { display: inline-block; background: #f5a623; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0; }
    .otp { font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #1a2544; text-align: center; padding: 20px; background: #f9f9f9; border-radius: 8px; margin: 20px 0; }
    .footer { background: #f9f9f9; padding: 20px 32px; text-align: center; font-size: 12px; color: #999; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .info-label { color: #888; font-size: 13px; }
    .info-value { color: #333; font-size: 13px; font-weight: 600; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-red { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Akkhor™</h1>
      <p>School Management System</p>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Akkhor School Management System. All rights reserved.</p>
      <p>This is an automated email, please do not reply.</p>
    </div>
  </div>
</body>
</html>`;

const templates = {
  verifyEmail: (data) => ({
    subject: 'Verify Your Email - Akkhor',
    html: baseTemplate('Verify Email', `
      <h2>Verify Your Email Address</h2>
      <p>Hello <strong>${data.name}</strong>,</p>
      <p>Welcome to Akkhor School Management System! Please verify your email address using the OTP below:</p>
      <div class="otp">${data.otp}</div>
      <p>This OTP expires in <strong>${process.env.OTP_EXPIRY_MINUTES || 10} minutes</strong>.</p>
      <p>If you didn't create an account, please ignore this email.</p>
    `),
  }),

  passwordReset: (data) => ({
    subject: 'Password Reset Request - Akkhor',
    html: baseTemplate('Password Reset', `
      <h2>Reset Your Password</h2>
      <p>Hello <strong>${data.name}</strong>,</p>
      <p>We received a request to reset your password. Use the OTP below:</p>
      <div class="otp">${data.otp}</div>
      <p>This OTP expires in <strong>10 minutes</strong>.</p>
      <p>If you didn't request a password reset, please contact your school admin immediately.</p>
    `),
  }),

  welcomeSchool: (data) => ({
    subject: `Welcome to Akkhor - ${data.schoolName} is ready!`,
    html: baseTemplate('Welcome', `
      <h2>🎉 Your School is Ready!</h2>
      <p>Hello <strong>${data.adminName}</strong>,</p>
      <p>Your school has been successfully registered on Akkhor. Here are your login details:</p>
      <br/>
      <div class="info-row"><span class="info-label">School Name</span><span class="info-value">${data.schoolName}</span></div>
      <div class="info-row"><span class="info-label">School Code</span><span class="info-value">${data.schoolCode}</span></div>
      <div class="info-row"><span class="info-label">Admin Email</span><span class="info-value">${data.email}</span></div>
      <div class="info-row"><span class="info-label">Plan</span><span class="info-value">${data.plan}</span></div>
      <br/>
      <a href="${process.env.FRONTEND_URL}/login" class="btn">Login to Dashboard</a>
      <p style="color:#888;font-size:12px;">Keep your school code safe - your teachers and students need it to login.</p>
    `),
  }),

  feeReminder: (data) => ({
    subject: `Fee Payment Reminder - ${data.studentName}`,
    html: baseTemplate('Fee Reminder', `
      <h2>Fee Payment Reminder</h2>
      <p>Dear <strong>${data.parentName}</strong>,</p>
      <p>This is a reminder that the following fee is due:</p>
      <br/>
      <div class="info-row"><span class="info-label">Student</span><span class="info-value">${data.studentName}</span></div>
      <div class="info-row"><span class="info-label">Class</span><span class="info-value">${data.className}</span></div>
      <div class="info-row"><span class="info-label">Fee Type</span><span class="info-value">${data.feeType}</span></div>
      <div class="info-row"><span class="info-label">Amount Due</span><span class="info-value" style="color:#e53e3e;">$${data.amount}</span></div>
      <div class="info-row"><span class="info-label">Due Date</span><span class="info-value">${data.dueDate}</span></div>
      <br/>
      <a href="${process.env.FRONTEND_URL}/dashboard/account/fees" class="btn">Pay Now</a>
    `),
  }),

  attendanceAlert: (data) => ({
    subject: `Attendance Alert - ${data.studentName} was ${data.status}`,
    html: baseTemplate('Attendance Alert', `
      <h2>Attendance Update</h2>
      <p>Dear <strong>${data.parentName}</strong>,</p>
      <p>This is to inform you about your child's attendance:</p>
      <br/>
      <div class="info-row"><span class="info-label">Student</span><span class="info-value">${data.studentName}</span></div>
      <div class="info-row"><span class="info-label">Date</span><span class="info-value">${data.date}</span></div>
      <div class="info-row"><span class="info-label">Status</span><span class="info-value">
        <span class="badge ${data.status === 'absent' ? 'badge-red' : 'badge-green'}">${data.status.toUpperCase()}</span>
      </span></div>
      <div class="info-row"><span class="info-label">Class</span><span class="info-value">${data.className}</span></div>
      <br/>
      <p>If you have any questions, please contact the school.</p>
    `),
  }),

  examSchedule: (data) => ({
    subject: `Exam Schedule - ${data.examName}`,
    html: baseTemplate('Exam Schedule', `
      <h2>Upcoming Exam Notification</h2>
      <p>Dear <strong>${data.studentName}</strong>,</p>
      <p>You have an upcoming exam scheduled:</p>
      <br/>
      <div class="info-row"><span class="info-label">Exam</span><span class="info-value">${data.examName}</span></div>
      <div class="info-row"><span class="info-label">Subject</span><span class="info-value">${data.subject}</span></div>
      <div class="info-row"><span class="info-label">Date</span><span class="info-value">${data.date}</span></div>
      <div class="info-row"><span class="info-label">Time</span><span class="info-value">${data.time}</span></div>
      <div class="info-row"><span class="info-label">Class</span><span class="info-value">${data.className}</span></div>
      <br/>
      <p>Best of luck! 📚</p>
    `),
  }),

  newNotice: (data) => ({
    subject: `New Notice - ${data.title}`,
    html: baseTemplate('Notice', `
      <h2>New Notice from School</h2>
      <p>Dear <strong>${data.recipientName}</strong>,</p>
      <p>A new notice has been posted:</p>
      <br/>
      <div style="background:#f9f9f9;border-left:4px solid #f5a623;padding:16px;border-radius:4px;margin:16px 0;">
        <h3 style="margin:0 0 8px;color:#1a2544;">${data.title}</h3>
        <p style="margin:0;color:#555;">${data.details}</p>
        <p style="margin:8px 0 0;color:#888;font-size:12px;">Posted by ${data.postedBy} on ${data.date}</p>
      </div>
      <a href="${process.env.FRONTEND_URL}/dashboard/notices" class="btn">View Notice</a>
    `),
  }),

  paymentConfirmation: (data) => ({
    subject: `Payment Confirmed - Receipt #${data.receiptNo}`,
    html: baseTemplate('Payment Receipt', `
      <h2>✅ Payment Confirmed</h2>
      <p>Dear <strong>${data.parentName}</strong>,</p>
      <p>We have received your payment. Here is your receipt:</p>
      <br/>
      <div class="info-row"><span class="info-label">Receipt No</span><span class="info-value">#${data.receiptNo}</span></div>
      <div class="info-row"><span class="info-label">Student</span><span class="info-value">${data.studentName}</span></div>
      <div class="info-row"><span class="info-label">Fee Type</span><span class="info-value">${data.feeType}</span></div>
      <div class="info-row"><span class="info-label">Amount Paid</span><span class="info-value" style="color:#065f46;">$${data.amount}</span></div>
      <div class="info-row"><span class="info-label">Payment Date</span><span class="info-value">${data.date}</span></div>
      <div class="info-row"><span class="info-label">Method</span><span class="info-value">${data.method}</span></div>
      <br/>
      <p style="color:#888;font-size:12px;">Please keep this email as your payment receipt.</p>
    `),
  }),

  subscriptionConfirmed: (data) => ({
    subject: `Subscription Confirmed - ${data.plan} Plan`,
    html: baseTemplate('Subscription', `
      <h2>🎉 Subscription Activated!</h2>
      <p>Hello <strong>${data.adminName}</strong>,</p>
      <p>Your <strong>${data.plan}</strong> subscription has been activated for <strong>${data.schoolName}</strong>.</p>
      <br/>
      <div class="info-row"><span class="info-label">Plan</span><span class="info-value">${data.plan}</span></div>
      <div class="info-row"><span class="info-label">Amount</span><span class="info-value">$${data.amount}/month</span></div>
      <div class="info-row"><span class="info-label">Next Billing</span><span class="info-value">${data.nextBilling}</span></div>
      <br/>
      <a href="${process.env.FRONTEND_URL}/dashboard" class="btn">Go to Dashboard</a>
    `),
  }),
};

// ─── Send function ─────────────────────────────────────────────────────────────
const sendEmail = async ({ to, templateName, data, attachments = [] }) => {
  try {
    const template = templates[templateName];
    if (!template) throw new Error(`Unknown email template: ${templateName}`);
    const { subject, html } = template(data);

    if (process.env.SENDGRID_API_KEY && process.env.NODE_ENV !== 'test') {
      await sgMail.send({
        to,
        from: { email: process.env.EMAIL_FROM || 'noreply@akkhor.edu', name: process.env.EMAIL_FROM_NAME || 'Akkhor' },
        subject,
        html,
        attachments: attachments.map(a => ({
          content: a.content.toString('base64'),
          filename: a.filename,
          type: a.type || 'application/pdf',
          disposition: 'attachment',
        })),
      });
      console.log(`📧 Email sent via SendGrid: ${templateName} → ${to}`);
    } else {
      // Dev: log to console
      console.log(`📧 [DEV] Email: ${templateName} → ${to} | Subject: ${subject}`);
    }
    return { success: true };
  } catch (err) {
    console.error('Email send error:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── Bulk send ─────────────────────────────────────────────────────────────────
const sendBulkEmails = async (recipients) => {
  const results = await Promise.allSettled(recipients.map(r => sendEmail(r)));
  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`📧 Bulk email: ${sent}/${recipients.length} sent`);
  return results;
};

module.exports = { sendEmail, sendBulkEmails, templates };
