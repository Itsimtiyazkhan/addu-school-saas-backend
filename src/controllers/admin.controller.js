const { query } = require('../db');
const { PLANS } = require('../services/stripe.service');

// GET /api/admin/schools - all schools
const getAllSchools = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, plan } = req.query;
    const offset = (page - 1) * limit;
    let cond = ['1=1'], params = [], i = 1;
    if (search) { cond.push(`(s.name ILIKE $${i} OR s.code ILIKE $${i})`); params.push(`%${search}%`); i++; }
    if (plan) { cond.push(`s.plan = $${i}`); params.push(plan); i++; }

    const result = await query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM users WHERE school_id = s.id AND role = 'student') as student_count,
        (SELECT COUNT(*) FROM users WHERE school_id = s.id AND role = 'teacher') as teacher_count,
        (SELECT COUNT(*) FROM users WHERE school_id = s.id) as total_users
      FROM schools s
      WHERE ${cond.join(' AND ')}
      ORDER BY s.created_at DESC
      LIMIT $${i} OFFSET $${i+1}
    `, [...params, limit, offset]);

    const count = await query(`SELECT COUNT(*) FROM schools s WHERE ${cond.join(' AND ')}`, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: { page: +page, limit: +limit, total: +count.rows[0].count },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/admin/stats - platform-wide stats
const getPlatformStats = async (req, res) => {
  try {
    const [schools, users, revenue, plans] = await Promise.all([
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE is_active) as active FROM schools`),
      query(`SELECT COUNT(*) as total, role, COUNT(*) FROM users GROUP BY role`),
      query(`SELECT COALESCE(SUM(amount),0) as total FROM billing_history WHERE status = 'paid'`),
      query(`SELECT plan, COUNT(*) FROM schools GROUP BY plan`),
    ]);

    const roleMap = {};
    users.rows.forEach(r => { roleMap[r.role] = +r.count; });

    const planMap = {};
    plans.rows.forEach(r => { planMap[r.plan] = +r.count; });

    res.json({
      success: true,
      data: {
        schools: { total: +schools.rows[0].total, active: +schools.rows[0].active },
        users: roleMap,
        totalRevenue: +revenue.rows[0].total,
        planDistribution: planMap,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/admin/schools/:id/toggle - activate/deactivate school
const toggleSchool = async (req, res) => {
  try {
    const result = await query(
      'UPDATE schools SET is_active = NOT is_active WHERE id = $1 RETURNING id, name, is_active',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'School not found' });
    res.json({ success: true, data: result.rows[0], message: `School ${result.rows[0].is_active ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/admin/schools/:id/plan - change plan
const changePlan = async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ success: false, message: 'Invalid plan' });
    const result = await query(
      'UPDATE schools SET plan = $1 WHERE id = $2 RETURNING id, name, plan',
      [plan, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/admin/schools/:id
const deleteSchool = async (req, res) => {
  try {
    await query('DELETE FROM schools WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'School deleted permanently' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { getAllSchools, getPlatformStats, toggleSchool, changePlan, deleteSchool };
