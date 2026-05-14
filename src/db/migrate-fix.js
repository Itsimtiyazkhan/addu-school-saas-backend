const { pool } = require('./index');

const fixMigration = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Running fix migration...');

    // Fix 1: Add teacher_id to classes if missing
    await client.query(`
      ALTER TABLE classes 
        ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS capacity INT DEFAULT 40;
    `);

    // Fix 2: Add occupation to parents if missing
    await client.query(`
      ALTER TABLE parents
        ADD COLUMN IF NOT EXISTS occupation VARCHAR(100);
    `);

    // Fix 3: Add parent user + parent record to demo school
    const school = await client.query(`SELECT id FROM schools WHERE code='AKKHOR2024' LIMIT 1`);
    if (school.rows.length) {
      const schoolId = school.rows[0].id;
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('Admin@1234', 12);

      // Create parent user if not exists
      const existingParent = await client.query(
        `SELECT id FROM users WHERE email='parent@akkhor.edu' AND school_id=$1`, [schoolId]
      );

      if (!existingParent.rows.length) {
        const parentUser = await client.query(`
          INSERT INTO users (school_id, first_name, last_name, email, password_hash, role, gender, phone, address)
          VALUES ($1, 'Kazi', 'Fahimur', 'parent@akkhor.edu', $2, 'parent', 'Male', '+88 255600', 'TA-107 Sydney, Australia')
          RETURNING id
        `, [schoolId, hash]);

        // Insert into parents table
        await client.query(`
          INSERT INTO parents (user_id, school_id, occupation)
          VALUES ($1, $2, 'Businessman')
          ON CONFLICT (user_id) DO NOTHING
        `, [parentUser.rows[0].id, schoolId]);

        console.log('Parent user created: parent@akkhor.edu / Admin@1234');
      } else {
        // Make sure parent record exists
        await client.query(`
          INSERT INTO parents (user_id, school_id, occupation)
          VALUES ($1, $2, 'Businessman')
          ON CONFLICT (user_id) DO NOTHING
        `, [existingParent.rows[0].id, schoolId]);
        console.log('Parent record fixed');
      }

      // Fix 3: Add more sample parents
      const sampleParents = [
        { first: 'Nathan', last: 'Smith',  email: 'nathan@akkhor.edu',  gender: 'Male',   occ: 'Engineer' },
        { first: 'Sarah',  last: 'Johnson', email: 'sarah@akkhor.edu',   gender: 'Female', occ: 'Doctor' },
        { first: 'Mike',   last: 'Hussy',   email: 'mike@akkhor.edu',    gender: 'Male',   occ: 'Businessman' },
        { first: 'Liza',   last: 'Akon',    email: 'liza@akkhor.edu',    gender: 'Female', occ: 'Teacher' },
      ];

      for (const p of sampleParents) {
        const existing = await client.query(
          `SELECT id FROM users WHERE email=$1 AND school_id=$2`, [p.email, schoolId]
        );
        if (!existing.rows.length) {
          const u = await client.query(`
            INSERT INTO users (school_id, first_name, last_name, email, password_hash, role, gender, phone, address)
            VALUES ($1,$2,$3,$4,$5,'parent',$6,'+88 255600','Sydney, Australia')
            RETURNING id
          `, [schoolId, p.first, p.last, p.email, hash, p.gender]);
          await client.query(`
            INSERT INTO parents (user_id, school_id, occupation)
            VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING
          `, [u.rows[0].id, schoolId, p.occ]);
        }
      }
      console.log('Sample parents added!');
    }

    await client.query('COMMIT');
    console.log('Fix migration completed!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fix failed:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
};

fixMigration();
