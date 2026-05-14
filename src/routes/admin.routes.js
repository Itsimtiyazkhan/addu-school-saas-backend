const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { getAllSchools, getPlatformStats, toggleSchool, changePlan, deleteSchool } = require('../controllers/admin.controller');
const { getAuditLogs } = require('../middleware/audit');

const SA = ['super_admin', 'admin'];

router.use(authenticate);

router.get('/stats', getPlatformStats);
router.get('/schools', getAllSchools);
router.patch('/schools/:id/toggle', toggleSchool);
router.patch('/schools/:id/plan', changePlan);
router.delete('/schools/:id', deleteSchool);
router.get('/audit-logs', getAuditLogs);

module.exports = router;
