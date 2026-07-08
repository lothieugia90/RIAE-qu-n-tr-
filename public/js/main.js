// Sidebar toggle
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menuBtn');
const overlay = document.getElementById('sidebarOverlay');
const closeBtn = document.getElementById('sidebarCloseBtn');

function openSidebar() {
  sidebar.classList.add('open');
  overlay.classList.add('open');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
}

if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      openSidebar();
    } else {
      sidebar.classList.toggle('collapsed');
      document.getElementById('mainContent').style.flex = '1';
    }
  });
}
if (overlay) overlay.addEventListener('click', closeSidebar);
if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

// Auto-hide flash messages
document.querySelectorAll('.flash').forEach(el => {
  setTimeout(() => {
    el.style.transition = 'opacity .5s ease, max-height .5s ease';
    el.style.opacity = '0';
    el.style.maxHeight = '0';
    el.style.overflow = 'hidden';
    setTimeout(() => el.remove(), 500);
  }, 5000);
});

// Active nav link based on path
(function() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href !== '/' && path.startsWith(href)) {
      link.classList.add('active');
    }
  });
})();

// Confirm delete forms
document.querySelectorAll('[data-confirm]').forEach(el => {
  el.addEventListener('click', e => {
    if (!confirm(el.dataset.confirm)) e.preventDefault();
  });
});

// Popup "Thêm mới": link có data-modal mở trang form trong dialog giữa màn hình
// (trang form render với ?modal=1 → layout tối giản). Sau khi submit thành công,
// framebuster trong layout chính tự thoát iframe và điều hướng cả trang.
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-modal]');
  if (!link) return;
  e.preventDefault();
  const url = link.href + (link.href.includes('?') ? '&' : '?') + 'modal=1';
  let dlg = document.getElementById('globalFormModal');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'globalFormModal';
    dlg.className = 'form-modal';
    dlg.innerHTML = '<button type="button" class="form-modal-close" aria-label="Đóng">&times;</button>' +
                    '<iframe class="form-modal-frame" title="Form"></iframe>';
    document.body.appendChild(dlg);
    dlg.querySelector('.form-modal-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  }
  dlg.querySelector('.form-modal-frame').src = url;
  dlg.showModal();
});

// Prompt for new password before submitting reset-password forms
document.querySelectorAll('[data-password-prompt]').forEach(form => {
  form.addEventListener('submit', e => {
    const pwd = prompt('Nhập mật khẩu mới (tối thiểu 8 ký tự), để trống để tự tạo mật khẩu ngẫu nhiên:');
    if (pwd === null) { e.preventDefault(); return; }
    if (pwd && pwd.length < 8) {
      alert('Mật khẩu phải có ít nhất 8 ký tự');
      e.preventDefault();
      return;
    }
    form.querySelector('input[name="new_password"]').value = pwd;
  });
});

// Tab system
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    const container = btn.closest('.tabs-container') || document;
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pane = container.querySelector('#' + target);
    if (pane) pane.classList.add('active');
  });
});
