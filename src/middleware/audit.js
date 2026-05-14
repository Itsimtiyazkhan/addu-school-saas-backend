const { query } = require('../db');

const auditLog = async (req, action, entity, entityId, oldData = null, newData = null) => {
  try {
    if (!req.user) return;
    await query(
      `INSERT INTO audit_logs (school_id, user_id, action, entity, entity_id, old_data, new_data, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.schoolId,
        req.user.id,
        action,
        entity,
        entityId || null,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        req.ip,
        req.headers['user-agent']?.slice(0, 200),
      ]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
};

// Audit middleware factory
const withAudit = (action, entity) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body?.success && req.user) {
      const entityId = body.data?.id || req.params.id;
      auditLog(req, action, entity, entityId, null, body.data).catch(() => {});
    }
    return originalJson(body);
  };
  next();
};

// GET audit logs
const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, userId } = req.query;
    const offset = (page - 1) * limit;
    let cond = ['a.school_id = $1'];
    let params = [req.schoolId];
    let i = 2;
    if (action) { cond.push(`a.action = $${i}`); params.push(action); i++; }
    if (userId) { cond.push(`a.user_id = $${i}`); params.push(userId); i++; }

    const result = await query(`
      SELECT a.*, CONCAT(u.first_name,' ',u.last_name) as user_name, u.role
      FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
      WHERE ${cond.join(' AND ')}
      ORDER BY a.created_at DESC
      LIMIT $${i} OFFSET $${i+1}
    `, [...params, limit, offset]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { auditLog, withAudit, getAuditLogs };
