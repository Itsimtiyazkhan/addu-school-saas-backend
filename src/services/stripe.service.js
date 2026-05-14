const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const { query } = require('../db');
const { sendEmail } = require('./email.service');

// ─── Plans config ─────────────────────────────────────────────────────────────
const PLANS = {
  basic: {
    name: 'Basic',
    price: 0,
    priceId: process.env.STRIPE_BASIC_PRICE_ID,
    limits: { students: 100, teachers: 5, storage: '1GB' },
    features: ['Up to 100 students', '5 teachers', 'Basic reports', 'Email support'],
  },
  pro: {
    name: 'Pro',
    price: 49,
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    limits: { students: -1, teachers: 50, storage: '10GB' },
    features: ['Unlimited students', '50 teachers', 'Advanced reports', 'SMS alerts', 'Priority support', 'PDF exports'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 199,
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    limits: { students: -1, teachers: -1, storage: 'Unlimited' },
    features: ['Multi-campus', 'API access', 'Dedicated support', 'Custom domain', 'White-label', 'SLA guarantee'],
  },
};

// ─── Create Stripe customer for school ────────────────────────────────────────
const createCustomer = async (school, adminEmail, adminName) => {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder') {
    console.log('[Stripe] Skipped - no key configured');
    return null;
  }
  const customer = await stripe.customers.create({
    email: adminEmail,
    name: adminName,
    metadata: { school_id: school.id, school_code: school.code },
  });
  await query('UPDATE schools SET stripe_customer_id = $1 WHERE id = $2', [customer.id, school.id]);
  return customer;
};

// ─── Create checkout session ───────────────────────────────────────────────────
const createCheckoutSession = async (schoolId, planKey) => {
  const plan = PLANS[planKey];
  if (!plan) throw new Error('Invalid plan');
  if (plan.price === 0) throw new Error('Basic plan is free');

  const school = await query('SELECT * FROM schools WHERE id = $1', [schoolId]);
  if (!school.rows.length) throw new Error('School not found');
  const s = school.rows[0];

  const session = await stripe.checkout.sessions.create({
    customer: s.stripe_customer_id,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/dashboard/settings?upgrade=success&plan=${planKey}`,
    cancel_url: `${process.env.FRONTEND_URL}/dashboard/settings?upgrade=cancelled`,
    metadata: { school_id: schoolId, plan: planKey },
    subscription_data: { metadata: { school_id: schoolId, plan: planKey } },
  });

  return session;
};

// ─── Create billing portal session ────────────────────────────────────────────
const createPortalSession = async (schoolId) => {
  const school = await query('SELECT stripe_customer_id FROM schools WHERE id = $1', [schoolId]);
  if (!school.rows[0]?.stripe_customer_id) throw new Error('No Stripe customer found');

  const session = await stripe.billingPortal.sessions.create({
    customer: school.rows[0].stripe_customer_id,
    return_url: `${process.env.FRONTEND_URL}/dashboard/settings`,
  });
  return session;
};

// ─── Handle Stripe webhooks ───────────────────────────────────────────────────
const handleWebhook = async (rawBody, signature) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  const data = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const { school_id, plan } = data.metadata;
      await query(
        'UPDATE schools SET plan = $1, stripe_subscription_id = $2, plan_expires_at = NULL WHERE id = $3',
        [plan, data.subscription, school_id]
      );
      // Send confirmation email
      const schoolResult = await query(
        'SELECT s.*, u.email, u.first_name, u.last_name FROM schools s JOIN users u ON u.school_id = s.id WHERE s.id = $1 AND u.role = $2',
        [school_id, 'admin']
      );
      if (schoolResult.rows[0]) {
        const row = schoolResult.rows[0];
        await sendEmail({
          to: row.email,
          templateName: 'subscriptionConfirmed',
          data: {
            adminName: `${row.first_name} ${row.last_name}`,
            schoolName: row.name,
            plan: PLANS[plan]?.name || plan,
            amount: PLANS[plan]?.price || 0,
            nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
          },
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const schoolId = data.metadata?.school_id;
      if (schoolId) {
        await query('UPDATE schools SET plan = $1, stripe_subscription_id = NULL WHERE id = $2', ['basic', schoolId]);
        console.log(`School ${schoolId} downgraded to basic (subscription cancelled)`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      console.log(`Payment failed for customer: ${data.customer}`);
      break;
    }
  }

  return { received: true, type: event.type };
};

// ─── Get subscription status ───────────────────────────────────────────────────
const getSubscription = async (schoolId) => {
  const result = await query('SELECT plan, stripe_subscription_id, plan_expires_at FROM schools WHERE id = $1', [schoolId]);
  if (!result.rows.length) throw new Error('School not found');
  const school = result.rows[0];
  const planInfo = PLANS[school.plan] || PLANS.basic;
  return { ...school, planDetails: planInfo };
};

module.exports = { PLANS, createCustomer, createCheckoutSession, createPortalSession, handleWebhook, getSubscription };
