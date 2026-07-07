const { query } = require('../config/database');
const { logActivity } = require('../utils/activityLog');
const { getPermLevel } = require('../middleware/auth');
const { ROLES } = require('../config/roles');

function monthStart(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
}

async function writeAudit({ criteriaId, criteriaKey, criteriaName, category,
  action, fieldChanged, oldValue, newValue, effectiveFrom,
  changedBy, changedByName, ip, note }) {
  await query(
    `INSERT INTO payroll_audit_logs
       (criteria_id,criteria_key,criteria_name,category,action,
        field_changed,old_value,new_value,effective_from,
        changed_by,changed_by_name,ip_address,note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [criteriaId, criteriaKey, criteriaName, category,
     action, fieldChanged, oldValue, newValue, effectiveFrom,
     changedBy, changedByName, ip, note || null]
  );
}

const index = async (req, res) => {
  try {
    const [criteria, recentLogs] = await Promise.all([
      query('SELECT * FROM payroll_criteria ORDER BY category, name'),
      query(`SELECT pal.*, u.full_name AS changer_name
             FROM payroll_audit_logs pal LEFT JOIN users u ON u.id = pal.changed_by
             ORDER BY changed_at DESC LIMIT 30`)
    ]);
    const grouped = { allowance: [], overtime: [], deduction: [] };
    criteria.rows.forEach(r => { if (grouped[r.category]) grouped[r.category].push(r); });
    const permLevel = await getPermLevel(req.session.userRole, 'payroll');
    res.render('payroll-settings/index', {
      title: 'Cấu hình Lương & Phụ cấp',
      grouped,
      recentLogs: recentLogs.rows,
      roles: ROLES,
      permLevel
    });
  } catch (err) {
    console.error('payroll-settings index:', err);
    req.flash('error', 'Lỗi tải cấu hình lương');
    res.redirect('/dashboard');
  }
};

const create = async (req, res) => {
  const { category, name, key, unit, default_value, applies_to, description, effective_when } = req.body;
  if (!['allowance', 'overtime', 'deduction'].includes(category) || !name?.trim() || !key?.trim()) {
    req.flash('error', 'Vui lòng nhập đủ tên, danh mục và key');
    return res.redirect('/payroll-settings');
  }
  try {
    const effectiveFrom = effective_when === 'next' ? monthStart(1) : monthStart(0);
    const safeKey = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const result = await query(
      `INSERT INTO payroll_criteria
         (category,name,key,unit,default_value,applies_to,description,effective_from,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [category, name.trim(), safeKey, unit === 'percent' ? 'percent' : 'VND',
       parseFloat(default_value) || 0, applies_to || 'all', description || null,
       effectiveFrom, req.session.userId]
    );
    const created = result.rows[0];
    await writeAudit({
      criteriaId: created.id, criteriaKey: safeKey, criteriaName: name.trim(),
      category, action: 'CREATE', fieldChanged: 'all', oldValue: null,
      newValue: JSON.stringify({ unit, default_value }), effectiveFrom,
      changedBy: req.session.userId, changedByName: req.session.userName || 'unknown', ip: req.ip
    });
    logActivity(req.session.userId, 'PAYROLL_CRITERIA_CREATE', `Tạo tiêu chí lương: ${name.trim()}`,
      { entityType: 'payroll_criteria', entityId: created.id, ip: req.ip });
    req.flash('success', `Đã thêm tiêu chí: ${name.trim()}`);
  } catch (err) {
    req.flash('error', err.code === '23505' ? 'Key đã tồn tại, hãy dùng key khác' : 'Lỗi tạo tiêu chí');
  }
  res.redirect('/payroll-settings');
};

const update = async (req, res) => {
  const { id } = req.params;
  const { name, unit, default_value, applies_to, description, is_active, effective_when, note } = req.body;
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  try {
    const old = await query('SELECT * FROM payroll_criteria WHERE id=$1', [id]);
    if (!old.rows.length) return wantsJson ? res.status(404).json({ error: 'Không tìm thấy tiêu chí' }) : res.redirect('/payroll-settings');
    const prev = old.rows[0];
    const effectiveFrom = effective_when === 'next' ? monthStart(1) : monthStart(0);
    const newActive = is_active === undefined ? prev.is_active : (is_active === 'true' || is_active === true);
    const newName = name || prev.name;
    const newUnit = unit || prev.unit;
    const newValue = default_value !== undefined && default_value !== '' ? parseFloat(default_value) : prev.default_value;
    const newApplies = applies_to || prev.applies_to;
    const newDesc = description !== undefined ? description : prev.description;

    await query(
      `UPDATE payroll_criteria SET name=$1, unit=$2, default_value=$3, applies_to=$4, description=$5,
         is_active=$6, effective_from=$7, updated_by=$8, updated_at=NOW() WHERE id=$9`,
      [newName, newUnit, newValue, newApplies, newDesc, newActive, effectiveFrom, req.session.userId, id]
    );

    const fields = [
      ['name', prev.name, newName],
      ['unit', prev.unit, newUnit],
      ['default_value', String(prev.default_value), String(newValue)],
      ['applies_to', prev.applies_to, newApplies],
      ['is_active', String(prev.is_active), String(newActive)],
    ];
    for (const [field, oldVal, newVal] of fields) {
      if (String(oldVal) !== String(newVal)) {
        await writeAudit({
          criteriaId: id, criteriaKey: prev.key, criteriaName: prev.name, category: prev.category,
          action: 'UPDATE', fieldChanged: field, oldValue: oldVal, newValue: newVal, effectiveFrom,
          changedBy: req.session.userId, changedByName: req.session.userName || 'unknown', ip: req.ip, note
        });
      }
    }
    logActivity(req.session.userId, 'PAYROLL_CRITERIA_UPDATE', `Cập nhật tiêu chí lương: ${newName}`,
      { entityType: 'payroll_criteria', entityId: id, ip: req.ip });

    if (wantsJson) return res.json({ success: true, message: `Đã cập nhật: ${newName}` });
    req.flash('success', `Đã cập nhật: ${newName}`);
    res.redirect('/payroll-settings');
  } catch (err) {
    console.error('payroll update:', err.message);
    if (wantsJson) return res.status(500).json({ error: err.message });
    req.flash('error', 'Lỗi cập nhật tiêu chí');
    res.redirect('/payroll-settings');
  }
};

const remove = async (req, res) => {
  const { id } = req.params;
  try {
    const c = await query('SELECT * FROM payroll_criteria WHERE id=$1', [id]);
    if (!c.rows.length) {
      req.flash('error', 'Không tìm thấy tiêu chí');
      return res.redirect('/payroll-settings');
    }
    const prev = c.rows[0];
    await query('DELETE FROM payroll_criteria WHERE id=$1', [id]);
    await writeAudit({
      criteriaId: id, criteriaKey: prev.key, criteriaName: prev.name, category: prev.category,
      action: 'DELETE', fieldChanged: null, oldValue: JSON.stringify(prev), newValue: null, effectiveFrom: null,
      changedBy: req.session.userId, changedByName: req.session.userName || 'unknown', ip: req.ip
    });
    logActivity(req.session.userId, 'PAYROLL_CRITERIA_DELETE', `Xóa tiêu chí lương: ${prev.name}`,
      { entityType: 'payroll_criteria', entityId: id, ip: req.ip });
    req.flash('success', `Đã xóa tiêu chí: ${prev.name}`);
  } catch (err) {
    req.flash('error', 'Lỗi xóa tiêu chí');
  }
  res.redirect('/payroll-settings');
};

// Ước tính tác động tài chính trước khi lưu giá trị mới (AJAX)
const preview = async (req, res) => {
  const { id } = req.params;
  const { new_value } = req.query;
  try {
    const c = await query('SELECT * FROM payroll_criteria WHERE id=$1', [id]);
    if (!c.rows.length) return res.json({ error: 'Không tìm thấy tiêu chí' });
    const crit = c.rows[0];
    const oldVal = parseFloat(crit.default_value);
    const newVal = parseFloat(new_value);
    if (isNaN(newVal)) return res.json({ error: 'Giá trị không hợp lệ' });

    const diff = newVal - oldVal;
    if (diff === 0) return res.json({ affected: 0, diff_per_person: 0, diff_total: 0, employees: [] });

    let userFilter = '';
    const params = [];
    if (crit.applies_to !== 'all') { params.push(crit.applies_to); userFilter = ' AND role=$1'; }
    const emp = await query(
      `SELECT id, full_name, role, department FROM users WHERE is_active=true${userFilter} ORDER BY full_name`, params);

    let diffPerPerson = diff;
    if (crit.unit === 'percent') {
      const avgSalary = 15000000; // ước tính trên lương trung bình tham khảo
      diffPerPerson = (diff / 100) * avgSalary;
    }
    const affected = emp.rows.length;
    const totalDiff = diffPerPerson * affected;

    res.json({
      criteria_name: crit.name, category: crit.category, old_value: oldVal, new_value: newVal, unit: crit.unit,
      diff_per_person: diffPerPerson, diff_total: totalDiff, affected,
      total_label: `${totalDiff >= 0 ? '+' : ''}${formatVND(totalDiff)}/tháng toàn công ty`,
      employees: emp.rows.slice(0, 10)
    });
  } catch (err) {
    console.error('payroll preview:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const auditLog = async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = 30;
  const { criteria_id, action, from, to } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (criteria_id) { params.push(criteria_id); where += ` AND pal.criteria_id=$${params.length}`; }
  if (action && ['CREATE', 'UPDATE', 'DELETE'].includes(action)) { params.push(action); where += ` AND pal.action=$${params.length}`; }
  if (from) { params.push(from); where += ` AND pal.changed_at >= $${params.length}`; }
  if (to) { params.push(to + ' 23:59:59'); where += ` AND pal.changed_at <= $${params.length}`; }

  try {
    const [logs, total, criteriaList] = await Promise.all([
      query(
        `SELECT pal.*, u.full_name AS changer_name
         FROM payroll_audit_logs pal LEFT JOIN users u ON u.id=pal.changed_by
         ${where} ORDER BY changed_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]),
      query(`SELECT COUNT(*)::int AS n FROM payroll_audit_logs pal ${where}`, params),
      query('SELECT id, name, category FROM payroll_criteria ORDER BY category, name')
    ]);
    res.render('payroll-settings/audit', {
      title: 'Nhật ký thay đổi lương',
      logs: logs.rows,
      criteriaList: criteriaList.rows,
      filters: { criteria_id, action, from, to },
      page, totalPages: Math.max(Math.ceil(total.rows[0].n / limit), 1)
    });
  } catch (err) {
    console.error('payroll auditLog:', err);
    res.redirect('/payroll-settings');
  }
};

module.exports = { index, create, update, remove, preview, auditLog };
