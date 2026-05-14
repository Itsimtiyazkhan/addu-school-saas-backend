const router = require("express").Router();
const { authenticate, authorize } = require("../middleware/auth");
const auth = require("../controllers/auth.controller");
const students = require("../controllers/students.controller");
const {
  getTeachers,
  createTeacher,
  deleteTeacher,
  getAttendance,
  markAttendance,
  getExams,
  createExam,
  getGrades,
  createGrade,
  getFees,
  createFee,
  updateFeeStatus,
  getNotices,
  createNotice,
  getDashboardStats,
} = require("../controllers/main.controller");
const { query } = require("../db");

const A = ["admin"];
const AT = ["admin", "teacher"];

// ─── AUTH ─────────────────────────────────────────────────────────────────────
router.post("/auth/login", auth.login);
router.post("/auth/register-school", auth.registerSchool);
router.get("/auth/me", authenticate, auth.getMe);
router.put("/auth/change-password", authenticate, auth.changePassword);

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
router.get("/dashboard/stats", authenticate, getDashboardStats);

// ─── STUDENTS ─────────────────────────────────────────────────────────────────
router.get("/students", authenticate, students.getAll);
router.get("/students/:id", authenticate, students.getOne);
router.post("/students", authenticate, authorize(...A), students.create);
router.put("/students/:id", authenticate, authorize(...A), students.update);
router.delete("/students/:id", authenticate, authorize(...A), students.remove);

// ─── TEACHERS ─────────────────────────────────────────────────────────────────
router.get("/teachers", authenticate, getTeachers);
router.post("/teachers", authenticate, authorize(...A), createTeacher);
router.delete("/teachers/:id", authenticate, authorize(...A), deleteTeacher);

// ─── PARENTS ─────────────────────────────────────────────────────────────────
router.get("/parents", authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;
    let cond = ["p.school_id=$1"],
      params = [req.schoolId],
      i = 2;
    if (search) {
      cond.push(
        `(CONCAT(u.first_name,' ',u.last_name) ILIKE $${i} OR u.phone ILIKE $${i})`,
      );
      params.push(`%${search}%`);
      i++;
    }
    const rows = await query(
      `
      SELECT p.*,u.first_name,u.last_name,u.email,u.phone,u.gender,u.address,u.photo_url,
        CONCAT(u.first_name,' ',u.last_name) as full_name, p.occupation
      FROM parents p JOIN users u ON p.user_id=u.id
      WHERE ${cond.join(" AND ")} ORDER BY u.first_name
      LIMIT $${i} OFFSET $${i + 1}
    `,
      [...params, limit, offset],
    );
    const count = await query(
      `SELECT COUNT(*) FROM parents p JOIN users u ON p.user_id=u.id WHERE ${cond.join(" AND ")}`,
      params,
    );
    res.json({
      success: true,
      data: rows.rows,
      pagination: { total: +count.rows[0].count },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── CLASSES ──────────────────────────────────────────────────────────────────
router.get("/classes", authenticate, async (req, res) => {
  try {
    const r = await query(
      `
      SELECT c.id, c.school_id, c.name, c.section, c.capacity, c.created_at,
        c.teacher_id,
        CONCAT(u.first_name,' ',u.last_name) as teacher_name,
        (SELECT COUNT(*) FROM students WHERE class_id=c.id) as student_count
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.user_id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE c.school_id=$1 ORDER BY c.name, c.section
    `,
      [req.schoolId],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error("Classes GET error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});
router.post("/classes", authenticate, authorize(...A), async (req, res) => {
  try {
    const { name, section, teacherId, capacity } = req.body;
    const r = await query(
      `INSERT INTO classes (school_id,name,section,teacher_id,capacity) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.schoolId, name, section, teacherId || null, capacity || 40],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ success: false, message: "Class/section already exists" });
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.delete(
  "/classes/:id",
  authenticate,
  authorize(...A),
  async (req, res) => {
    try {
      await query("DELETE FROM classes WHERE id=$1 AND school_id=$2", [
        req.params.id,
        req.schoolId,
      ]);
      res.json({ success: true, message: "Class deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ─── SUBJECTS ─────────────────────────────────────────────────────────────────
router.get("/subjects", authenticate, async (req, res) => {
  try {
    const r = await query(
      `
      SELECT s.*, c.name as class_name FROM subjects s LEFT JOIN classes c ON s.class_id=c.id
      WHERE s.school_id=$1 ORDER BY s.name
    `,
      [req.schoolId],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.post("/subjects", authenticate, authorize(...A), async (req, res) => {
  try {
    const { name, code, type, classId } = req.body;
    const r = await query(
      `INSERT INTO subjects (school_id,name,code,type,class_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.schoolId, name, code, type || "Theory", classId || null],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ success: false, message: "Subject code exists" });
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.delete(
  "/subjects/:id",
  authenticate,
  authorize(...A),
  async (req, res) => {
    try {
      await query("DELETE FROM subjects WHERE id=$1 AND school_id=$2", [
        req.params.id,
        req.schoolId,
      ]);
      res.json({ success: true, message: "Subject deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ─── CLASS ROUTINE ────────────────────────────────────────────────────────────
router.get("/class-routines", authenticate, async (req, res) => {
  try {
    const { classId } = req.query;
    const r = await query(
      `
      SELECT cr.*, s.name as subject_name, CONCAT(u.first_name,' ',u.last_name) as teacher_name,
        c.name as class_name, c.section
      FROM class_routines cr
      LEFT JOIN subjects s ON cr.subject_id=s.id
      LEFT JOIN teachers t ON cr.teacher_id=t.id LEFT JOIN users u ON t.user_id=u.id
      LEFT JOIN classes c ON cr.class_id=c.id
      WHERE cr.school_id=$1 ${classId ? "AND cr.class_id=$2" : ""} ORDER BY cr.day, cr.start_time
    `,
      classId ? [req.schoolId, classId] : [req.schoolId],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.post(
  "/class-routines",
  authenticate,
  authorize(...AT),
  async (req, res) => {
    try {
      const { classId, subjectId, teacherId, day, startTime, endTime } =
        req.body;
      const r = await query(
        `INSERT INTO class_routines (school_id,class_id,subject_id,teacher_id,day,start_time,end_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          req.schoolId,
          classId,
          subjectId || null,
          teacherId || null,
          day,
          startTime,
          endTime,
        ],
      );
      res.status(201).json({ success: true, data: r.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────
router.get("/attendance", authenticate, getAttendance);
router.post("/attendance", authenticate, authorize(...AT), markAttendance);

// ─── EXAMS ────────────────────────────────────────────────────────────────────
router.get("/exams", authenticate, getExams);
router.post("/exams", authenticate, authorize(...AT), createExam);
router.delete("/exams/:id", authenticate, authorize(...A), async (req, res) => {
  try {
    await query("DELETE FROM exams WHERE id=$1 AND school_id=$2", [
      req.params.id,
      req.schoolId,
    ]);
    res.json({ success: true, message: "Exam deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/exam-grades", authenticate, getGrades);
router.post("/exam-grades", authenticate, authorize(...A), createGrade);
router.delete(
  "/exam-grades/:id",
  authenticate,
  authorize(...A),
  async (req, res) => {
    try {
      await query("DELETE FROM exam_grades WHERE id=$1 AND school_id=$2", [
        req.params.id,
        req.schoolId,
      ]);
      res.json({ success: true, message: "Grade deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ─── FEES & EXPENSES ──────────────────────────────────────────────────────────
router.get("/fees", authenticate, getFees);
router.post("/fees", authenticate, authorize(...A), createFee);
router.patch(
  "/fees/:id/status",
  authenticate,
  authorize(...A),
  updateFeeStatus,
);
router.get("/expenses", authenticate, async (req, res) => {
  try {
    const r = await query(
      "SELECT * FROM expenses WHERE school_id=$1 ORDER BY created_at DESC",
      [req.schoolId],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.post("/expenses", authenticate, authorize(...A), async (req, res) => {
  try {
    const { name, expenseType, amount, status, phone, email, expenseDate } =
      req.body;
    const r = await query(
      `INSERT INTO expenses (school_id,name,expense_type,amount,status,phone,email,expense_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.schoolId,
        name,
        expenseType,
        amount,
        status || "Due",
        phone,
        email,
        expenseDate || new Date(),
      ],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── LIBRARY ──────────────────────────────────────────────────────────────────
router.get("/books", authenticate, async (req, res) => {
  try {
    const r = await query(
      `
      SELECT b.*, c.name as class_name FROM books b LEFT JOIN classes c ON b.class_id=c.id
      WHERE b.school_id=$1 ORDER BY b.name
    `,
      [req.schoolId],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.post("/books", authenticate, authorize(...A), async (req, res) => {
  try {
    const {
      name,
      writer,
      subject,
      classId,
      publishingYear,
      idNumber,
      quantity,
    } = req.body;
    const r = await query(
      `INSERT INTO books (school_id,name,writer,subject,class_id,publishing_year,id_number,quantity,available)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [
        req.schoolId,
        name,
        writer,
        subject,
        classId || null,
        publishingYear || null,
        idNumber,
        quantity || 1,
      ],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.delete("/books/:id", authenticate, authorize(...A), async (req, res) => {
  try {
    await query("DELETE FROM books WHERE id=$1 AND school_id=$2", [
      req.params.id,
      req.schoolId,
    ]);
    res.json({ success: true, message: "Book deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── HOSTEL ───────────────────────────────────────────────────────────────────
router.get("/hostel", authenticate, async (req, res) => {
  try {
    const r = await query(
      "SELECT * FROM hostel_rooms WHERE school_id=$1 ORDER BY hostel_name, room_number",
      [req.schoolId],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.post("/hostel", authenticate, authorize(...A), async (req, res) => {
  try {
    const { hostelName, roomNumber, roomType, numBeds, costPerBed } = req.body;
    const r = await query(
      `INSERT INTO hostel_rooms (school_id,hostel_name,room_number,room_type,num_beds,cost_per_bed)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.schoolId,
        hostelName,
        roomNumber,
        roomType || "Standard",
        numBeds || 1,
        costPerBed || 0,
      ],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ success: false, message: "Room already exists" });
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.delete(
  "/hostel/:id",
  authenticate,
  authorize(...A),
  async (req, res) => {
    try {
      await query("DELETE FROM hostel_rooms WHERE id=$1 AND school_id=$2", [
        req.params.id,
        req.schoolId,
      ]);
      res.json({ success: true, message: "Room deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ─── TRANSPORT ────────────────────────────────────────────────────────────────
router.get("/transport", authenticate, async (req, res) => {
  try {
    const r = await query(
      "SELECT * FROM transport_routes WHERE school_id=$1 ORDER BY route_name",
      [req.schoolId],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.post("/transport", authenticate, authorize(...A), async (req, res) => {
  try {
    const {
      routeName,
      vehicleNumber,
      driverName,
      driverLicense,
      contactNumber,
    } = req.body;
    const r = await query(
      `INSERT INTO transport_routes (school_id,route_name,vehicle_number,driver_name,driver_license,contact_number)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.schoolId,
        routeName,
        vehicleNumber,
        driverName,
        driverLicense,
        contactNumber,
      ],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.delete(
  "/transport/:id",
  authenticate,
  authorize(...A),
  async (req, res) => {
    try {
      await query("DELETE FROM transport_routes WHERE id=$1 AND school_id=$2", [
        req.params.id,
        req.schoolId,
      ]);
      res.json({ success: true, message: "Route deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ─── NOTICES ──────────────────────────────────────────────────────────────────
router.get("/notices", authenticate, getNotices);
router.post("/notices", authenticate, authorize(...AT), createNotice);
router.delete(
  "/notices/:id",
  authenticate,
  authorize(...AT),
  async (req, res) => {
    try {
      await query("DELETE FROM notices WHERE id=$1 AND school_id=$2", [
        req.params.id,
        req.schoolId,
      ]);
      res.json({ success: true, message: "Notice deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
router.get("/messages", authenticate, async (req, res) => {
  try {
    const r = await query(
      `
      SELECT m.*, CONCAT(s.first_name,' ',s.last_name) as sender_name,
        CONCAT(r.first_name,' ',r.last_name) as recipient_name
      FROM messages m
      JOIN users s ON m.sender_id=s.id JOIN users r ON m.recipient_id=r.id
      WHERE m.school_id=$1 AND (m.recipient_id=$2 OR m.sender_id=$2)
      ORDER BY m.created_at DESC
    `,
      [req.schoolId, req.user.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.post("/messages", authenticate, async (req, res) => {
  try {
    const { recipientId, title, body } = req.body;
    const r = await query(
      `INSERT INTO messages (school_id,sender_id,recipient_id,title,body) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.schoolId, req.user.id, recipientId, title, body],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── ACCOUNT SETTINGS ─────────────────────────────────────────────────────────
router.put("/account/settings", authenticate, async (req, res) => {
  try {
    const { firstName, lastName, phone, address, language } = req.body;
    await query(
      `UPDATE users SET first_name=$1,last_name=$2,phone=$3,address=$4,updated_at=NOW() WHERE id=$5`,
      [firstName, lastName, phone, address, req.user.id],
    );
    if (language)
      await query("UPDATE schools SET language=$1 WHERE id=$2", [
        language,
        req.schoolId,
      ]);
    res.json({ success: true, message: "Settings updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── USERS (for messaging dropdown) ──────────────────────────────────────────
router.get("/users", authenticate, async (req, res) => {
  try {
    const r = await query(
      `SELECT id, CONCAT(first_name,' ',last_name) as name, role, email FROM users
       WHERE school_id=$1 AND id!=$2 AND is_active=true ORDER BY first_name`,
      [req.schoolId, req.user.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
