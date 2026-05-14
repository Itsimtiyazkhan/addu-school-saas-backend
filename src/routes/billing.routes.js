const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { createCheckoutSession, createPortalSession, handleWebhook, getSubscription, PLANS } = require('../services/stripe.service');

// GET /api/billing/plans
router.get('/plans', (req, res) => {
  res.json({ success: true, data: PLANS });
});

// GET /api/billing/subscription
router.get('/subscription', authenticate, async (req, res) => {
  try {
    const data = await getSubscription(req.schoolId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/billing/checkout
router.post('/checkout', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ success: false, message: 'Plan required' });
    const session = await createCheckoutSession(req.schoolId, plan);
    res.json({ success: true, data: { url: session.url, sessionId: session.id } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/billing/portal
router.post('/portal', authenticate, authorize('admin'), async (req, res) => {
  try {
    const session = await createPortalSession(req.schoolId);
    res.json({ success: true, data: { url: session.url } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/billing/webhook (Stripe raw body)
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const result = await handleWebhook(req.body, signature);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/billing/history
router.get('/history', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { query } = require('../db');
    const result = await query(
      'SELECT * FROM billing_history WHERE school_id=$1 ORDER BY billing_date DESC LIMIT 50',
      [req.schoolId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
