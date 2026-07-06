// Nguồn sự thật duy nhất về vai trò và module của hệ thống.
// Thêm vai trò/module mới: sửa file này + seed quyền trong migration mới.

const ROLES = [
  { value: 'admin',             label: 'Quản trị viên',               group: 'Hệ thống' },
  { value: 'director',          label: 'Ban lãnh đạo',                group: 'Lãnh đạo' },
  { value: 'pm',                label: 'Quản lý Dự án (PM)',          group: 'Quản lý' },
  { value: 'head_tech',         label: 'Trưởng phòng Kỹ thuật',       group: 'Quản lý' },
  { value: 'head_hr',           label: 'Trưởng phòng Nhân sự',        group: 'Quản lý' },
  { value: 'head_sales',        label: 'Trưởng phòng Kinh doanh',     group: 'Quản lý' },
  { value: 'engineer',          label: 'Kỹ sư',                       group: 'Kỹ thuật' },
  { value: 'field_supervisor',  label: 'Giám sát hiện trường',        group: 'Kỹ thuật' },
  { value: 'tech_deploy',       label: 'Kỹ thuật triển khai',         group: 'Kỹ thuật' },
  { value: 'hr',                label: 'Nhân sự (HR)',                group: 'Hỗ trợ' },
  { value: 'warehouse',         label: 'Nhân viên Kho',               group: 'Hỗ trợ' },
  { value: 'warehouse_keeper',  label: 'Thủ kho',                     group: 'Hỗ trợ' },
  { value: 'accountant',        label: 'Kế toán',                     group: 'Hỗ trợ' },
];

const ROLE_VALUES = ROLES.map(r => r.value);
const ROLE_LABELS = Object.fromEntries(ROLES.map(r => [r.value, r.label]));

// Vai trò kế thừa quyền truy cập của các vai trò gốc trong requireRole()
const ROLE_INHERIT = {
  head_tech:        ['pm', 'engineer'],
  head_hr:          ['hr'],
  head_sales:       ['pm'],
  field_supervisor: ['pm', 'engineer'],
  tech_deploy:      ['engineer'],
  warehouse_keeper: ['warehouse'],
  accountant:       [],
};

// Module hiện có (GĐ A-D). Sẽ bổ sung sau: payroll (C.2)
const MODULES = [
  { key: 'dashboard',   label: 'Dashboard' },
  { key: 'projects',    label: 'Dự án' },
  { key: 'tasks',       label: 'Công việc' },
  { key: 'hr',          label: 'Nhân sự' },
  { key: 'attendance',  label: 'Chấm công' },
  { key: 'requests',    label: 'Phê duyệt' },
  { key: 'warehouse',   label: 'Kho vật tư' },
  { key: 'partners',    label: 'Đối tác' },
  { key: 'quotes',      label: 'Báo giá' },
  { key: 'chat',        label: 'Chat nội bộ' },
  { key: 'users',       label: 'Người dùng' },
  { key: 'permissions', label: 'Phân quyền' },
  { key: 'audit',       label: 'Nhật ký hệ thống' },
];

// Thứ tự mức quyền để so sánh: none < view < edit < full
const PERM_LEVELS = ['none', 'view', 'edit', 'full'];

module.exports = { ROLES, ROLE_VALUES, ROLE_LABELS, ROLE_INHERIT, MODULES, PERM_LEVELS };
