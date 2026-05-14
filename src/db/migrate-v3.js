const { pool } = require('./index');

const migrateV3 = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Running V3 migrations (Super Admin)...');

    // Super admin users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS super_admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Support tickets
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
        priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
        assigned_to UUID REFERENCES super_admins(id) ON DELETE SET NULL,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_school ON support_tickets(school_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
    `);

    // Coupons
    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_type VARCHAR(10) DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
        discount_value DECIMAL(10,2) NOT NULL,
        max_uses INT DEFAULT 100,
        used_count INT DEFAULT 0,
        valid_from TIMESTAMPTZ DEFAULT NOW(),
        valid_until TIMESTAMPTZ,
        applicable_plan VARCHAR(30),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Feature flags
    await client.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        is_enabled BOOLEAN DEFAULT false,
        enabled_for_plans TEXT[] DEFAULT ARRAY['enterprise'],
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO feature_flags (name, description, is_enabled, enabled_for_plans) VALUES
        ('pdf_export', 'PDF report generation', true, ARRAY['pro','enterprise']),
        ('sms_notifications', 'SMS alerts for parents', false, ARRAY['enterprise']),
        ('api_access', 'REST API access', true, ARRAY['enterprise']),
        ('custom_domain', 'Custom school domain', false, ARRAY['enterprise']),
        ('bulk_import', 'Bulk student/teacher import', true, ARRAY['pro','enterprise']),
        ('advanced_analytics', 'Advanced analytics dashboard', false, ARRAY['enterprise'])
      ON CONFLICT (name) DO NOTHING;
    `);

    // API Keys
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        key_hash VARCHAR(255) UNIQUE NOT NULL,
        key_prefix VARCHAR(20) NOT NULL,
        permissions TEXT[] DEFAULT ARRAY['read'],
        last_used TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Broadcast notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS broadcasts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        target VARCHAR(20) DEFAULT 'all' CHECK (target IN ('all','plan_basic','plan_pro','plan_enterprise')),
        channel VARCHAR(20) DEFAULT 'email' CHECK (channel IN ('email','sms','in_app','all')),
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','sent','scheduled')),
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        sent_count INT DEFAULT 0,
        created_by UUID REFERENCES super_admins(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // CRM Leads
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_name VARCHAR(255),
        contact_name VARCHAR(100),
        email VARCHAR(255),
        phone VARCHAR(20),
        country VARCHAR(50),
        city VARCHAR(100),
        student_count INT,
        source VARCHAR(50),
        status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new','contacted','demo','negotiation','converted','lost')),
        notes TEXT,
        assigned_to UUID REFERENCES super_admins(id),
        follow_up_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Global settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        description TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO global_settings (key, value, description) VALUES
        ('platform_name', 'Akkhor', 'Platform display name'),
        ('support_email', 'support@akkhor.edu', 'Support email address'),
        ('max_schools_per_plan_basic', '1', 'Max schools for basic plan'),
        ('trial_days', '14', 'Free trial duration in days'),
        ('maintenance_mode', 'false', 'Enable maintenance mode'),
        ('new_registrations', 'true', 'Allow new school registrations')
      ON CONFLICT (key) DO NOTHING;
    `);

    // Insert default super admin
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('SuperAdmin@2024', 12);
    await client.query(`
      INSERT INTO super_admins (email, password_hash, name)
      VALUES ('superadmin@akkhor.edu', $1, 'Super Administrator')
      ON CONFLICT (email) DO NOTHING
    `, [hash]);

    await client.query('COMMIT');
    console.log('V3 migrations completed!');
    console.log('Super Admin Login: superadmin@akkhor.edu / SuperAdmin@2024');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('V3 Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
};

migrateV3();
