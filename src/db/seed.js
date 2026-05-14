const { pool } = require('./index');
const bcrypt = require('bcryptjs');

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding database...');

    // Create demo school
    const schoolRes = await client.query(`
      INSERT INTO schools (name, code, address, phone, email, plan, session_year)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, ['Akkhor International School', 'AKKHOR2024',
        'TA-107 Sydney, Australia', '+88 255600',
        'admin@akkhor.edu', 'pro', '2024-2025']);
    const schoolId = schoolRes.rows[0].id;

    const hash = await bcrypt.hash('Admin@1234', 12);

    // Super admin
    const adminRes = await client.query(`
      INSERT INTO users (school_id, first_name, last_name, email, password_hash, role, gender, phone, address)
      VALUES ($1,'Kazi','Fahim',$2,$3,'admin','Male','+88 255600','TA-107 Sydney, Australia')
      ON CONFLICT (school_id, email) DO UPDATE SET first_name = EXCLUDED.first_name
      RETURNING id
    `, [schoolId, 'admin@akkhor.edu', hash]);
    const adminId = adminRes.rows[0].id;

    // Teacher
    const teacherUserRes = await client.query(`
      INSERT INTO users (school_id, first_name, last_name, email, password_hash, role, gender, date_of_birth, religion)
      VALUES ($1,'Andrew','Martin',$2,$3,'teacher','Male','1998-05-03','Islam')
      ON CONFLICT (school_id, email) DO UPDATE SET first_name = EXCLUDED.first_name
      RETURNING id
    `, [schoolId, 'andrewmartin@akkhor.edu', hash]);
    const teacherUserId = teacherUserRes.rows[0].id;

    // Student
    const studentUserRes = await client.query(`
      INSERT INTO users (school_id, first_name, last_name, email, password_hash, role, gender, date_of_birth, religion)
      VALUES ($1,'Richi','Hassan',$2,$3,'student','Female','2010-04-03','Islam')
      ON CONFLICT (school_id, email) DO UPDATE SET first_name = EXCLUDED.first_name
      RETURNING id
    `, [schoolId, 'richihasan@akkhor.edu', hash]);
    const studentUserId = studentUserRes.rows[0].id;

    // Parent
    const parentUserRes = await client.query(`
      INSERT INTO users (school_id, first_name, last_name, email, password_hash, role, gender, phone)
      VALUES ($1,'Kazi','Fahimur',$2,$3,'parent','Male','+88 255600')
      ON CONFLICT (school_id, email) DO UPDATE SET first_name = EXCLUDED.first_name
      RETURNING id
    `, [schoolId, 'parent@akkhor.edu', hash]);

    // Create class
    const classRes = await client.query(`
      INSERT INTO classes (school_id, name, section)
      VALUES ($1,'2','A'), ($1,'3','B'), ($1,'1','A')
      ON CONFLICT (school_id, name, section) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [schoolId]);
    const classId = classRes.rows[0].id;

    // Create subjects
    await client.query(`
      INSERT INTO subjects (school_id, name, code, type, class_id)
      VALUES 
        ($1,'Mathematics','MATH901','Mathematics',$2),
        ($1,'English','ENG902','Theory',$2),
        ($1,'Science','SCI903','Practical',$2),
        ($1,'Bangla','BAN904','Theory',$2),
        ($1,'Arts','ART905','Theory',$2)
      ON CONFLICT (school_id, code) DO NOTHING
    `, [schoolId, classId]);

    // Link teacher
    await client.query(`
      INSERT INTO teachers (user_id, school_id, class_id, joining_date, id_number)
      VALUES ($1,$2,$3,'2016-05-04','T2901')
      ON CONFLICT (user_id) DO NOTHING
    `, [teacherUserId, schoolId, classId]);

    // Link student
    const studentRes = await client.query(`
      INSERT INTO students (user_id, school_id, class_id, roll_number, admission_no, admission_date, father_name, mother_name, session_year)
      VALUES ($1,$2,$3,'2901','ADM1250','2016-05-04','Kazi Fahimur Rahman','Richi Akon','2024-2025')
      ON CONFLICT (user_id) DO NOTHING
      RETURNING id
    `, [studentUserId, schoolId, classId]);

    // Exam grades
    await client.query(`
      INSERT INTO exam_grades (school_id, grade_name, grade_point, percent_from, percent_upto, comment)
      VALUES 
        ($1,'A+',4.00,95,100,'Outstanding'),
        ($1,'A',3.50,85,94,'Excellent'),
        ($1,'B+',3.00,75,84,'Very Good'),
        ($1,'B',2.50,65,74,'Good'),
        ($1,'C',2.00,55,64,'Average'),
        ($1,'D',1.00,40,54,'Below Average'),
        ($1,'F',0.00,0,39,'Fail')
      ON CONFLICT (school_id, grade_name) DO NOTHING
    `, [schoolId]);

    // Sample notices
    await client.query(`
      INSERT INTO notices (school_id, title, details, posted_by, notice_date)
      VALUES 
        ($1,'Annual Sports Day','Join us for the annual sports day on June 15',$2,'2024-05-16'),
        ($1,'Exam Schedule Released','Mid-term exams start from June 20',$2,'2024-05-14'),
        ($1,'Holiday Notice','School closed on June 5 for national holiday',$2,'2024-05-12')
    `, [schoolId, adminId]);

    // Sample transport
    await client.query(`
      INSERT INTO transport_routes (school_id, route_name, vehicle_number, driver_name, driver_license, contact_number)
      VALUES ($1,'Gulshan-1','MT988800','Shahjahan Khan','DLNC025936','+88 98506666')
      ON CONFLICT DO NOTHING
    `, [schoolId]);

    await client.query('COMMIT');
    console.log('✅ Seed completed!');
    console.log('');
    console.log('🔐 Demo Login Credentials:');
    console.log('  Admin:   admin@akkhor.edu   / Admin@1234');
    console.log('  Teacher: andrewmartin@akkhor.edu / Admin@1234');
    console.log('  Student: richihasan@akkhor.edu  / Admin@1234');
    console.log('  Parent:  parent@akkhor.edu      / Admin@1234');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
};

seed();
