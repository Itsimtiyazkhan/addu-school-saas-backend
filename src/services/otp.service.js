const crypto = require('crypto');
const { query } = require('../db');
const { sendEmail } = require('./email.service');

// Generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Store OTP in DB
const createOTP = async (userId, type) => {
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60 * 1000);

  // Delete any existing OTP for this user+type
  await query('DELETE FROM otps WHERE user_id = $1 AND type = $2', [userId, type]);

  await query(
    'INSERT INTO otps (user_id, otp, type, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, otp, type, expiresAt]
  );
  return otp;
};

// Verify OTP
const verifyOTP = async (userId, otp, type) => {
  const result = await query(
    'SELECT * FROM otps WHERE user_id = $1 AND otp = $2 AND type = $3 AND expires_at > NOW() AND used = false',
    [userId, otp, type]
  );

  if (!result.rows.length) {
    return { valid: false, message: 'Invalid or expired OTP' };
  }

  // Mark as used
  await query('UPDATE otps SET used = true WHERE id = $1', [result.rows[0].id]);
  return { valid: true };
};

// Send verification email
const sendVerificationEmail = async (user) => {
  const otp = await createOTP(user.id, 'email_verify');
  await sendEmail({
    to: user.email,
    templateName: 'verifyEmail',
    data: { name: `${user.first_name} ${user.last_name}`, otp },
  });
  return otp;
};

// Send password reset email
const sendPasswordResetEmail = async (user) => {
  const otp = await createOTP(user.id, 'password_reset');
  await sendEmail({
    to: user.email,
    templateName: 'passwordReset',
    data: { name: `${user.first_name} ${user.last_name}`, otp },
  });
  return otp;
};

module.exports = { generateOTP, createOTP, verifyOTP, sendVerificationEmail, sendPasswordResetEmail };
