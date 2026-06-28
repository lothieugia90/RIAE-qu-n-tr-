const { query } = require('../config/database');
const path = require('path');

const index = async (req, res) => {
  try {
    const { type } = req.query;
    let sql = `SELECT a.*, u.full_name as author_name, u.avatar_url as author_avatar,
               (SELECT COUNT(*)::int FROM announcement_reads ar WHERE ar.announcement_id=a.id) as read_count,
               (SELECT COUNT(*)::int FROM announcement_reactions ar2 WHERE ar2.announcement_id=a.id AND ar2.reaction='seen') as seen_count,
               (SELECT COUNT(*)::int FROM announcement_files af WHERE af.announcement_id=a.id) as file_count,
               EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id=a.id AND ar.user_id=$1) as is_read,
               EXISTS(SELECT 1 FROM announcement_reactions ar2 WHERE ar2.announcement_id=a.id AND ar2.user_id=$1 AND ar2.reaction='seen') as has_reacted
               FROM announcements a LEFT JOIN users u ON u.id=a.created_by
               WHERE a.is_published=true AND (a.expires_at IS NULL OR a.expires_at > NOW())`;
    const params = [req.session.userId];
    if (type) { params.push(type); sql += ` AND a.type=$${params.length}`; }
    sql += ' ORDER BY a.is_pinned DESC, a.published_at DESC';

    const [announcements, unreadResult] = await Promise.all([
      query(sql, params),
      query(`SELECT COUNT(*)::int as count FROM announcements a
             WHERE a.is_published=true AND (a.expires_at IS NULL OR a.expires_at > NOW())
             AND NOT EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id=a.id AND ar.user_id=$1)`,
             [req.session.userId])
    ]);

    res.render('announcements/index', {
      title: 'Thông báo & Quyết định',
      announcements: announcements.rows,
      unreadCount: unreadResult.rows[0].count,
      filters: req.query
    });
  } catch (err) { console.error(err); res.redirect('/dashboard'); }
};

const getCreate = (req, res) => {
  res.render('announcements/form', { title: 'Đăng Thông báo mới', announcement: null });
};

const postCreate = async (req, res) => {
  const { title, content, type, is_pinned, expires_at } = req.body;
  try {
    const result = await query(
      `INSERT INTO announcements (title,content,type,is_pinned,expires_at,created_by,is_published,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,NOW()) RETURNING id`,
      [title, content, type || 'general', is_pinned === 'on', expires_at || null, req.session.userId]
    );
    const annId = result.rows[0].id;

    // Save uploaded files
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        const relPath = '/uploads/announcements/' + f.filename;
        await query(
          `INSERT INTO announcement_files (announcement_id, filename, original_name, mime_type, file_size, file_path)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [annId, f.filename, f.originalname, f.mimetype, f.size, relPath]
        );
      }
    }

    req.flash('success', 'Đã đăng thông báo thành công');
    res.redirect('/announcements/' + annId);
  } catch (err) {
    req.flash('error', 'Lỗi đăng thông báo: ' + err.message);
    res.redirect('/announcements/create');
  }
};

const detail = async (req, res) => {
  try {
    const [annResult, filesResult, reactionResult] = await Promise.all([
      query(`SELECT a.*, u.full_name as author_name, u.avatar_url as author_avatar,
             u.role as author_role,
             (SELECT COUNT(*)::int FROM announcement_reads ar WHERE ar.announcement_id=a.id) as read_count,
             (SELECT COUNT(*)::int FROM announcement_reactions ar2 WHERE ar2.announcement_id=a.id AND ar2.reaction='seen') as seen_count,
             EXISTS(SELECT 1 FROM announcement_reactions ar2 WHERE ar2.announcement_id=a.id AND ar2.user_id=$2 AND ar2.reaction='seen') as has_reacted
             FROM announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1`,
             [req.params.id, req.session.userId]),
      query(`SELECT * FROM announcement_files WHERE announcement_id=$1 ORDER BY created_at`, [req.params.id]),
      query(`SELECT ar.reaction, u.full_name, u.avatar_url FROM announcement_reactions ar
             JOIN users u ON u.id=ar.user_id WHERE ar.announcement_id=$1 AND ar.reaction='seen' LIMIT 20`,
             [req.params.id])
    ]);

    if (!annResult.rows.length) { req.flash('error', 'Không tìm thấy thông báo'); return res.redirect('/announcements'); }

    // Mark as read
    await query(
      'INSERT INTO announcement_reads (announcement_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, req.session.userId]
    );

    res.render('announcements/detail', {
      title: annResult.rows[0].title,
      announcement: annResult.rows[0],
      files: filesResult.rows,
      reactions: reactionResult.rows
    });
  } catch (err) { console.error(err); res.redirect('/announcements'); }
};

const getEditForm = async (req, res) => {
  const [annResult, filesResult] = await Promise.all([
    query('SELECT * FROM announcements WHERE id=$1', [req.params.id]),
    query('SELECT * FROM announcement_files WHERE announcement_id=$1', [req.params.id])
  ]);
  if (!annResult.rows.length) return res.redirect('/announcements');
  res.render('announcements/form', {
    title: 'Chỉnh sửa Thông báo',
    announcement: annResult.rows[0],
    existingFiles: filesResult.rows
  });
};

const edit = async (req, res) => {
  const { title, content, type, is_pinned, expires_at } = req.body;
  try {
    await query(
      'UPDATE announcements SET title=$1,content=$2,type=$3,is_pinned=$4,expires_at=$5,updated_at=NOW() WHERE id=$6',
      [title, content, type, is_pinned === 'on', expires_at || null, req.params.id]
    );
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        const relPath = '/uploads/announcements/' + f.filename;
        await query(
          `INSERT INTO announcement_files (announcement_id, filename, original_name, mime_type, file_size, file_path)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.id, f.filename, f.originalname, f.mimetype, f.size, relPath]
        );
      }
    }
    req.flash('success', 'Đã cập nhật thông báo');
    res.redirect('/announcements/' + req.params.id);
  } catch (err) {
    req.flash('error', 'Lỗi cập nhật');
    res.redirect('/announcements/' + req.params.id + '/edit');
  }
};

const deleteAnnouncement = async (req, res) => {
  await query('UPDATE announcements SET is_published=false WHERE id=$1', [req.params.id]);
  req.flash('success', 'Đã xóa thông báo');
  res.redirect('/announcements');
};

const markRead = async (req, res) => {
  try {
    await query(
      'INSERT INTO announcement_reads (announcement_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, req.session.userId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const react = async (req, res) => {
  const { reaction = 'seen' } = req.body;
  try {
    const existing = await query(
      'SELECT id FROM announcement_reactions WHERE announcement_id=$1 AND user_id=$2 AND reaction=$3',
      [req.params.id, req.session.userId, reaction]
    );
    if (existing.rows.length) {
      await query('DELETE FROM announcement_reactions WHERE announcement_id=$1 AND user_id=$2 AND reaction=$3',
        [req.params.id, req.session.userId, reaction]);
      res.json({ success: true, toggled: false });
    } else {
      await query('INSERT INTO announcement_reactions (announcement_id,user_id,reaction) VALUES ($1,$2,$3)',
        [req.params.id, req.session.userId, reaction]);
      res.json({ success: true, toggled: true });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const deleteFile = async (req, res) => {
  try {
    const fs = require('fs');
    const fileResult = await query('SELECT * FROM announcement_files WHERE id=$1', [req.params.fileId]);
    if (fileResult.rows.length) {
      const fullPath = path.join(__dirname, '../../public', fileResult.rows[0].file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await query('DELETE FROM announcement_files WHERE id=$1', [req.params.fileId]);
    }
    req.flash('success', 'Đã xóa file');
    res.redirect('/announcements/' + req.params.id + '/edit');
  } catch (err) { req.flash('error', 'Lỗi xóa file'); res.redirect('back'); }
};

module.exports = { index, getCreate, postCreate, detail, getEditForm, edit, deleteAnnouncement, markRead, react, deleteFile };
