const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission, getPermLevel } = require('../middleware/auth');
const { query } = require('../config/database');
const { PERM_LEVELS } = require('../config/roles');

router.use(requireAuth);

// Ngày lễ VN (MM-DD) — Tết âm lịch cập nhật theo năm khi cần
const VN_HOLIDAYS = ['01-01', '04-30', '05-01', '09-02'];
const isHoliday = (m, d) => VN_HOLIDAYS.includes(String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'));

const STATUS_META = {
  present:      { label: 'Đi làm',        short: 'X',  color: '#16A34A', bg: '#DCFCE7' },
  late:         { label: 'Đi trễ',        short: 'T',  color: '#D97706', bg: '#FEF3C7' },
  absent:       { label: 'Vắng',          short: 'V',  color: '#DC2626', bg: '#FEE2E2' },
  annual_leave: { label: 'Nghỉ phép',     short: 'P',  color: '#0284C7', bg: '#E0F2FE' },
  sick_leave:   { label: 'Nghỉ bệnh',     short: 'B',  color: '#7C3AED', bg: '#EDE9FE' },
  unpaid_leave: { label: 'Không lương',   short: 'KL', color: '#64748B', bg: '#F1F5F9' },
  remote:       { label: 'Làm từ xa',     short: 'R',  color: '#0D9488', bg: '#CCFBF1' },
};

// Bảng chấm công theo tháng
router.get('/', requirePermission('attendance', 'view'), async (req, res) => {
  try {
    const now = new Date();
    const month = Math.min(Math.max(parseInt(req.query.month) || now.getMonth() + 1, 1), 12);
    const year = Math.min(Math.max(parseInt(req.query.year) || now.getFullYear(), 2020), 2100);
    const dept = req.query.dept || '';

    const level = await getPermLevel(req.session.userRole, 'attendance');
    const canEdit = PERM_LEVELS.indexOf(level) >= PERM_LEVELS.indexOf('edit');

    let usersQ, usersP;
    if (canEdit) {
      usersQ = dept
        ? 'SELECT id, full_name, department, position FROM users WHERE is_active=true AND department=$1 ORDER BY full_name'
        : 'SELECT id, full_name, department, position FROM users WHERE is_active=true ORDER BY full_name';
      usersP = dept ? [dept] : [];
    } else {
      usersQ = 'SELECT id, full_name, department, position FROM users WHERE id=$1';
      usersP = [req.session.userId];
    }

    const [usersRes, recordsRes, deptRes] = await Promise.all([
      query(usersQ, usersP),
      query(
        `SELECT user_id, work_date, status, overtime_hours, notes
         FROM attendance_records
         WHERE EXTRACT(MONTH FROM work_date)=$1 AND EXTRACT(YEAR FROM work_date)=$2`,
        [month, year]
      ),
      canEdit
        ? query('SELECT DISTINCT department FROM users WHERE is_active=true AND department IS NOT NULL ORDER BY department')
        : Promise.resolve({ rows: [] })
    ]);

    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      days.push({ day: d, dow, isWeekend: dow === 0 || dow === 6, isHoliday: isHoliday(month, d) });
    }

    const recordMap = {};
    for (const r of recordsRes.rows) {
      const uid = r.user_id;
      const d = new Date(r.work_date).getDate();
      if (!recordMap[uid]) recordMap[uid] = {};
      recordMap[uid][d] = r;
    }

    res.render('attendance/index', {
      title: 'Bảng Chấm công',
      users: usersRes.rows,
      recordMap, days, month, year, daysInMonth,
      canEdit, dept,
      departments: deptRes.rows.map(r => r.department),
      statusMeta: STATUS_META
    });
  } catch (err) {
    console.error('attendance:', err);
    req.flash('error', 'Lỗi tải bảng chấm công');
    res.redirect('/dashboard');
  }
});

// AJAX: lưu 1 ô chấm công
router.post('/cell', requirePermission('attendance', 'edit'), async (req, res) => {
  const { user_id, work_date, status, notes, overtime_hours } = req.body;
  if (!user_id || !work_date) return res.status(400).json({ error: 'Thiếu dữ liệu' });
  if (status && !Object.keys(STATUS_META).includes(status)) {
    return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
  }
  const ot = Math.min(Math.max(parseFloat(overtime_hours) || 0, 0), 12);
  try {
    if (!status) {
      await query('DELETE FROM attendance_records WHERE user_id=$1 AND work_date=$2', [user_id, work_date]);
    } else {
      await query(
        `INSERT INTO attendance_records (user_id, work_date, status, notes, overtime_hours, approved_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (user_id, work_date) DO UPDATE
         SET status=$3, notes=$4, overtime_hours=$5, approved_by=$6, updated_at=NOW()`,
        [user_id, work_date, status, notes || null, ot, req.session.userId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('attendance cell:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
