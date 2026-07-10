const fs = require('fs');
const path = require('path');
const { query } = require('../config/database');
const { getPermLevel } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const TYPE_META = {
  general:     { label: 'Thông báo chung', icon: 'fa-bullhorn',       bg: '#EFF6FF', color: '#2563EB' },
  decision:    { label: 'Quyết định',       icon: 'fa-gavel',          bg: '#EDE9FE', color: '#7C3AED' },
  policy:      { label: 'Quy chế',          icon: 'fa-scroll',        bg: '#FEF3C7', color: '#D97706' },
  appointment: { label: 'Bổ nhiệm',         icon: 'fa-user-tie',      bg: '#DCFCE7', color: '#16A34A' },
  urgent:      { label: 'Khẩn cấp',         icon: 'fa-triangle-exclamation', bg: '#FEE2E2', color: '#DC2626' },
};

const index = async (req, res) => {
  try {
    const { type } = req.query;
    let sql = `SELECT a.*, u.full_name AS author_name, u.avatar_url AS author_avatar,
               (SELECT COUNT(*)::int FROM announcement_reads ar WHERE ar.announcement_id=a.id) AS read_count,
               (SELECT COUNT(*)::int FROM announcement_files af WHERE af.announcement_id=a.id) AS file_count,
               EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id=a.id AND ar.user_id=$1) AS is_read
               FROM announcements a LEFT JOIN users u ON u.id=a.created_by
               WHERE a.is_published=true AND (a.expires_at IS NULL OR a.expires_at > NOW())`;
    const params = [req.session.userId];
    if (type && TYPE_META[type]) { params.push(type); sql += ` AND a.type=$${params.length}`; }
    sql += ' ORDER BY a.is_pinned DESC, a.published_at DESC';

    const [announcements, unread] = await Promise.all([
      query(sql, params),
      query(
        `SELECT COUNT(*)::int AS c FROM announcements a
         WHERE a.is_published=true AND (a.expires_at IS NULL OR a.expires_at > NOW())
         AND NOT EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id=a.id AND ar.user_id=$1)`,
        [req.session.userId])
    ]);

    const permLevel = await getPermLevel(req.session.userRole, 'announcements');
    res.render('announcements/index', {
      title: 'Bảng tin công ty',
      announcements: announcements.rows,
      unreadCount: unread.rows[0].c,
      filters: req.query,
      typeMeta: TYPE_META,
      permLevel
    });
  } catch (err) {
    console.error('announcements index:', err);
    req.flash('error', 'Lỗi tải bảng tin');
    res.redirect('/dashboard');
  }
};

const getCreate = (req, res) => {
  res.render('announcements/form', { title: 'Đăng thông báo mới', announcement: null, files: [], typeMeta: TYPE_META });
};

const postCreate = async (req, res) => {
  const { title, content, type, is_pinned, expires_at } = req.body;
  if (!title?.trim() || !content?.trim()) {
    req.flash('error', 'Vui lòng nhập tiêu đề và nội dung');
    return res.redirect('/announcements/create');
  }
  try {
    const result = await query(
      `INSERT INTO announcements (title, content, type, is_pinned, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [title.trim(), content.trim(), TYPE_META[type] ? type : 'general',
       is_pinned === 'on' || is_pinned === 'true', expires_at || null, req.session.userId]
    );
    const annId = result.rows[0].id;
    for (const f of req.files || []) {
      await query(
        `INSERT INTO announcement_files (announcement_id, file_name, original_name, file_size, file_path)
         VALUES ($1,$2,$3,$4,$5)`,
        [annId, f.filename, f.originalname, f.size, '/uploads/announcements/' + f.filename]
      );
    }
    logActivity(req.session.userId, 'ANNOUNCEMENT_CREATE', `Đăng thông báo: ${title.trim()}`,
      { entityType: 'announcement', entityId: annId, ip: req.ip });
    req.flash('success', 'Đã đăng thông báo thành công');
    res.redirect('/announcements/' + annId);
  } catch (err) {
    console.error('announcements create:', err.message);
    req.flash('error', 'Lỗi đăng thông báo');
    res.redirect('/announcements/create');
  }
};

const detail = async (req, res) => {
  try {
    const [ann, files] = await Promise.all([
      query(
        `SELECT a.*, u.full_name AS author_name, u.avatar_url AS author_avatar, u.role AS author_role,
                (SELECT COUNT(*)::int FROM announcement_reads ar WHERE ar.announcement_id=a.id) AS read_count
         FROM announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1`, [req.params.id]),
      query('SELECT * FROM announcement_files WHERE announcement_id=$1 ORDER BY created_at', [req.params.id])
    ]);
    if (!ann.rows.length) {
      req.flash('error', 'Không tìm thấy thông báo');
      return res.redirect('/announcements');
    }
    await query(
      'INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, req.session.userId]
    );
    const permLevel = await getPermLevel(req.session.userRole, 'announcements');
    res.render('announcements/detail', {
      title: ann.rows[0].title,
      announcement: ann.rows[0],
      files: files.rows,
      typeMeta: TYPE_META,
      permLevel
    });
  } catch (err) {
    console.error('announcements detail:', err);
    res.redirect('/announcements');
  }
};

const getEdit = async (req, res) => {
  try {
    const [ann, files] = await Promise.all([
      query('SELECT * FROM announcements WHERE id=$1', [req.params.id]),
      query('SELECT * FROM announcement_files WHERE announcement_id=$1 ORDER BY created_at', [req.params.id])
    ]);
    if (!ann.rows.length) return res.redirect('/announcements');
    res.render('announcements/form', {
      title: 'Chỉnh sửa thông báo',
      announcement: ann.rows[0],
      files: files.rows,
      typeMeta: TYPE_META
    });
  } catch (err) { console.error(err); res.redirect('/announcements'); }
};

const postEdit = async (req, res) => {
  const { title, content, type, is_pinned, expires_at } = req.body;
  if (!title?.trim() || !content?.trim()) {
    req.flash('error', 'Vui lòng nhập tiêu đề và nội dung');
    return res.redirect('/announcements/' + req.params.id + '/edit');
  }
  try {
    await query(
      `UPDATE announcements SET title=$1, content=$2, type=$3, is_pinned=$4, expires_at=$5, updated_at=NOW()
       WHERE id=$6`,
      [title.trim(), content.trim(), TYPE_META[type] ? type : 'general',
       is_pinned === 'on' || is_pinned === 'true', expires_at || null, req.params.id]
    );
    for (const f of req.files || []) {
      await query(
        `INSERT INTO announcement_files (announcement_id, file_name, original_name, file_size, file_path)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, f.filename, f.originalname, f.size, '/uploads/announcements/' + f.filename]
      );
    }
    logActivity(req.session.userId, 'ANNOUNCEMENT_UPDATE', `Cập nhật thông báo: ${title.trim()}`,
      { entityType: 'announcement', entityId: req.params.id, ip: req.ip });
    req.flash('success', 'Đã cập nhật thông báo');
    res.redirect('/announcements/' + req.params.id);
  } catch (err) {
    console.error('announcements edit:', err.message);
    req.flash('error', 'Lỗi cập nhật thông báo');
    res.redirect('/announcements/' + req.params.id + '/edit');
  }
};

const remove = async (req, res) => {
  try {
    const r = await query('UPDATE announcements SET is_published=false WHERE id=$1 RETURNING title', [req.params.id]);
    if (r.rows.length) {
      logActivity(req.session.userId, 'ANNOUNCEMENT_DELETE', `Gỡ thông báo: ${r.rows[0].title}`,
        { entityType: 'announcement', entityId: req.params.id, ip: req.ip });
    }
    req.flash('success', 'Đã gỡ thông báo');
  } catch (err) { req.flash('error', 'Lỗi gỡ thông báo'); }
  res.redirect('/announcements');
};

const deleteFile = async (req, res) => {
  try {
    const f = await query('SELECT * FROM announcement_files WHERE id=$1 AND announcement_id=$2', [req.params.fileId, req.params.id]);
    if (f.rows.length) {
      const { uploadPathFromUrl } = require('../config/uploads');
      const fullPath = uploadPathFromUrl(f.rows[0].file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await query('DELETE FROM announcement_files WHERE id=$1', [req.params.fileId]);
    }
    req.flash('success', 'Đã xóa file đính kèm');
  } catch (err) { req.flash('error', 'Lỗi xóa file'); }
  res.redirect('/announcements/' + req.params.id + '/edit');
};

module.exports = { index, getCreate, postCreate, detail, getEdit, postEdit, remove, deleteFile, TYPE_META };
