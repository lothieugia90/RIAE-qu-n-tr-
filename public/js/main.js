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

// Hiệu ứng mở/đóng dialog kiểu iOS với "liên tục không gian": dialog bung ra
// từ ĐÚNG vị trí con trỏ lúc nhấn (transform-origin đặt tại điểm click, có thể
// nằm ngoài khung dialog — cho cảm giác bay ra từ nút bấm) và thu về đúng điểm
// đó khi đóng. Mọi lối đóng (nút X, Hủy, click nền tối) đều chạy animation.
(function () {
  if (!window.HTMLDialogElement) return;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Điểm nhấn gần nhất — cập nhật ở capture phase nên luôn có TRƯỚC khi
  // handler mở dialog chạy. Bắt cả pointerdown lẫn click (một số môi trường/
  // thao tác bàn phím không có pointerdown; click bàn phím có toạ độ 0,0 thì bỏ qua)
  let lastPointer = null;
  const trackPointer = (e) => {
    if (e.clientX === 0 && e.clientY === 0) return;
    lastPointer = { x: e.clientX, y: e.clientY };
  };
  document.addEventListener('pointerdown', trackPointer, true);
  document.addEventListener('click', trackPointer, true);

  // Tính tâm phóng từ điểm mở đã lưu. Dùng offsetWidth/offsetHeight (không bị
  // transform của animation đang chạy làm sai lệch như getBoundingClientRect)
  // + dialog luôn được UA căn giữa viewport → suy ra toạ độ khung thật.
  window.__setDialogOrigin = function (dlg) {
    const p = dlg._openPoint;
    if (!p) { dlg.style.transformOrigin = ''; return; }
    const left = (window.innerWidth - dlg.offsetWidth) / 2;
    const top = (window.innerHeight - dlg.offsetHeight) / 2;
    dlg.style.transformOrigin = (p.x - left) + 'px ' + (p.y - top) + 'px';
  };

  const origShowModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...args) {
    origShowModal.apply(this, args);
    if (reduced()) return;
    // Lưu điểm mở (dùng lại khi dialog đổi kích thước và khi đóng)
    this._openPoint = lastPointer;
    window.__setDialogOrigin(this);
  };

  const origClose = HTMLDialogElement.prototype.close;
  HTMLDialogElement.prototype.close = function (...args) {
    // Popup form iframe tự lo animation riêng (WAAPI) — bỏ qua ở đây
    if (this.dataset.customAnim === '1' ||
        !this.open || this.classList.contains('dlg-closing') || reduced()) {
      return origClose.apply(this, args);
    }
    this.classList.add('dlg-closing');
    setTimeout(() => {
      this.classList.remove('dlg-closing');
      origClose.apply(this, args);
    }, 200);
  };
})();

// Popup "Thêm mới" (dự án, yêu cầu, nhân viên, báo giá...): link có data-modal
// mở trang form (?modal=1, layout tối giản) trong iframe giữa màn hình.
// Mở TỨC THÌ khi click (bung từ con trỏ, không chờ tải) — chiều cao lấy từ
// cache (lần mở sau khớp ngay) hoặc ước lượng 68vh cho lần đầu, rồi khi form
// tải xong tự đệm về đúng chiều cao bằng transition mượt. Không còn tải form
// 2 lần (bỏ iframe đo ẩn) nên hết cảm giác khựng 2 giây.
(function () {
  var dlg, frame;
  var heightCache = {}; // url -> chiều cao form (px), nhớ giữa các lần mở

  function ensureDlg() {
    if (dlg) return;
    dlg = document.createElement('dialog');
    dlg.id = 'globalFormModal';
    dlg.className = 'form-modal';
    dlg.innerHTML = '<button type="button" class="form-modal-close" aria-label="Đóng">&times;</button>' +
                    '<div class="form-modal-scroll"><iframe class="form-modal-frame" title="Form"></iframe></div>';
    document.body.appendChild(dlg);
    frame = dlg.querySelector('.form-modal-frame');
    dlg.querySelector('.form-modal-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) dlg.close(); });
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-modal]');
    if (!link) return;
    e.preventDefault();
    var url = link.href + (link.href.includes('?') ? '&' : '?') + 'modal=1';
    ensureDlg();

    // Chiều cao khởi tạo: cache (chính xác) hoặc ước lượng cho lần đầu
    var startH = heightCache[url] || Math.round(window.innerHeight * 0.68);
    frame.style.transition = 'none';          // đặt cỡ ban đầu không animate
    frame.style.height = startH + 'px';
    dlg.showModal();                          // MỞ NGAY: dlgIn bung từ con trỏ (patch showModal)

    var fitted = false;
    frame.onload = function () {
      var href = '';
      try { href = frame.contentWindow.location.href; } catch (e2) {}
      if (!href || href === 'about:blank') return;
      var fit = function () {
        if (fitted && !frame.contentDocument) return;
        var h;
        try { h = frame.contentDocument.documentElement.scrollHeight; } catch (e3) { return; }
        if (!h) return;
        heightCache[url] = h;
        // Đệm về đúng chiều cao bằng transition mượt (chỉ khi lệch đáng kể)
        if (Math.abs(h - parseInt(frame.style.height, 10)) > 4) {
          frame.style.transition = 'height .28s cubic-bezier(.32,.72,0,1)';
          frame.style.height = h + 'px';
          if (window.__setDialogOrigin) window.__setDialogOrigin(dlg);
        }
        fitted = true;
      };
      fit();
      setTimeout(fit, 180); // đo lại sau khi webfont trong iframe settle
    };
    frame.src = url;
  });
})();

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
