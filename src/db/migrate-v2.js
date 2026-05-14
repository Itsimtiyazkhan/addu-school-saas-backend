const { pool } = require('./index');

const migrateV2 = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🚀 Running V2 migrations...');

    // Add Stripe fields to schools
    await client.query(`
      ALTER TABLE schools
        ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS max_students INT DEFAULT 100,
        ADD COLUMN IF NOT EXISTS max_teachers INT DEFAULT 5,
        ADD COLUMN IF NOT EXISTS storage_used_mb INT DEFAULT 0;
    `);

    // Add email_verified to users
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS refresh_token TEXT,
        ADD COLUMN IF NOT EXISTS photo_public_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{"email":true,"sms":false}'::jsonb;
    `);

    // OTPs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS otps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        otp VARCHAR(10) NOT NULL,
        type VARCHAR(30) NOT NULL CHECK (type IN ('email_verify','password_reset','phone_verify')),
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_otps_user ON otps(user_id);
    `);

    // Audit logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(50) NOT NULL,
        entity VARCHAR(50),
        entity_id UUID,
        old_data JSONB,
        new_data JSONB,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    `);

    // Subscriptions table (for billing history)
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        stripe_payment_intent VARCHAR(100),
        amount DECIMAL(10,2),
        currency VARCHAR(10) DEFAULT 'usd',
        plan VARCHAR(30),
        status VARCHAR(20),
        billing_date TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // File attachments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS file_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
        entity_type VARCHAR(50),
        entity_id UUID,
        file_url TEXT NOT NULL,
        public_id VARCHAR(255),
        provider VARCHAR(20) DEFAULT 'local',
        filename VARCHAR(255),
        size_bytes INT,
        mime_type VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_files_entity ON file_attachments(entity_type, entity_id);
    `);

    // Real-time events log (for WebSocket replay)
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_events_school ON events(school_id, created_at);
    `);

    // Notification preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255),
        body TEXT,
        type VARCHAR(50),
        is_read BOOLEAN DEFAULT false,
        link VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
    `);

    await client.query('COMMIT');
    console.log('✅ V2 migrations completed!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ V2 Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
};

migrateV2();
// already has content
