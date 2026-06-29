const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// Public landing page - no auth required
router.get('/', async (req, res) => {
  // If already logged in, go to dashboard
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }

  try {
    // Fetch published news posts
    const newsResult = await query(`
      SELECT p.id, p.title, p.slug, p.excerpt, p.thumbnail, p.published_at, p.view_count,
             u.full_name as author_name
      FROM posts p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE p.status = 'published'
      ORDER BY p.published_at DESC
      LIMIT 3
    `).catch(() => ({ rows: [] }));

    // Fetch featured projects
    const projectsResult = await query(`
      SELECT id, title, description, thumbnail, images, client, location, completed_at, tags
      FROM cms_projects
      WHERE is_published = true AND is_featured = true
      ORDER BY "order" ASC, created_at DESC
      LIMIT 6
    `).catch(() => ({ rows: [] }));

    res.render('home/index', {
      layout: false,
      title: 'RIAE — Giải pháp kỹ thuật toàn diện',
      news: newsResult.rows,
      projects: projectsResult.rows,
    });
  } catch (err) {
    console.error('Home error:', err.message);
    res.render('home/index', {
      layout: false,
      title: 'RIAE — Giải pháp kỹ thuật toàn diện',
      news: [],
      projects: [],
    });
  }
});

module.exports = router;
