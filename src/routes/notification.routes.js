const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { sendFeeReminders, notifyNewNotice } = require('../services/notification.service');
const { generateFeeReceipt, generateAttendanceSheet, generateReportCard, generateSchoolReport } = require('../services/pdf.service');
const { query } = require('../db');
const { uploadPhoto, processUpload, handleUploadError } = require('../services/upload.service');
const { sendVerificationEmail, sendPasswordResetEmail, verifyOTP } = require('../services/otp.service');
const bcrypt = require('bcryptjs');

// ─── In-app notifications ──────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch('/read-all', authenticate, async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false', [req.user.id]);
    res.json({ success: true, data: { count: +result.rows[0].count } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── PDF Downloads ─────────────────────────────────────────────────────────────
router.get('/pdf/fee-receipt/:feeId', authenticate, async (req, res) => {
  try {
    const pdfBuffer = await generateFeeReceipt(req.params.feeId, req.schoolId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fee-receipt-${req.params.feeId.slice(0,8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pdf/attendance', authenticate, async (req, res) => {
  try {
    const { classId, month, year } = req.query;
    if (!classId || !month || !year) return res.status(400).json({ success: false, message: 'classId, month, year required' });
    const pdfBuffer = await generateAttendanceSheet(classId, +month, +year, req.schoolId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}-${year}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pdf/report-card/:studentId', authenticate, async (req, res) => {
  try {
    const pdfBuffer = await generateReportCard(req.params.studentId, req.schoolId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-card-${req.params.studentId.slice(0,8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pdf/school-report', authenticate, authorize('admin'), async (req, res) => {
  try {
    const pdfBuffer = await generateSchoolReport(req.schoolId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="school-report.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── File Upload ───────────────────────────────────────────────────────────────
router.post('/upload/photo', authenticate, (req, res, next) => {
  uploadPhoto(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const result = await processUpload(req.file, 'photos');
    // Update user photo
    await query('UPDATE users SET photo_url=$1, photo_public_id=$2 WHERE id=$3', [result.url, result.publicId, req.user.id]);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Email verify + Password reset ────────────────────────────────────────────
router.post('/send-verification', authenticate, async (req, res) => {
  try {
    await sendVerificationEmail(req.user);
    res.json({ success: true, message: 'Verification OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

router.post('/verify-email', authenticate, async (req, res) => {
  try {
    const { otp } = req.body;
    const result = await verifyOTP(req.user.id, otp, 'email_verify');
    if (!result.valid) return res.status(400).json({ success: false, message: result.message });
    await query('UPDATE users SET email_verified=true WHERE id=$1', [req.user.id]);
    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email, schoolCode } = req.body;
    const result = await query(
      'SELECT u.* FROM users u JOIN schools s ON u.school_id=s.id WHERE u.email=$1 AND s.code=$2',
      [email, schoolCode]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    await sendPasswordResetEmail(result.rows[0]);
    res.json({ success: true, message: 'Password reset OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword, schoolCode } = req.body;
    const userResult = await query(
      'SELECT u.* FROM users u JOIN schools s ON u.school_id=s.id WHERE u.email=$1 AND s.code=$2',
      [email, schoolCode]
    );
    if (!userResult.rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    const user = userResult.rows[0];
    const check = await verifyOTP(user.id, otp, 'password_reset');
    if (!check.valid) return res.status(400).json({ success: false, message: check.message });
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Fee reminders (cron/manual trigger) ─────────────────────────────────────
router.post('/send-fee-reminders', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await sendFeeReminders(req.schoolId);
    res.json({ success: true, message: `Fee reminders sent to ${result.sent} parents` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
