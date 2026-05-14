const router = require('express').Router();
const { query } = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ─── Super Admin Auth ──────────────────────────────────────────────────────────
const superAdminAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'super_admin') return res.status(403).json({ success: false, message: 'Not super admin' });
    req.superAdmin = decoded;
    next();
  } catch { res.status(401).json({ success: false, message: 'Invalid token' }); }
};

// POST /api/super-admin/auth/login
router.post('/auth/login', async (req, res) => {
  console.log(req, res , 'user test');
  
  try {
    const { email, password } = req.body;

    const result = await query('SELECT * FROM super_admins WHERE email=$1 AND is_active=true', [email]);
    if (!result.rows.length) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    await query('UPDATE super_admins SET last_login=NOW() WHERE id=$1', [admin.id]);
    const token = jwt.sign({ id: admin.id, email: admin.email, role: 'super_admin', name: admin.name }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ success: true, data: { token, admin: { id: admin.id, email: admin.email, name: admin.name } } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Platform Stats ───────────────────────────────────────────────────────────
router.get('/stats', superAdminAuth, async (req, res) => {
  try {
    const [schools, users, revenue, tickets, leads, todaySchools] = await Promise.all([
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE is_active) as active, COUNT(*) FILTER(WHERE plan='pro') as pro, COUNT(*) FILTER(WHERE plan='enterprise') as enterprise, COUNT(*) FILTER(WHERE created_at >= NOW()-INTERVAL'30 days') as new_this_month FROM schools`),
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE role='student') as students, COUNT(*) FILTER(WHERE role='teacher') as teachers FROM users`),
      query(`SELECT COALESCE(SUM(amount),0) as total, COALESCE(SUM(amount) FILTER(WHERE billing_date >= NOW()-INTERVAL'30 days'),0) as this_month FROM billing_history WHERE status='paid'`),
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE status='open') as open FROM support_tickets`),
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE status='converted') as converted FROM crm_leads`),
      query(`SELECT COUNT(*) FROM schools WHERE created_at >= CURRENT_DATE`),
    ]);
    res.json({
      success: true, data: {
        schools: schools.rows[0],
        users: users.rows[0],
        revenue: revenue.rows[0],
        tickets: tickets.rows[0],
        leads: leads.rows[0],
        todaySignups: +todaySchools.rows[0].count,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Schools Management ───────────────────────────────────────────────────────
router.get('/schools', superAdminAuth, async (req, res) => {
  try {
    const { page=1, limit=20, search, plan, status } = req.query;
    const offset = (page-1)*limit;
    let cond=['1=1'], params=[], i=1;
    if (search) { cond.push(`(s.name ILIKE $${i} OR s.code ILIKE $${i} OR s.email ILIKE $${i})`); params.push(`%${search}%`); i++; }
    if (plan) { cond.push(`s.plan=$${i}`); params.push(plan); i++; }
    if (status === 'active') { cond.push(`s.is_active=true`); }
    if (status === 'inactive') { cond.push(`s.is_active=false`); }
    const result = await query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM users WHERE school_id=s.id AND role='student') as students,
        (SELECT COUNT(*) FROM users WHERE school_id=s.id AND role='teacher') as teachers,
        (SELECT COUNT(*) FROM users WHERE school_id=s.id) as total_users,
        (SELECT email FROM users WHERE school_id=s.id AND role='admin' LIMIT 1) as admin_email
      FROM schools s WHERE ${cond.join(' AND ')}
      ORDER BY s.created_at DESC LIMIT $${i} OFFSET $${i+1}
    `, [...params, limit, offset]);
    const count = await query(`SELECT COUNT(*) FROM schools s WHERE ${cond.join(' AND ')}`, params);
    res.json({ success: true, data: result.rows, pagination: { total: +count.rows[0].count, page: +page, limit: +limit, pages: Math.ceil(count.rows[0].count/limit) } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.get('/schools/:id', superAdminAuth, async (req, res) => {
  try {
    const [school, users, fees, exams] = await Promise.all([
      query(`SELECT s.*, (SELECT email FROM users WHERE school_id=s.id AND role='admin' LIMIT 1) as admin_email FROM schools s WHERE s.id=$1`, [req.params.id]),
      query(`SELECT role, COUNT(*) FROM users WHERE school_id=$1 GROUP BY role`, [req.params.id]),
      query(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) FILTER(WHERE status='Paid') as paid, COUNT(*) FILTER(WHERE status='Due') as due FROM fee_collections WHERE school_id=$1`, [req.params.id]),
      query(`SELECT COUNT(*) FROM exams WHERE school_id=$1`, [req.params.id]),
    ]);
    if (!school.rows.length) return res.status(404).json({ success: false, message: 'School not found' });
    const roleMap = {};
    users.rows.forEach(r => roleMap[r.role] = +r.count);
    res.json({ success: true, data: { ...school.rows[0], userBreakdown: roleMap, fees: fees.rows[0], exams: +exams.rows[0].count } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.patch('/schools/:id/toggle', superAdminAuth, async (req, res) => {
  try {
    const r = await query('UPDATE schools SET is_active=NOT is_active WHERE id=$1 RETURNING id,name,is_active', [req.params.id]);
    res.json({ success: true, data: r.rows[0], message: `School ${r.rows[0].is_active ? 'activated' : 'deactivated'}` });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.patch('/schools/:id/plan', superAdminAuth, async (req, res) => {
  try {
    const r = await query('UPDATE schools SET plan=$1 WHERE id=$2 RETURNING id,name,plan', [req.body.plan, req.params.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.delete('/schools/:id', superAdminAuth, async (req, res) => {
  try {
    await query('DELETE FROM schools WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'School permanently deleted' });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// Login as school admin (impersonate)
router.post('/schools/:id/login-as', superAdminAuth, async (req, res) => {
  try {
    const adminUser = await query(`SELECT u.* FROM users u WHERE u.school_id=$1 AND u.role='admin' LIMIT 1`, [req.params.id]);
    if (!adminUser.rows.length) return res.status(404).json({ success: false, message: 'No admin found for this school' });
    const u = adminUser.rows[0];
    const token = jwt.sign({ userId: u.id, role: u.role, schoolId: u.school_id, impersonated: true }, process.env.JWT_SECRET, { expiresIn: '2h' });
    res.json({ success: true, data: { token, user: { id: u.id, first_name: u.first_name, last_name: u.last_name, email: u.email, role: u.role, school_id: u.school_id } } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Billing & Coupons ────────────────────────────────────────────────────────
router.get('/billing/history', superAdminAuth, async (req, res) => {
  try {
    const r = await query(`SELECT bh.*, s.name as school_name FROM billing_history bh LEFT JOIN schools s ON bh.school_id=s.id ORDER BY bh.billing_date DESC LIMIT 100`);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.get('/coupons', superAdminAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.post('/coupons', superAdminAuth, async (req, res) => {
  try {
    const { code, discountType, discountValue, maxUses, validUntil, applicablePlan } = req.body;
    const r = await query(`INSERT INTO coupons (code,discount_type,discount_value,max_uses,valid_until,applicable_plan) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code.toUpperCase(), discountType||'percent', discountValue, maxUses||100, validUntil||null, applicablePlan||null]);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ success: false, message: 'Coupon code already exists' });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.delete('/coupons/:id', superAdminAuth, async (req, res) => {
  try {
    await query('DELETE FROM coupons WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Support Tickets ──────────────────────────────────────────────────────────
router.get('/tickets', superAdminAuth, async (req, res) => {
  try {
    const { status, priority } = req.query;
    let cond=['1=1'], params=[], i=1;
    if (status) { cond.push(`t.status=$${i}`); params.push(status); i++; }
    if (priority) { cond.push(`t.priority=$${i}`); params.push(priority); i++; }
    const r = await query(`
      SELECT t.*, s.name as school_name, CONCAT(u.first_name,' ',u.last_name) as user_name
      FROM support_tickets t LEFT JOIN schools s ON t.school_id=s.id LEFT JOIN users u ON t.user_id=u.id
      WHERE ${cond.join(' AND ')} ORDER BY t.created_at DESC LIMIT 100
    `, params);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.patch('/tickets/:id', superAdminAuth, async (req, res) => {
  try {
    const { status, priority } = req.body;
    const r = await query(`UPDATE support_tickets SET status=$1,priority=$2,updated_at=NOW() ${status==='resolved'?',resolved_at=NOW()':''} WHERE id=$3 RETURNING *`, [status, priority, req.params.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Feature Flags ────────────────────────────────────────────────────────────
router.get('/features', superAdminAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM feature_flags ORDER BY name');
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.patch('/features/:id', superAdminAuth, async (req, res) => {
  try {
    const r = await query('UPDATE feature_flags SET is_enabled=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [req.body.isEnabled, req.params.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Broadcasts ───────────────────────────────────────────────────────────────
router.get('/broadcasts', superAdminAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM broadcasts ORDER BY created_at DESC');
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.post('/broadcasts', superAdminAuth, async (req, res) => {
  try {
    const { title, message, target, channel, scheduledAt } = req.body;
    const r = await query(`INSERT INTO broadcasts (title,message,target,channel,created_by,scheduled_at,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, message, target||'all', channel||'in_app', req.superAdmin.id, scheduledAt||null, scheduledAt?'scheduled':'sent']);
    // TODO: actually send emails/SMS here
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── CRM Leads ────────────────────────────────────────────────────────────────
router.get('/crm/leads', superAdminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const r = await query(`SELECT * FROM crm_leads ${status?'WHERE status=$1':''} ORDER BY created_at DESC`, status?[status]:[]);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.post('/crm/leads', superAdminAuth, async (req, res) => {
  try {
    const { schoolName, contactName, email, phone, country, city, studentCount, source, notes, followUpDate } = req.body;
    const r = await query(`INSERT INTO crm_leads (school_name,contact_name,email,phone,country,city,student_count,source,notes,follow_up_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [schoolName, contactName, email, phone, country, city, studentCount||null, source, notes, followUpDate||null]);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.patch('/crm/leads/:id', superAdminAuth, async (req, res) => {
  try {
    const { status, notes, followUpDate } = req.body;
    const r = await query('UPDATE crm_leads SET status=$1,notes=$2,follow_up_date=$3,updated_at=NOW() WHERE id=$4 RETURNING *', [status, notes, followUpDate||null, req.params.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Global Settings ──────────────────────────────────────────────────────────
router.get('/settings', superAdminAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM global_settings ORDER BY key');
    const settings = {};
    r.rows.forEach(row => { settings[row.key] = { value: row.value, description: row.description }; });
    res.json({ success: true, data: settings });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.put('/settings', superAdminAuth, async (req, res) => {
  try {
    const { settings } = req.body; // {key: value}
    for (const [key, value] of Object.entries(settings)) {
      await query('UPDATE global_settings SET value=$1,updated_at=NOW() WHERE key=$2', [value, key]);
    }
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
router.get('/audit-logs', superAdminAuth, async (req, res) => {
  try {
    const { page=1, limit=50 } = req.query;
    const offset = (page-1)*limit;
    const r = await query(`
      SELECT a.*, CONCAT(u.first_name,' ',u.last_name) as user_name, s.name as school_name
      FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id LEFT JOIN schools s ON a.school_id=s.id
      ORDER BY a.created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const count = await query('SELECT COUNT(*) FROM audit_logs');
    res.json({ success: true, data: r.rows, pagination: { total: +count.rows[0].count } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Reports & Analytics ──────────────────────────────────────────────────────
router.get('/analytics/growth', superAdminAuth, async (req, res) => {
  try {
    const r = await query(`
      SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as schools
      FROM schools GROUP BY month ORDER BY month DESC LIMIT 12
    `);
    const rev = await query(`
      SELECT DATE_TRUNC('month', billing_date) as month, SUM(amount) as revenue
      FROM billing_history WHERE status='paid' GROUP BY month ORDER BY month DESC LIMIT 12
    `);
    res.json({ success: true, data: { schoolGrowth: r.rows, revenue: rev.rows } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── API Keys ─────────────────────────────────────────────────────────────────
router.get('/api-keys', superAdminAuth, async (req, res) => {
  try {
    const r = await query(`SELECT ak.*, s.name as school_name FROM api_keys ak LEFT JOIN schools s ON ak.school_id=s.id ORDER BY ak.created_at DESC`);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.post('/api-keys', superAdminAuth, async (req, res) => {
  try {
    const { schoolId, name, permissions } = req.body;
    const rawKey = `ak_live_${crypto.randomBytes(24).toString('hex')}`;
    const prefix = rawKey.substring(0, 12);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    await query(`INSERT INTO api_keys (school_id,name,key_hash,key_prefix,permissions) VALUES ($1,$2,$3,$4,$5)`,
      [schoolId, name, keyHash, prefix, permissions||['read']]);
    res.status(201).json({ success: true, data: { key: rawKey, prefix, note: 'Save this key now — it will not be shown again!' } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

module.exports = router;
