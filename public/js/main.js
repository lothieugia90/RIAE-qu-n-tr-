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
