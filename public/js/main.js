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
// Để phóng MỘT lần từ vị trí con trỏ ra đúng khung cuối (không "hộp nhỏ rồi
// giãn to"): ĐO chiều cao form trong 1 iframe ẩn ngoài màn hình TRƯỚC, đặt
// đúng chiều cao cho dialog, rồi mới showModal — dùng lại animation dlgIn
// generic (patch showModal đặt transform-origin tại con trỏ) đã chạy tốt ở
// các modal khác.
(function () {
  var dlg, frame, measurer;

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

  // Đo chiều cao form trong iframe ẩn ngoài màn hình (cùng bề rộng với dialog)
  function measureHeight(url, cb) {
    if (!measurer) {
      measurer = document.createElement('iframe');
      measurer.setAttribute('aria-hidden', 'true');
      measurer.style.cssText = 'position:fixed;left:-9999px;top:0;width:892px;height:10px;border:0;visibility:hidden';
      document.body.appendChild(measurer);
    }
    var done = false;
    measurer.onload = function () {
      var href = '';
      try { href = measurer.contentWindow.location.href; } catch (e) {}
      if (!href || href === 'about:blank' || done) return;
      done = true;
      var read = function () { try { return measurer.contentDocument.documentElement.scrollHeight; } catch (e) { return 500; } };
      // đo lại sau khi webfont trong iframe settle để không thiếu chiều cao
      setTimeout(function () { cb(Math.max(read(), 200)); }, 140);
    };
    measurer.src = url;
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-modal]');
    if (!link) return;
    e.preventDefault();
    var url = link.href + (link.href.includes('?') ? '&' : '?') + 'modal=1';
    ensureDlg();
    measureHeight(url, function (h) {
      frame.style.height = h + 'px';        // dialog cao đúng nội dung (bị .form-modal cap 86vh + cuộn nếu quá cao)
      var shown = false;
      frame.onload = function () {
        var href = '';
        try { href = frame.contentWindow.location.href; } catch (e2) {}
        if (!href || href === 'about:blank' || shown) return;
        shown = true;
        if (!dlg.open) dlg.showModal();     // nội dung đã sẵn + đúng cỡ → dlgIn phóng từ con trỏ một lần
      };
      frame.src = url;
    });
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
