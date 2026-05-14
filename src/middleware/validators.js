const { body, param, query, validationResult } = require('express-validator');

// Run validation and return errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

// ─── Validators ────────────────────────────────────────────────────────────────
const loginValidator = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
  validate,
];

const registerSchoolValidator = [
  body('schoolName').trim().notEmpty().withMessage('School name required'),
  body('schoolCode').trim().isAlphanumeric().isLength({ min: 4, max: 20 }).withMessage('School code: 4-20 alphanumeric chars'),
  body('adminEmail').isEmail().normalizeEmail().withMessage('Valid admin email required'),
  body('adminPassword').isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/).withMessage('Password: min 8 chars, one uppercase, one number'),
  validate,
];

const studentValidator = [
  body('firstName').trim().notEmpty().withMessage('First name required'),
  body('lastName').trim().notEmpty().withMessage('Last name required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Gender must be Male/Female/Other'),
  body('rollNumber').trim().notEmpty().withMessage('Roll number required'),
  validate,
];

const teacherValidator = [
  body('firstName').trim().notEmpty().withMessage('First name required'),
  body('lastName').trim().notEmpty().withMessage('Last name required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Gender required'),
  validate,
];

const feeValidator = [
  body('studentId').isUUID().withMessage('Valid student ID required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be positive'),
  body('feeType').trim().notEmpty().withMessage('Fee type required'),
  validate,
];

const examValidator = [
  body('name').trim().notEmpty().withMessage('Exam name required'),
  body('examDate').isDate().withMessage('Valid exam date required'),
  validate,
];

const noticeValidator = [
  body('title').trim().notEmpty().isLength({ max: 255 }).withMessage('Title required (max 255 chars)'),
  body('details').trim().notEmpty().withMessage('Notice details required'),
  validate,
];

const changePasswordValidator = [
  body('currentPassword').notEmpty().withMessage('Current password required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password min 8 chars'),
  validate,
];

const resetPasswordValidator = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password min 8 chars'),
  validate,
];

module.exports = {
  validate,
  loginValidator,
  registerSchoolValidator,
  studentValidator,
  teacherValidator,
  feeValidator,
  examValidator,
  noticeValidator,
  changePasswordValidator,
  resetPasswordValidator,
};
