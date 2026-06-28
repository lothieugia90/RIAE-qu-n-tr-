const { query } = require('../config/database');

const ALLOWED_ROLES = ['admin', 'director', 'hr'];

// ─── helpers ────────────────────────────────────────────────────────────────
function monthStart(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
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

// ─── index ──────────────────────────────────────────────────────────────────
const index = async (req, res) => {
  try {
    const [criteria, recentLogs] = await Promise.all([
      query(`SELECT * FROM payroll_criteria ORDER BY category, name`),
      query(`SELECT pal.*, u.full_name as changer_name
             FROM payroll_audit_logs pal
             LEFT JOIN users u ON u.id = pal.changed_by
             ORDER BY changed_at DESC LIMIT 30`)
    ]);

    const grouped = { allowance: [], overtime: [], deduction: [] };
    criteria.rows.forEach(r => { if (grouped[r.category]) grouped[r.category].push(r); });

    res.render('payroll-settings/index', {
      title: 'Cấu hình Lương & Phụ cấp',
      grouped,
      recentLogs: recentLogs.rows
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Lỗi tải cấu hình lương');
    res.redirect('/dashboard');
  }
};

// ─── create ─────────────────────────────────────────────────────────────────
const create = async (req, res) => {
  const { category, name, key, unit, default_value, applies_to, description, effective_when } = req.body;
  try {
    const effectiveFrom = effective_when === 'next' ? monthStart(1) : monthStart(0);
    const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const result = await query(
      `INSERT INTO payroll_criteria
         (category,name,key,unit,default_value,applies_to,description,effective_from,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [category, name, safeKey, unit, parseFloat(default_value)||0,
       applies_to||'all', description||null, effectiveFrom, req.session.userId]
    );

    const created = result.rows[0];
    await writeAudit({
      criteriaId: created.id, criteriaKey: safeKey, criteriaName: name,
      category, action: 'CREATE',
      fieldChanged: 'all', oldValue: null, newValue: JSON.stringify({ unit, default_value }),
      effectiveFrom,
      changedBy: req.session.userId, changedByName: req.session.userName || 'unknown',
      ip: req.ip
    });

    req.flash('success', `Đã thêm tiêu chí: ${name}`);
    res.redirect('/payroll-settings');
  } catch (err) {
    console.error(err);
    req.flash('error', err.message.includes('unique') ? 'Key đã tồn tại, hãy dùng key khác' : 'Lỗi tạo tiêu chí');
    res.redirect('/payroll-settings');
  }
};

// ─── update ─────────────────────────────────────────────────────────────────
const update = async (req, res) => {
  const { id } = req.params;
  const { name, unit, default_value, applies_to, description, is_active, effective_when, note } = req.body;
  try {
    const old = await query(`SELECT * FROM payroll_criteria WHERE id=$1`, [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Không tìm thấy tiêu chí' });

    const prev = old.rows[0];
    const effectiveFrom = effective_when === 'next' ? monthStart(1) : monthStart(0);
    const newActive = is_active === undefined ? prev.is_active : (is_active === 'true' || is_active === true);

    await query(
      `UPDATE payroll_criteria
         SET name=$1, unit=$2, default_value=$3, applies_to=$4, description=$5,
             is_active=$6, effective_from=$7, updated_by=$8, updated_at=NOW()
       WHERE id=$9`,
      [name || prev.name, unit || prev.unit, parseFloat(default_value) || prev.default_value,
       applies_to || prev.applies_to, description !== undefined ? description : prev.description,
       newActive, effectiveFrom, req.session.userId, id]
    );

    // Log each changed field
    const fields = [
      ['name',          prev.name,                   name],
      ['unit',          prev.unit,                   unit],
      ['default_value', String(prev.default_value),  String(default_value)],
      ['applies_to',    prev.applies_to,             applies_to],
      ['is_active',     String(prev.is_active),      String(newActive)],
    ];
    for (const [field, oldVal, newVal] of fields) {
      if (newVal !== undefined && String(oldVal) !== String(newVal)) {
        await writeAudit({
          criteriaId: id, criteriaKey: prev.key, criteriaName: prev.name,
          category: prev.category, action: 'UPDATE',
          fieldChanged: field, oldValue: oldVal, newValue: newVal,
          effectiveFrom,
          changedBy: req.session.userId, changedByName: req.session.userName || 'unknown',
          ip: req.ip, note
        });
      }
    }

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: `Đã cập nhật: ${name || prev.name}` });
    }
    req.flash('success', `Đã cập nhật: ${name || prev.name}`);
    res.redirect('/payroll-settings');
  } catch (err) {
    console.error(err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    req.flash('error', 'Lỗi cập nhật tiêu chí');
    res.redirect('/payroll-settings');
  }
};

// ─── delete ─────────────────────────────────────────────────────────────────
const remove = async (req, res) => {
  const { id } = req.params;
  try {
    const c = await query(`SELECT * FROM payroll_criteria WHERE id=$1`, [id]);
    if (!c.rows.length) return res.status(404).json({ error: 'Không tìm thấy' });

    const prev = c.rows[0];
    await query(`DELETE FROM payroll_criteria WHERE id=$1`, [id]);

    await writeAudit({
      criteriaId: id, criteriaKey: prev.key, criteriaName: prev.name,
      category: prev.category, action: 'DELETE',
      fieldChanged: null, oldValue: JSON.stringify(prev), newValue: null,
      effectiveFrom: null,
      changedBy: req.session.userId, changedByName: req.session.userName || 'unknown',
      ip: req.ip
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true });
    }
    req.flash('success', `Đã xóa tiêu chí: ${prev.name}`);
    res.redirect('/payroll-settings');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── preview impact ─────────────────────────────────────────────────────────
const preview = async (req, res) => {
  const { id } = req.params;
  const { new_value } = req.query;
  try {
    const c = await query(`SELECT * FROM payroll_criteria WHERE id=$1`, [id]);
    if (!c.rows.length) return res.json({ error: 'Không tìm thấy tiêu chí' });

    const crit = c.rows[0];
    const oldVal = parseFloat(crit.default_value);
    const newVal = parseFloat(new_value);
    if (isNaN(newVal)) return res.json({ error: 'Giá trị không hợp lệ' });

    const diff = newVal - oldVal;
    if (diff === 0) return res.json({ affected: 0, diff_per_person: 0, diff_total: 0, employees: [] });

    // Count affected employees by applies_to
    let userFilter = '';
    const params = [];
    if (crit.applies_to !== 'all') {
      userFilter = ` AND role=$1`;
      params.push(crit.applies_to);
    }
    const emp = await query(
      `SELECT id, full_name, role, department FROM users WHERE is_active=true${userFilter} ORDER BY full_name`,
      params
    );

    let diffPerPerson = diff;
    let label = '';
    if (crit.unit === 'percent') {
      // For percentage criteria (overtime, insurance) — approximate on avg salary 15M
      const avgSalary = 15000000;
      diffPerPerson = (diff / 100) * avgSalary;
      label = `${diff > 0 ? '+' : ''}${diff}% (≈ ${formatVND(diffPerPerson)}/người trên lương TB 15 triệu)`;
    } else {
      label = `${diff > 0 ? '+' : ''}${formatVND(diff)}/người`;
    }

    const affected = emp.rows.length;
    const totalDiff = diffPerPerson * affected;

    res.json({
      criteria_name: crit.name,
      category: crit.category,
      old_value: oldVal,
      new_value: newVal,
      unit: crit.unit,
      diff_per_person: diffPerPerson,
      diff_total: totalDiff,
      affected,
      label,
      total_label: `${totalDiff > 0 ? '+' : ''}${formatVND(totalDiff)}/tháng toàn công ty`,
      employees: emp.rows.slice(0, 10)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
}

// ─── audit log page ─────────────────────────────────────────────────────────
const auditLog = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;
  const { criteria_id, action, from, to } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  if (criteria_id) { params.push(criteria_id); where += ` AND pal.criteria_id=$${params.length}`; }
  if (action)      { params.push(action);       where += ` AND pal.action=$${params.length}`; }
  if (from)        { params.push(from);          where += ` AND pal.changed_at >= $${params.length}`; }
  if (to)          { params.push(to + ' 23:59:59'); where += ` AND pal.changed_at <= $${params.length}`; }

  const [logs, total, criteriaList] = await Promise.all([
    query(`SELECT pal.*, u.full_name as changer_name
           FROM payroll_audit_logs pal LEFT JOIN users u ON u.id=pal.changed_by
           ${where} ORDER BY changed_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, limit, offset]),
    query(`SELECT COUNT(*)::int as n FROM payroll_audit_logs pal ${where}`, params),
    query(`SELECT id, name, category FROM payroll_criteria ORDER BY category, name`)
  ]);

  res.render('payroll-settings/audit', {
    title: 'Nhật ký thay đổi lương',
    logs: logs.rows,
    criteriaList: criteriaList.rows,
    filters: { criteria_id, action, from, to },
    pagination: { page, limit, total: total.rows[0].n, pages: Math.ceil(total.rows[0].n / limit) }
  });
};

module.exports = { index, create, update, remove, preview, auditLog };
