const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/warehouseController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', ctrl.index);
router.get('/items', ctrl.items);
router.get('/transactions', ctrl.transactions);
router.post('/transactions', requireRole('admin', 'warehouse', 'pm', 'director'), ctrl.createTransaction);

router.get('/items/create', requireRole('admin', 'director', 'warehouse', 'warehouse_keeper'), ctrl.getCreateItem);

// Create item: form posts to /warehouse/items
router.post('/items/create', requireRole('admin', 'director', 'warehouse', 'warehouse_keeper'), ctrl.postCreateItem);
router.post('/items', requireRole('admin', 'director', 'warehouse', 'warehouse_keeper'), ctrl.postCreateItem);

// Assignments
router.post('/assignments', requireRole('admin', 'warehouse', 'director'), ctrl.createAssignment);
router.get('/assignments', ctrl.assignments);
router.get('/assignments/:id', ctrl.assignmentDetail);
router.post('/assignments/:id/return', requireRole('admin', 'warehouse', 'director'), ctrl.returnAssignment);
router.post('/assignments/:id/sign', ctrl.signAssignment);

router.get('/items/:id', ctrl.itemDetail);
router.get('/items/:id/edit', requireRole('admin', 'director', 'warehouse', 'warehouse_keeper'), async (req, res) => {
  const { query } = require('../config/database');
  const [item, categories] = await Promise.all([
    query('SELECT * FROM warehouse_items WHERE id=$1', [req.params.id]),
    query('SELECT * FROM warehouse_categories ORDER BY name')
  ]);
  if (!item.rows.length) return res.redirect('/warehouse/items');
  res.render('warehouse/item-form', {
    title: 'Chỉnh sửa Vật tư',
    item: item.rows[0],
    categories: categories.rows
  });
});

// Edit item: form uses ?_method=PUT → PUT /items/:id
router.put('/items/:id', requireRole('admin', 'director', 'warehouse', 'warehouse_keeper'), ctrl.editItem);
router.post('/items/:id/edit', requireRole('admin', 'director', 'warehouse', 'warehouse_keeper'), ctrl.editItem);

module.exports = router;
