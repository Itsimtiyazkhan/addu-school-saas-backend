const { query } = require('../db');
const bcrypt = require('bcryptjs');

// ─── TEACHERS ─────────────────────────────────────────────────────────────────
const getTeachers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, subjectId } = req.query;
    const offset = (page - 1) * limit;
    let conditions = ['t.school_id = $1'];
    let params = [req.schoolId];
    let i = 2;
    if (search) {
      conditions.push(`(CONCAT(u.first_name,' ',u.last_name) ILIKE $${i} OR u.email ILIKE $${i})`);
      params.push(`%${search}%`); i++;
    }
    const where = conditions.join(' AND ');
    const rows = await query(`
      SELECT t.*, u.first_name,u.last_name,u.email,u.phone,u.gender,u.date_of_birth,
        u.religion,u.address,u.photo_url,CONCAT(u.first_name,' ',u.last_name) as full_name,
        s.name as subject_name, c.name as class_name, c.section
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN subjects s ON t.subject_id = s.id
      LEFT JOIN classes c ON t.class_id = c.id
      WHERE ${where} ORDER BY u.first_name LIMIT $${i} OFFSET $${i+1}
    `, [...params, limit, offset]);
    const count = await query(`SELECT COUNT(*) FROM teachers t JOIN users u ON t.user_id=u.id WHERE ${where}`, params);
    res.json({ success: true, data: rows.rows, pagination: { page: +page, total: +count.rows[0].count } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const createTeacher = async (req, res) => {
  const client = await require('../db').getClient();
  try {
    await client.query('BEGIN');
    const { firstName, lastName, email, gender, dateOfBirth, religion, phone, address,
            classId, subjectId, joiningDate, idNumber, qualification } = req.body;
    const hash = await bcrypt.hash('Teacher@1234', 12);
    const userRes = await client.query(
      `INSERT INTO users (school_id,first_name,last_name,email,password_hash,role,gender,date_of_birth,religion,phone,address)
       VALUES ($1,$2,$3,$4,$5,'teacher',$6,$7,$8,$9,$10) RETURNING id`,
      [req.schoolId, firstName, lastName, email, hash, gender, dateOfBirth||null, religion, phone, address]
    );
    const tRes = await client.query(
      `INSERT INTO teachers (user_id,school_id,class_id,subject_id,joining_date,id_number,qualification)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userRes.rows[0].id, req.schoolId, classId||null, subjectId||null, joiningDate||null, idNumber, qualification]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: tRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Email already exists' });
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

const deleteTeacher = async (req, res) => {
  try {
    const t = await query('SELECT user_id FROM teachers WHERE id=$1 AND school_id=$2', [req.params.id, req.schoolId]);
    if (!t.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    await query('DELETE FROM users WHERE id=$1', [t.rows[0].user_id]);
    res.json({ success: true, message: 'Teacher deleted' });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────
const getAttendance = async (req, res) => {
  try {
    const { classId, month, year } = req.query;
    const rows = await query(`
      SELECT a.*, CONCAT(u.first_name,' ',u.last_name) as student_name,
        s.roll_number, c.name as class_name, c.section
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN users u ON s.user_id = u.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.school_id=$1 AND a.class_id=$2
        AND EXTRACT(MONTH FROM a.date)=$3 AND EXTRACT(YEAR FROM a.date)=$4
      ORDER BY s.roll_number, a.date
    `, [req.schoolId, classId, month, year]);
    res.json({ success: true, data: rows.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const markAttendance = async (req, res) => {
  try {
    const { records } = req.body; // [{studentId, classId, date, status}]
    const values = records.map((r, i) =>
      `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`
    ).join(',');
    const params = records.flatMap(r => [req.schoolId, r.studentId, r.classId, r.date, r.status || 'present', req.user.id]);
    await query(`
      INSERT INTO attendance (school_id,student_id,class_id,date,status,marked_by) VALUES ${values}
      ON CONFLICT (school_id,student_id,date) DO UPDATE SET status=EXCLUDED.status
    `, params);
    res.json({ success: true, message: `Marked attendance for ${records.length} students` });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Server error' }); }
};

// ─── EXAMS ────────────────────────────────────────────────────────────────────
const getExams = async (req, res) => {
  try {
    const rows = await query(`
      SELECT e.*, s.name as subject_name, c.name as class_name, c.section
      FROM exams e
      LEFT JOIN subjects s ON e.subject_id=s.id
      LEFT JOIN classes c ON e.class_id=c.id
      WHERE e.school_id=$1 ORDER BY e.exam_date DESC
    `, [req.schoolId]);
    res.json({ success: true, data: rows.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const createExam = async (req, res) => {
  try {
    const { name, subjectId, classId, section, examDate, startTime, endTime, totalMarks } = req.body;
    const r = await query(
      `INSERT INTO exams (school_id,name,subject_id,class_id,section,exam_date,start_time,end_time,total_marks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.schoolId, name, subjectId, classId, section, examDate, startTime||null, endTime||null, totalMarks||100]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const getGrades = async (req, res) => {
  try {
    const r = await query('SELECT * FROM exam_grades WHERE school_id=$1 ORDER BY grade_point DESC', [req.schoolId]);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const createGrade = async (req, res) => {
  try {
    const { gradeName, gradePoint, percentFrom, percentUpto, comment } = req.body;
    const r = await query(
      `INSERT INTO exam_grades (school_id,grade_name,grade_point,percent_from,percent_upto,comment)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.schoolId, gradeName, gradePoint, percentFrom, percentUpto, comment]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Grade already exists' });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── FEES ─────────────────────────────────────────────────────────────────────
const getFees = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let cond = ['f.school_id=$1'], params = [req.schoolId], i = 2;
    if (status) { cond.push(`f.status=$${i}`); params.push(status); i++; }
    const rows = await query(`
      SELECT f.*, CONCAT(u.first_name,' ',u.last_name) as student_name,
        u.photo_url, c.name as class_name, c.section, s.roll_number
      FROM fee_collections f
      JOIN students s ON f.student_id=s.id
      JOIN users u ON s.user_id=u.id
      LEFT JOIN classes c ON s.class_id=c.id
      WHERE ${cond.join(' AND ')} ORDER BY f.created_at DESC
      LIMIT $${i} OFFSET $${i+1}
    `, [...params, limit, offset]);
    const count = await query(`SELECT COUNT(*) FROM fee_collections f WHERE ${cond.join(' AND ')}`, params);
    res.json({ success: true, data: rows.rows, pagination: { total: +count.rows[0].count } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const createFee = async (req, res) => {
  try {
    const { studentId, amount, feeType, paymentMethod, status, dueDate } = req.body;
    const r = await query(
      `INSERT INTO fee_collections (school_id,student_id,amount,fee_type,payment_method,status,due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.schoolId, studentId, amount, feeType||'Tuition', paymentMethod||'Cash', status||'Due', dueDate||null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const updateFeeStatus = async (req, res) => {
  try {
    const r = await query(
      `UPDATE fee_collections SET status=$1, paid_date=$2, updated_at=NOW() WHERE id=$3 AND school_id=$4 RETURNING *`,
      [req.body.status, req.body.status === 'Paid' ? new Date() : null, req.params.id, req.schoolId]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

// ─── NOTICES ──────────────────────────────────────────────────────────────────
const getNotices = async (req, res) => {
  try {
    const r = await query(`
      SELECT n.*, CONCAT(u.first_name,' ',u.last_name) as posted_by_name
      FROM notices n LEFT JOIN users u ON n.posted_by=u.id
      WHERE n.school_id=$1 ORDER BY n.created_at DESC LIMIT 50
    `, [req.schoolId]);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

const createNotice = async (req, res) => {
  try {
    const { title, details, noticeDate, targetRole } = req.body;
    const r = await query(
      `INSERT INTO notices (school_id,title,details,posted_by,notice_date,target_role)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.schoolId, title, details, req.user.id, noticeDate||new Date(), targetRole||'all']
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────
const getDashboardStats = async (req, res) => {
  try {
    const [students, teachers, parents, fees, expenses, notices, exams] = await Promise.all([
      query('SELECT COUNT(*) FROM students WHERE school_id=$1', [req.schoolId]),
      query('SELECT COUNT(*) FROM teachers WHERE school_id=$1', [req.schoolId]),
      query('SELECT COUNT(*) FROM parents WHERE school_id=$1', [req.schoolId]),
      query(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) FILTER(WHERE status='Due') as due_count
             FROM fee_collections WHERE school_id=$1`, [req.schoolId]),
      query('SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE school_id=$1', [req.schoolId]),
      query('SELECT COUNT(*) FROM notices WHERE school_id=$1 AND notice_date >= NOW()-INTERVAL\'30 days\'', [req.schoolId]),
      query('SELECT COUNT(*) FROM exams WHERE school_id=$1 AND exam_date >= NOW()', [req.schoolId]),
    ]);
    res.json({
      success: true,
      data: {
        totalStudents: +students.rows[0].count,
        totalTeachers: +teachers.rows[0].count,
        totalParents: +parents.rows[0].count,
        totalFeeCollections: +fees.rows[0].total,
        dueFees: +fees.rows[0].due_count,
        totalExpenses: +expenses.rows[0].total,
        recentNotices: +notices.rows[0].count,
        upcomingExams: +exams.rows[0].count,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

module.exports = {
  getTeachers, createTeacher, deleteTeacher,
  getAttendance, markAttendance,
  getExams, createExam, getGrades, createGrade,
  getFees, createFee, updateFeeStatus,
  getNotices, createNotice,
  getDashboardStats,
};
