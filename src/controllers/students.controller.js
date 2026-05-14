const { query } = require('../db');
const bcrypt = require('bcryptjs');

const BASE_SELECT = `
  SELECT s.*, 
    u.first_name, u.last_name, u.email, u.phone, u.gender, u.date_of_birth,
    u.religion, u.address, u.photo_url, u.is_active,
    CONCAT(u.first_name,' ',u.last_name) as full_name,
    c.name as class_name, c.section
  FROM students s
  JOIN users u ON s.user_id = u.id
  LEFT JOIN classes c ON s.class_id = c.id
`;

// GET /api/students
const getAll = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, classId, section } = req.query;
    const offset = (page - 1) * limit;
    let conditions = ['s.school_id = $1'];
    let params = [req.schoolId];
    let i = 2;

    if (search) {
      conditions.push(`(CONCAT(u.first_name,' ',u.last_name) ILIKE $${i} OR u.email ILIKE $${i} OR s.roll_number ILIKE $${i})`);
      params.push(`%${search}%`); i++;
    }
    if (classId) { conditions.push(`s.class_id = $${i}`); params.push(classId); i++; }
    if (section) { conditions.push(`c.section = $${i}`); params.push(section); i++; }

    const where = conditions.join(' AND ');
    const [rows, count] = await Promise.all([
      query(`${BASE_SELECT} WHERE ${where} ORDER BY s.roll_number LIMIT $${i} OFFSET $${i+1}`, [...params, limit, offset]),
      query(`SELECT COUNT(*) FROM students s JOIN users u ON s.user_id = u.id LEFT JOIN classes c ON s.class_id = c.id WHERE ${where}`, params),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { page: +page, limit: +limit, total: +count.rows[0].count, pages: Math.ceil(count.rows[0].count / limit) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/students/:id
const getOne = async (req, res) => {
  try {
    const result = await query(`${BASE_SELECT} WHERE s.id = $1 AND s.school_id = $2`, [req.params.id, req.schoolId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/students
const create = async (req, res) => {
  const client = await require('../db').getClient();
  try {
    await client.query('BEGIN');
    const {
      firstName, lastName, email, gender, dateOfBirth, religion, phone, address,
      classId, rollNumber, admissionNo, admissionDate, fatherName, motherName,
      fatherOccupation, motherOccupation, nationality, permanentAddress, sessionYear,
    } = req.body;

    const hash = await bcrypt.hash('Student@1234', 12);
    const userRes = await client.query(
      `INSERT INTO users (school_id,first_name,last_name,email,password_hash,role,gender,date_of_birth,religion,phone,address)
       VALUES ($1,$2,$3,$4,$5,'student',$6,$7,$8,$9,$10) RETURNING id`,
      [req.schoolId, firstName, lastName, email, hash, gender, dateOfBirth || null, religion, phone, address]
    );
    const userId = userRes.rows[0].id;

    const studentRes = await client.query(
      `INSERT INTO students (user_id,school_id,class_id,roll_number,admission_no,admission_date,father_name,mother_name,
        father_occupation,mother_occupation,nationality,permanent_address,session_year)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [userId, req.schoolId, classId || null, rollNumber, admissionNo, admissionDate || null,
       fatherName, motherName, fatherOccupation, motherOccupation, nationality, permanentAddress, sessionYear]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Student created', data: studentRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Email or roll number already exists' });
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
};

// PUT /api/students/:id
const update = async (req, res) => {
  const client = await require('../db').getClient();
  try {
    await client.query('BEGIN');
    const student = await client.query('SELECT user_id FROM students WHERE id=$1 AND school_id=$2', [req.params.id, req.schoolId]);
    if (!student.rows.length) return res.status(404).json({ success: false, message: 'Student not found' });

    const { firstName, lastName, email, gender, dateOfBirth, religion, phone, address, photoUrl,
            classId, rollNumber, fatherName, motherName, fatherOccupation, motherOccupation } = req.body;

    await client.query(
      `UPDATE users SET first_name=$1,last_name=$2,email=$3,gender=$4,date_of_birth=$5,religion=$6,phone=$7,address=$8,photo_url=$9,updated_at=NOW()
       WHERE id=$10`,
      [firstName, lastName, email, gender, dateOfBirth || null, religion, phone, address, photoUrl, student.rows[0].user_id]
    );
    const res2 = await client.query(
      `UPDATE students SET class_id=$1,roll_number=$2,father_name=$3,mother_name=$4,father_occupation=$5,mother_occupation=$6,updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [classId || null, rollNumber, fatherName, motherName, fatherOccupation, motherOccupation, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Student updated', data: res2.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
};

// DELETE /api/students/:id
const remove = async (req, res) => {
  try {
    const student = await query('SELECT user_id FROM students WHERE id=$1 AND school_id=$2', [req.params.id, req.schoolId]);
    if (!student.rows.length) return res.status(404).json({ success: false, message: 'Student not found' });
    await query('DELETE FROM users WHERE id=$1', [student.rows[0].user_id]);
    res.json({ success: true, message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { getAll, getOne, create, update, remove };
