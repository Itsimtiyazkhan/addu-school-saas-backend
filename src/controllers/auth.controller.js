const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const generateToken = (userId, role, schoolId) =>
  jwt.sign({ userId, role, schoolId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password, schoolCode } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    let userQuery, params;
    if (schoolCode) {
      userQuery = `
        SELECT u.*, s.name as school_name, s.code as school_code, s.plan, s.logo_url as school_logo
        FROM users u
        JOIN schools s ON u.school_id = s.id
        WHERE u.email = $1 AND s.code = $2 AND u.is_active = true AND s.is_active = true
      `;
      params = [email, schoolCode];
    } else {
      userQuery = `
        SELECT u.*, s.name as school_name, s.code as school_code, s.plan, s.logo_url as school_logo
        FROM users u
        JOIN schools s ON u.school_id = s.id
        WHERE u.email = $1 AND u.role = 'super_admin' AND u.is_active = true
      `;
      params = [email];
    }

    const result = await query(userQuery, params);
    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = generateToken(user.id, user.role, user.school_id);
    const { password_hash, ...userSafe } = user;

    res.json({
      success: true,
      message: 'Login successful',
      data: { token, user: userSafe },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/auth/register-school (SaaS: create new school + admin)
const registerSchool = async (req, res) => {
  const client = require('../db').getClient ? await require('../db').getClient() : null;
  try {
    const { schoolName, schoolCode, adminEmail, adminPassword, adminFirstName, adminLastName, phone, address } = req.body;
    if (!schoolName || !schoolCode || !adminEmail || !adminPassword) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const exists = await query('SELECT id FROM schools WHERE code = $1', [schoolCode]);
    if (exists.rows.length) {
      return res.status(409).json({ success: false, message: 'School code already exists' });
    }

    const schoolRes = await query(
      `INSERT INTO schools (name, code, address, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [schoolName, schoolCode, address || '', phone || '', adminEmail]
    );
    const schoolId = schoolRes.rows[0].id;

    const hash = await bcrypt.hash(adminPassword, 12);
    const userRes = await query(
      `INSERT INTO users (school_id, first_name, last_name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,'admin') RETURNING id`,
      [schoolId, adminFirstName || 'Admin', adminLastName || 'User', adminEmail, hash]
    );

    const token = generateToken(userRes.rows[0].id, 'admin', schoolId);
    res.status(201).json({
      success: true,
      message: 'School registered successfully',
      data: { token, schoolId, schoolCode },
    });
  } catch (err) {
    console.error('Register school error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.school_id, u.first_name, u.last_name, u.email, u.role,
             u.photo_url, u.phone, u.address, u.gender, u.date_of_birth,
             u.last_login, u.created_at,
             s.name as school_name, s.code as school_code, s.plan,
             s.session_year, s.language, s.logo_url as school_logo
      FROM users u
      JOIN schools s ON u.school_id = s.id
      WHERE u.id = $1
    `, [req.user.id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PUT /api/auth/change-password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValid) return res.status(400).json({ success: false, message: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { login, registerSchool, getMe, changePassword };
