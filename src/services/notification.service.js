const { query } = require('../db');
const { sendEmail, sendBulkEmails } = require('./email.service');

// Try Twilio if configured
let twilioClient = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_ACCOUNT_SID !== 'AC...') {
    twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('📱 Twilio SMS configured');
  }
} catch (e) {
  console.log('📱 SMS disabled (Twilio not configured)');
}

// ─── SMS ──────────────────────────────────────────────────────────────────────
const sendSMS = async (to, message) => {
  if (!twilioClient) {
    console.log(`[SMS SKIP] To: ${to} | ${message}`);
    return;
  }
  try {
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
  } catch (err) {
    console.error('SMS error:', err.message);
  }
};

// ─── Attendance notification to parents ───────────────────────────────────────
const notifyAttendance = async (records, schoolId) => {
  const absentStudents = records.filter(r => r.status === 'absent');
  if (!absentStudents.length) return;

  // Get parent contacts for absent students
  const studentIds = absentStudents.map(r => r.studentId);
  const result = await query(`
    SELECT ps.student_id, CONCAT(pu.first_name,' ',pu.last_name) as parent_name,
      pu.email as parent_email, pu.phone as parent_phone,
      CONCAT(su.first_name,' ',su.last_name) as student_name,
      c.name as class_name, c.section
    FROM parent_students ps
    JOIN parents p ON ps.parent_id = p.id
    JOIN users pu ON p.user_id = pu.id
    JOIN students st ON ps.student_id = st.id
    JOIN users su ON st.user_id = su.id
    LEFT JOIN classes c ON st.class_id = c.id
    WHERE ps.student_id = ANY($1::uuid[]) AND p.school_id = $2
  `, [studentIds, schoolId]);

  const emailJobs = result.rows.map(row => ({
    to: row.parent_email,
    templateName: 'attendanceAlert',
    data: {
      parentName: row.parent_name,
      studentName: row.student_name,
      status: 'absent',
      date: new Date().toLocaleDateString(),
      className: `${row.class_name}-${row.section}`,
    },
  }));

  await sendBulkEmails(emailJobs);

  // SMS for absent students
  for (const row of result.rows) {
    if (row.parent_phone) {
      await sendSMS(row.parent_phone,
        `Akkhor Alert: ${row.student_name} was ABSENT today (${new Date().toLocaleDateString()}). Class: ${row.class_name}-${row.section}`
      );
    }
  }
};

// ─── Fee reminder to parents ──────────────────────────────────────────────────
const sendFeeReminders = async (schoolId) => {
  const result = await query(`
    SELECT f.id, f.amount, f.fee_type, f.due_date,
      CONCAT(su.first_name,' ',su.last_name) as student_name,
      CONCAT(pu.first_name,' ',pu.last_name) as parent_name,
      pu.email as parent_email, pu.phone,
      c.name as class_name
    FROM fee_collections f
    JOIN students st ON f.student_id = st.id
    JOIN users su ON st.user_id = su.id
    LEFT JOIN classes c ON st.class_id = c.id
    LEFT JOIN parent_students ps ON ps.student_id = st.id
    LEFT JOIN parents p ON ps.parent_id = p.id
    LEFT JOIN users pu ON p.user_id = pu.id
    WHERE f.school_id = $1 AND f.status = 'Due'
      AND pu.email IS NOT NULL
      AND f.due_date <= NOW() + INTERVAL '3 days'
  `, [schoolId]);

  if (!result.rows.length) return { sent: 0 };

  const emailJobs = result.rows.map(row => ({
    to: row.parent_email,
    templateName: 'feeReminder',
    data: {
      parentName: row.parent_name || 'Parent',
      studentName: row.student_name,
      className: row.class_name,
      feeType: row.fee_type,
      amount: parseFloat(row.amount).toFixed(2),
      dueDate: row.due_date ? new Date(row.due_date).toLocaleDateString() : 'Overdue',
    },
  }));

  await sendBulkEmails(emailJobs);
  return { sent: result.rows.length };
};

// ─── New notice notification ───────────────────────────────────────────────────
const notifyNewNotice = async (notice, schoolId) => {
  const result = await query(
    `SELECT email, CONCAT(first_name,' ',last_name) as name FROM users WHERE school_id = $1 AND is_active = true LIMIT 200`,
    [schoolId]
  );

  const emailJobs = result.rows.map(row => ({
    to: row.email,
    templateName: 'newNotice',
    data: {
      recipientName: row.name,
      title: notice.title,
      details: notice.details,
      postedBy: notice.posted_by_name || 'Admin',
      date: new Date().toLocaleDateString(),
    },
  }));

  await sendBulkEmails(emailJobs);
  return { sent: result.rows.length };
};

// ─── Exam schedule notification ────────────────────────────────────────────────
const notifyExam = async (exam, schoolId) => {
  const result = await query(`
    SELECT u.email, CONCAT(u.first_name,' ',u.last_name) as name
    FROM students s
    JOIN users u ON s.user_id = u.id
    WHERE s.class_id = $1 AND s.school_id = $2
  `, [exam.class_id, schoolId]);

  const emailJobs = result.rows.map(row => ({
    to: row.email,
    templateName: 'examSchedule',
    data: {
      studentName: row.name,
      examName: exam.name,
      subject: exam.subject_name || '',
      date: exam.exam_date ? new Date(exam.exam_date).toLocaleDateString() : '',
      time: exam.start_time ? `${exam.start_time} - ${exam.end_time}` : 'TBD',
      className: exam.class_name || '',
    },
  }));

  await sendBulkEmails(emailJobs);
  return { sent: result.rows.length };
};

module.exports = { sendSMS, notifyAttendance, sendFeeReminders, notifyNewNotice, notifyExam };
