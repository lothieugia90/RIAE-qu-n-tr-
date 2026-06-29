const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(requireAuth);

// Vietnamese public holidays (MM-DD)
const VN_HOLIDAYS = ['01-01','04-30','05-01','09-02','01-27','01-28','01-29','01-30','01-31'];

function isHoliday(year, month, day) {
  const mmdd = String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
  return VN_HOLIDAYS.includes(mmdd);
}

// ─── GRID VIEW ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const month  = parseInt(req.query.month)  || new Date().getMonth() + 1;
    const year   = parseInt(req.query.year)   || new Date().getFullYear();
    const dept   = req.query.dept || '';
    const userRole = req.session.userRole;
    const isHR   = ['admin','director','hr'].includes(userRole);

    let usersQ, usersP;
    if (isHR) {
      usersQ = dept
        ? 'SELECT id, full_name, role, department, position FROM users WHERE is_active=true AND department=$1 ORDER BY full_name'
        : 'SELECT id, full_name, role, department, position FROM users WHERE is_active=true ORDER BY full_name';
      usersP = dept ? [dept] : [];
    } else {
      usersQ = 'SELECT id, full_name, role, department, position FROM users WHERE id=$1';
      usersP = [req.session.userId];
    }

    const [usersRes, recordsRes, deptRes] = await Promise.all([
      query(usersQ, usersP),
      query(
        `SELECT user_id, work_date, status, check_in, check_out, overtime_hours, notes
         FROM attendance_records
         WHERE EXTRACT(MONTH FROM work_date)=$1 AND EXTRACT(YEAR FROM work_date)=$2
         ORDER BY work_date`,
        [month, year]
      ),
      isHR ? query('SELECT DISTINCT department FROM users WHERE is_active=true AND department IS NOT NULL ORDER BY department') : { rows: [] }
    ]);

    const daysInMonth = new Date(year, month, 0).getDate();

    // Build day metadata (weekend/holiday flags)
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      days.push({
        day: d,
        dow,
        isWeekend: dow === 0 || dow === 6,
        isHoliday: isHoliday(year, month, d),
        isSunday: dow === 0
      });
    }

    // Build record map: userId -> day -> status
    const recordMap = {};
    recordsRes.rows.forEach(r => {
      const uid = r.user_id;
      const d   = new Date(r.work_date).getDate();
      if (!recordMap[uid]) recordMap[uid] = {};
      recordMap[uid][d] = r;
    });

    res.render('attendance/index', {
      title: 'Bảng Chấm công',
      users: usersRes.rows,
      recordMap,
      days,
      month, year, daysInMonth,
      isHR,
      dept,
      departments: deptRes.rows.map(r => r.department)
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi tải bảng chấm công');
    res.redirect('/dashboard');
  }
});

// ─── AJAX: SAVE SINGLE CELL ─────────────────────────────────────────────────
router.post('/cell', requireRole('admin', 'director', 'hr', 'head_hr'), async (req, res) => {
  const { user_id, work_date, status, notes, overtime_hours } = req.body;
  const ot = parseFloat(overtime_hours) || 0;
  try {
    if ((!status || status === '') && ot === 0) {
      // Blank status + no OT → delete
      await query('DELETE FROM attendance_records WHERE user_id=$1 AND work_date=$2', [user_id, work_date]);
    } else if (!status || status === '') {
      // No status but has OT → upsert keeping existing status or empty
      await query(
        `INSERT INTO attendance_records (user_id, work_date, status, notes, overtime_hours, approved_by)
         VALUES ($1,$2,'present',$3,$4,$5)
         ON CONFLICT (user_id, work_date) DO UPDATE
         SET overtime_hours=$4, approved_by=$5, updated_at=NOW()`,
        [user_id, work_date, notes || null, ot, req.session.userId]
      );
    } else {
      await query(
        `INSERT INTO attendance_records (user_id, work_date, status, notes, overtime_hours, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, work_date) DO UPDATE
         SET status=$3, notes=$4, overtime_hours=$5, approved_by=$6, updated_at=NOW()`,
        [user_id, work_date, status, notes || null, ot, req.session.userId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── AJAX: BULK SAVE ────────────────────────────────────────────────────────
router.post('/bulk-save', requireRole('admin', 'director', 'hr', 'head_hr'), async (req, res) => {
  const { records } = req.body; // [{ user_id, work_date, status, notes, overtime_hours }]
  if (!Array.isArray(records)) return res.status(400).json({ error: 'Invalid data' });
  try {
    for (const r of records) {
      if (!r.status || r.status === '') {
        await query('DELETE FROM attendance_records WHERE user_id=$1 AND work_date=$2', [r.user_id, r.work_date]);
      } else {
        await query(
          `INSERT INTO attendance_records (user_id, work_date, status, notes, overtime_hours, approved_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (user_id, work_date) DO UPDATE
           SET status=$3, notes=$4, overtime_hours=$5, approved_by=$6, updated_at=NOW()`,
          [r.user_id, r.work_date, r.status, r.notes || null, parseFloat(r.overtime_hours) || 0, req.session.userId]
        );
      }
    }
    res.json({ success: true, saved: records.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PAYROLL VIEW ────────────────────────────────────────────────────────────
router.get('/payroll', requireRole('admin', 'director', 'hr', 'head_hr'), async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();

    const [employees, payroll] = await Promise.all([
      query(
        `SELECT u.id, u.full_name, u.department, u.position, e.salary, e.contract_type,
           (SELECT COUNT(*)::int FROM attendance_records
            WHERE user_id=u.id AND status='present'
              AND EXTRACT(MONTH FROM work_date)=$1 AND EXTRACT(YEAR FROM work_date)=$2) AS present_days,
           (SELECT COUNT(*)::int FROM attendance_records
            WHERE user_id=u.id AND status='late'
              AND EXTRACT(MONTH FROM work_date)=$1 AND EXTRACT(YEAR FROM work_date)=$2) AS late_days,
           (SELECT COUNT(*)::int FROM attendance_records
            WHERE user_id=u.id AND status='annual_leave'
              AND EXTRACT(MONTH FROM work_date)=$1 AND EXTRACT(YEAR FROM work_date)=$2) AS leave_days,
           (SELECT COALESCE(SUM(overtime_hours),0)::float FROM attendance_records
            WHERE user_id=u.id
              AND EXTRACT(MONTH FROM work_date)=$1 AND EXTRACT(YEAR FROM work_date)=$2) AS overtime_hours
         FROM users u LEFT JOIN employees e ON e.user_id=u.id
         WHERE u.is_active=true ORDER BY u.full_name`,
        [month, year]
      ),
      query(
        `SELECT pr.*, u.full_name FROM payroll_records pr
         JOIN users u ON u.id=pr.user_id
         WHERE pr.month=$1 AND pr.year=$2 ORDER BY u.full_name`,
        [month, year]
      )
    ]);

    res.render('attendance/payroll', {
      title: 'Bảng lương',
      employees: employees.rows,
      payroll: payroll.rows,
      month, year,
      daysInMonth: new Date(year, month, 0).getDate()
    });
  } catch (err) { console.error(err); res.redirect('/attendance'); }
});

router.post('/payroll', requireRole('admin', 'director', 'hr', 'head_hr'), async (req, res) => {
  const { user_id, month, year, base_salary, working_days, actual_days,
          overtime_hours, overtime_pay, bonus, deductions, insurance, tax, notes } = req.body;
  const bs  = parseFloat(base_salary)   || 0;
  const wd  = parseFloat(working_days)  || 26;
  const ad  = parseFloat(actual_days)   || 0;
  const net = (bs * (ad / wd)) + (parseFloat(overtime_pay) || 0) + (parseFloat(bonus) || 0)
            - (parseFloat(deductions) || 0) - (parseFloat(insurance) || 0) - (parseFloat(tax) || 0);
  try {
    await query(
      `INSERT INTO payroll_records
         (user_id,month,year,base_salary,working_days,actual_days,overtime_hours,
          overtime_pay,bonus,deductions,insurance,tax,net_salary,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (user_id,month,year) DO UPDATE
       SET base_salary=$4,working_days=$5,actual_days=$6,overtime_hours=$7,overtime_pay=$8,
           bonus=$9,deductions=$10,insurance=$11,tax=$12,net_salary=$13,notes=$14,updated_at=NOW()`,
      [user_id, parseInt(month), parseInt(year), bs, parseInt(working_days) || 26,
       parseInt(actual_days) || 0, parseFloat(overtime_hours) || 0, parseFloat(overtime_pay) || 0,
       parseFloat(bonus) || 0, parseFloat(deductions) || 0, parseFloat(insurance) || 0,
       parseFloat(tax) || 0, net, notes || null, req.session.userId]
    );
    req.flash('success', 'Đã lưu bảng lương');
  } catch (err) { req.flash('error', 'Lỗi: ' + err.message); }
  res.redirect(`/attendance/payroll?month=${month}&year=${year}`);
});

router.post('/payroll/:id/confirm', requireRole('admin', 'director', 'hr', 'head_hr'), async (req, res) => {
  await query("UPDATE payroll_records SET status='confirmed', updated_at=NOW() WHERE id=$1", [req.params.id]);
  req.flash('success', 'Đã xác nhận bảng lương');
  res.redirect('back');
});

module.exports = router;
