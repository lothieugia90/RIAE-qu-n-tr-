const { query } = require('./database');

module.exports = async function migrateV5() {
  try {
    // Add columns to request_forms
    await query(`ALTER TABLE request_forms ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'other'`);

    // Add columns to requests
    await query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal'`);
    await query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS attachment_urls JSONB DEFAULT '[]'`);
    await query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);

    // Add column to request_approvals
    await query(`ALTER TABLE request_approvals ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);

    // Indexes
    await query(`CREATE INDEX IF NOT EXISTS idx_requests_submitted_by ON requests(submitted_by)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)`);

    // Unique index for form name (active only) to support ON CONFLICT
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_form_name ON request_forms(name) WHERE is_active=true`);

    // Seed preset forms
    const forms = [
      {
        name: 'Xin nghỉ phép',
        description: 'Đơn xin nghỉ phép năm, nghỉ bệnh hoặc nghỉ không lương',
        category: 'admin',
        fields: [
          { label: 'Loại nghỉ', type: 'select', options: ['Nghỉ phép năm', 'Nghỉ bệnh', 'Nghỉ không lương'], required: true },
          { label: 'Từ ngày', type: 'date', required: true },
          { label: 'Đến ngày', type: 'date', required: true },
          { label: 'Số ngày nghỉ', type: 'number', required: true },
          { label: 'Lý do', type: 'textarea', required: true }
        ],
        approval_steps: [{ name: 'Trưởng bộ phận', approver_id: null }]
      },
      {
        name: 'Đi trễ / Về sớm',
        description: 'Đơn xin phép đi trễ hoặc về sớm',
        category: 'admin',
        fields: [
          { label: 'Ngày', type: 'date', required: true },
          { label: 'Loại', type: 'select', options: ['Đi trễ', 'Về sớm'], required: true },
          { label: 'Thời gian', type: 'text', required: true },
          { label: 'Lý do', type: 'textarea', required: true }
        ],
        approval_steps: [{ name: 'Trưởng bộ phận', approver_id: null }]
      },
      {
        name: 'Đề xuất mua sắm',
        description: 'Đề xuất mua vật tư, thiết bị, dịch vụ',
        category: 'finance',
        fields: [
          { label: 'Tên vật tư/thiết bị', type: 'text', required: true },
          { label: 'Số lượng', type: 'number', required: true },
          { label: 'Đơn giá ước tính (VNĐ)', type: 'number', required: false },
          { label: 'Nhà cung cấp đề xuất', type: 'text', required: false },
          { label: 'Mục đích sử dụng', type: 'textarea', required: true }
        ],
        approval_steps: [{ name: 'Trưởng bộ phận', approver_id: null }, { name: 'Ban Giám đốc', approver_id: null }]
      },
      {
        name: 'Tạm ứng chi phí',
        description: 'Đề nghị tạm ứng tiền mặt hoặc chuyển khoản',
        category: 'finance',
        fields: [
          { label: 'Mục đích tạm ứng', type: 'textarea', required: true },
          { label: 'Số tiền (VNĐ)', type: 'number', required: true },
          { label: 'Ngày cần tiền', type: 'date', required: true },
          { label: 'Phương thức thanh toán', type: 'select', options: ['Tiền mặt', 'Chuyển khoản'], required: true }
        ],
        approval_steps: [{ name: 'Trưởng bộ phận', approver_id: null }, { name: 'Kế toán', approver_id: null }]
      },
      {
        name: 'Yêu cầu thay đổi dự án',
        description: 'Đề xuất thay đổi phạm vi, timeline hoặc chi phí dự án',
        category: 'project',
        fields: [
          { label: 'Tên dự án', type: 'text', required: true },
          { label: 'Mô tả thay đổi', type: 'textarea', required: true },
          { label: 'Lý do thay đổi', type: 'textarea', required: true },
          { label: 'Ảnh hưởng đến timeline', type: 'select', options: ['Không ảnh hưởng', 'Tăng thêm', 'Rút ngắn'], required: true },
          { label: 'Ảnh hưởng đến chi phí (VNĐ)', type: 'number', required: false }
        ],
        approval_steps: [{ name: 'Quản lý dự án', approver_id: null }, { name: 'Ban Giám đốc', approver_id: null }]
      },
      {
        name: 'Phê duyệt tài liệu',
        description: 'Yêu cầu phê duyệt tài liệu nội bộ, hướng dẫn, quy trình',
        category: 'project',
        fields: [
          { label: 'Tên tài liệu', type: 'text', required: true },
          { label: 'Phiên bản', type: 'text', required: false },
          { label: 'Mô tả nội dung', type: 'textarea', required: true },
          { label: 'Ngày hiệu lực', type: 'date', required: false }
        ],
        approval_steps: [{ name: 'Trưởng bộ phận', approver_id: null }]
      }
    ];

    for (const f of forms) {
      // Fill approver_id with first admin/director user
      const stepsWithApprover = f.approval_steps.map(s => ({ ...s }));

      const exists = await query(`SELECT 1 FROM request_forms WHERE name=$1 AND is_active=true LIMIT 1`, [f.name]);
      if (!exists.rows.length) {
        await query(
          `INSERT INTO request_forms (name, description, category, fields, approval_steps, is_active, created_by)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, true,
             (SELECT id FROM users WHERE role IN ('admin','director') ORDER BY id LIMIT 1))`,
          [f.name, f.description, f.category, JSON.stringify(f.fields), JSON.stringify(stepsWithApprover)]
        );
      }
    }

    console.log('[migrate-v5] Done');
  } catch (err) {
    console.error('[migrate-v5] Error:', err.message);
  }
};
