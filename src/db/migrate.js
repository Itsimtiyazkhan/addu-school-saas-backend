const { pool } = require('./index');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🚀 Running migrations...');

    // ─── SCHOOLS (SaaS tenants) ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        address TEXT,
        phone VARCHAR(20),
        email VARCHAR(255) UNIQUE,
        logo_url TEXT,
        website VARCHAR(255),
        established_year INT,
        plan VARCHAR(50) DEFAULT 'basic' CHECK (plan IN ('basic','pro','enterprise')),
        is_active BOOLEAN DEFAULT true,
        session_year VARCHAR(20) DEFAULT '2024-2025',
        language VARCHAR(20) DEFAULT 'English',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ─── USERS (all roles) ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin','admin','teacher','student','parent')),
        photo_url TEXT,
        phone VARCHAR(20),
        address TEXT,
        gender VARCHAR(10) CHECK (gender IN ('Male','Female','Other')),
        date_of_birth DATE,
        religion VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // ─── CLASSES ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        section VARCHAR(10) NOT NULL,
        teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
        capacity INT DEFAULT 40,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, name, section)
      );
      CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);
    `);

    // ─── SUBJECTS ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) NOT NULL,
        type VARCHAR(30) DEFAULT 'Theory' CHECK (type IN ('Theory','Practical','Mathematics','Lab')),
        class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, code)
      );
      CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id);
    `);

    // ─── TEACHERS ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
        class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
        joining_date DATE,
        id_number VARCHAR(50),
        qualification VARCHAR(100),
        experience_years INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_teachers_school ON teachers(school_id);
    `);

    // ─── STUDENTS ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
        roll_number VARCHAR(20),
        admission_no VARCHAR(50),
        admission_date DATE,
        father_name VARCHAR(100),
        mother_name VARCHAR(100),
        father_occupation VARCHAR(100),
        mother_occupation VARCHAR(100),
        nationality VARCHAR(50) DEFAULT 'N/A',
        permanent_address TEXT,
        session_year VARCHAR(20),
        is_promoted BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, roll_number)
      );
      CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
      CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
    `);

    // ─── PARENTS ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS parents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        occupation VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS parent_students (
        parent_id UUID REFERENCES parents(id) ON DELETE CASCADE,
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        relationship VARCHAR(30) DEFAULT 'Parent',
        PRIMARY KEY (parent_id, student_id)
      );
    `);

    // ─── CLASS ROUTINE ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS class_routines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
        subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
        teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
        day VARCHAR(15) NOT NULL CHECK (day IN ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_routine_school ON class_routines(school_id);
    `);

    // ─── ATTENDANCE ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        status VARCHAR(10) DEFAULT 'present' CHECK (status IN ('present','absent','late','holiday')),
        marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, student_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_attendance_school ON attendance(school_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
      CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
    `);

    // ─── EXAMS ────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
        class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
        section VARCHAR(10),
        exam_date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        total_marks INT DEFAULT 100,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_exams_school ON exams(school_id);

      CREATE TABLE IF NOT EXISTS exam_grades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        grade_name VARCHAR(10) NOT NULL,
        grade_point DECIMAL(4,2) NOT NULL,
        percent_from DECIMAL(5,2) NOT NULL,
        percent_upto DECIMAL(5,2) NOT NULL,
        comment VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, grade_name)
      );

      CREATE TABLE IF NOT EXISTS exam_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        marks_obtained DECIMAL(6,2),
        grade_id UUID REFERENCES exam_grades(id) ON DELETE SET NULL,
        remarks TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(exam_id, student_id)
      );
    `);

    // ─── FEES ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS fee_collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        fee_type VARCHAR(50) DEFAULT 'Tuition',
        payment_method VARCHAR(30) DEFAULT 'Cash',
        status VARCHAR(10) DEFAULT 'Due' CHECK (status IN ('Paid','Due','Partial')),
        due_date DATE,
        paid_date DATE,
        receipt_no VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fees_school ON fee_collections(school_id);
      CREATE INDEX IF NOT EXISTS idx_fees_student ON fee_collections(student_id);

      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        expense_type VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(10) DEFAULT 'Due' CHECK (status IN ('Paid','Due')),
        phone VARCHAR(20),
        email VARCHAR(255),
        expense_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ─── LIBRARY ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS books (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        writer VARCHAR(100),
        subject VARCHAR(100),
        class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
        publishing_year INT,
        id_number VARCHAR(50),
        quantity INT DEFAULT 1,
        available INT DEFAULT 1,
        upload_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_books_school ON books(school_id);
    `);

    // ─── HOSTEL ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS hostel_rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        hostel_name VARCHAR(100) NOT NULL,
        room_number VARCHAR(20) NOT NULL,
        room_type VARCHAR(20) DEFAULT 'Standard' CHECK (room_type IN ('Small','Medium','Big','Deluxe')),
        num_beds INT DEFAULT 1,
        cost_per_bed DECIMAL(8,2) DEFAULT 0,
        is_available BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, hostel_name, room_number)
      );
    `);

    // ─── TRANSPORT ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS transport_routes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        route_name VARCHAR(100) NOT NULL,
        vehicle_number VARCHAR(30),
        driver_name VARCHAR(100),
        driver_license VARCHAR(50),
        contact_number VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ─── NOTICES ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        details TEXT,
        posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        notice_date DATE DEFAULT CURRENT_DATE,
        target_role VARCHAR(20) DEFAULT 'all',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notices_school ON notices(school_id);
    `);

    // ─── MESSAGES ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255),
        body TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_messages_school ON messages(school_id);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
    `);

    await client.query('COMMIT');
    console.log('✅ All migrations completed successfully!');
    console.log('Tables created: schools, users, classes, subjects, teachers, students, parents,');
    console.log('  class_routines, attendance, exams, exam_grades, exam_results,');
    console.log('  fee_collections, expenses, books, hostel_rooms, transport_routes, notices, messages');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
};

migrate();
