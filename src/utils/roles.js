const ROLES = [
  { value: 'admin',             label: 'Admin',                       group: 'Hệ thống' },
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

// New roles inherit access from these base roles for requireRole() checks
const ROLE_INHERIT = {
  head_tech:        ['pm', 'engineer'],
  head_hr:          ['hr'],
  head_sales:       ['pm'],
  field_supervisor: ['pm', 'engineer'],
  tech_deploy:      ['engineer'],
  warehouse_keeper: ['warehouse'],
  accountant:       [],
};

const MODULES = [
  { key: 'dashboard',     label: 'Dashboard' },
  { key: 'hr',            label: 'Nhân sự' },
  { key: 'projects',      label: 'Dự án' },
  { key: 'tasks',         label: 'Công việc' },
  { key: 'warehouse',     label: 'Kho bãi' },
  { key: 'attendance',    label: 'Chấm công' },
  { key: 'payroll',       label: 'Lương' },
  { key: 'announcements', label: 'Thông báo' },
  { key: 'partners',      label: 'Đối tác' },
  { key: 'quotes',        label: 'Báo giá' },
  { key: 'requests',      label: 'Yêu cầu' },
];

const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r.value, r.label]));

// Default role_permissions seed data
const DEFAULT_PERMISSIONS = {
  admin:            { dashboard:'full',   hr:'full',   projects:'full',   tasks:'full',   warehouse:'full',   attendance:'full',   payroll:'full',   announcements:'full',   partners:'full',   quotes:'full',   requests:'full'   },
  director:         { dashboard:'full',   hr:'manage', projects:'full',   tasks:'full',   warehouse:'manage', attendance:'full',   payroll:'full',   announcements:'full',   partners:'manage', quotes:'manage', requests:'full'   },
  pm:               { dashboard:'view',   hr:'none',   projects:'manage', tasks:'full',   warehouse:'view',   attendance:'view',   payroll:'none',   announcements:'manage', partners:'view',   quotes:'manage', requests:'manage' },
  head_tech:        { dashboard:'view',   hr:'none',   projects:'view',   tasks:'manage', warehouse:'view',   attendance:'view',   payroll:'none',   announcements:'view',   partners:'none',   quotes:'none',   requests:'view'   },
  head_hr:          { dashboard:'view',   hr:'full',   projects:'none',   tasks:'view',   warehouse:'none',   attendance:'full',   payroll:'manage', announcements:'view',   partners:'none',   quotes:'none',   requests:'manage' },
  head_sales:       { dashboard:'view',   hr:'none',   projects:'view',   tasks:'view',   warehouse:'none',   attendance:'none',   payroll:'none',   announcements:'view',   partners:'manage', quotes:'manage', requests:'manage' },
  engineer:         { dashboard:'view',   hr:'none',   projects:'view',   tasks:'manage', warehouse:'view',   attendance:'view',   payroll:'none',   announcements:'view',   partners:'none',   quotes:'none',   requests:'view'   },
  field_supervisor: { dashboard:'view',   hr:'none',   projects:'view',   tasks:'manage', warehouse:'view',   attendance:'view',   payroll:'none',   announcements:'view',   partners:'none',   quotes:'none',   requests:'view'   },
  tech_deploy:      { dashboard:'view',   hr:'none',   projects:'view',   tasks:'manage', warehouse:'none',   attendance:'view',   payroll:'none',   announcements:'view',   partners:'none',   quotes:'none',   requests:'view'   },
  hr:               { dashboard:'view',   hr:'manage', projects:'none',   tasks:'view',   warehouse:'none',   attendance:'manage', payroll:'view',   announcements:'view',   partners:'none',   quotes:'none',   requests:'manage' },
  warehouse:        { dashboard:'view',   hr:'none',   projects:'none',   tasks:'view',   warehouse:'manage', attendance:'view',   payroll:'none',   announcements:'view',   partners:'none',   quotes:'none',   requests:'view'   },
  warehouse_keeper: { dashboard:'view',   hr:'none',   projects:'none',   tasks:'view',   warehouse:'full',   attendance:'view',   payroll:'none',   announcements:'view',   partners:'none',   quotes:'none',   requests:'view'   },
  accountant:       { dashboard:'view',   hr:'none',   projects:'view',   tasks:'none',   warehouse:'view',   attendance:'view',   payroll:'full',   announcements:'view',   partners:'view',   quotes:'view',   requests:'view'   },
};

module.exports = { ROLES, ROLE_INHERIT, MODULES, ROLE_LABEL, DEFAULT_PERMISSIONS };
