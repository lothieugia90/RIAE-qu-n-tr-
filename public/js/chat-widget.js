// Popup chat góc phải dưới — chạy trên mọi trang (trừ /chat).
// Danh sách phòng + danh sách nhân viên (kèm online) + hội thoại mini,
// gửi/nhận realtime qua Socket.IO, gửi được file đính kèm.
(function () {
  const root = document.getElementById('chatWidget');
  if (!root || typeof io === 'undefined') return;

  const MY_ID = root.dataset.myId;
  const toggle = document.getElementById('cwToggle');
  const panel = document.getElementById('cwPanel');
  const badge = document.getElementById('cwBadge');
  const tabsEl = document.getElementById('cwTabs');
  const roomsEl = document.getElementById('cwRooms');
  const usersEl = document.getElementById('cwUsers');
  const chatEl = document.getElementById('cwChat');
  const msgsEl = document.getElementById('cwMsgs');
  const form = document.getElementById('cwForm');
  const input = document.getElementById('cwText');
  const fileInput = document.getElementById('cwFile');
  const attachBtn = document.getElementById('cwAttachBtn');
  const filePending = document.getElementById('cwFilePending');
  const fileCancelBtn = document.getElementById('cwFileCancelBtn');
  const backBtn = document.getElementById('cwBack');
  const minBtn = document.getElementById('cwMin');
  const titleEl = document.getElementById('cwTitle');

  let rooms = [];
  let users = [];
  let onlineIds = new Set();
  let activeRoom = null;
  let activeTab = 'rooms';
  const socket = io();

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function isImgFile(url) { return /\.(jpe?g|png|gif|webp)$/i.test(url || ''); }

  function totalUnread() { return rooms.reduce((s, r) => s + (r.unread || 0), 0); }
  function renderBadge() {
    const n = totalUnread();
    badge.hidden = n <= 0;
    badge.textContent = n > 99 ? '99+' : n;
  }

  // ===== Danh sách phòng =====
  function renderRooms() {
    if (!rooms.length) {
      roomsEl.innerHTML = '<p class="cw-loading">Chưa có phòng chat nào.<br>Chọn tab "Nhân viên" để bắt đầu.</p>';
      return;
    }
    roomsEl.innerHTML = rooms.map(r =>
      '<button type="button" class="cw-room" data-id="' + r.id + '">' +
      '<span class="cw-room-icon"><i class="fas ' + (r.type === 'direct' ? 'fa-user' : 'fa-users') + '"></i></span>' +
      '<span class="cw-room-info"><strong>' + esc(r.name) + '</strong><small>' + esc((r.last_message || 'Chưa có tin nhắn').slice(0, 36)) + '</small></span>' +
      (r.unread > 0 ? '<span class="cw-unread">' + r.unread + '</span>' : '') +
      '</button>'
    ).join('');
    roomsEl.querySelectorAll('.cw-room').forEach(btn =>
      btn.addEventListener('click', () => openRoom(btn.dataset.id)));
  }

  async function loadRooms() {
    try {
      const r = await fetch('/chat/api/rooms', { headers: { Accept: 'application/json' } });
      const j = await r.json();
      rooms = j.rooms || [];
      renderRooms();
      renderBadge();
    } catch (e) { roomsEl.innerHTML = '<p class="cw-loading">Lỗi tải danh sách phòng</p>'; }
  }

  // ===== Danh sách nhân viên + online =====
  function renderUsers() {
    if (!users.length) {
      usersEl.innerHTML = '<p class="cw-loading">Không có nhân viên nào khác</p>';
      return;
    }
    const onlineCount = users.filter(u => onlineIds.has(u.id)).length;
    usersEl.innerHTML =
      '<div class="cw-users-head"><small><span class="cw-online-dot"></span> ' + onlineCount + ' đang online</small></div>' +
      users.map(u =>
        '<button type="button" class="cw-user" data-uid="' + u.id + '">' +
        '<span class="cw-user-avatar">' +
        (u.avatar_url ? '<img src="' + esc(u.avatar_url) + '">' : esc((u.full_name || '?').charAt(0).toUpperCase())) +
        '<span class="cw-dot' + (onlineIds.has(u.id) ? ' on' : '') + '" data-uid="' + u.id + '"></span>' +
        '</span>' +
        '<span class="cw-user-info"><strong>' + esc(u.full_name) + '</strong><small>' + esc(u.position || u.department || '—') + '</small></span>' +
        '<i class="fas fa-paper-plane cw-user-send"></i>' +
        '</button>'
      ).join('');
    usersEl.querySelectorAll('.cw-user').forEach(btn =>
      btn.addEventListener('click', () => startDirect(btn.dataset.uid)));
  }

  async function loadUsers() {
    try {
      const r = await fetch('/chat/api/users', { headers: { Accept: 'application/json' } });
      const j = await r.json();
      users = j.users || [];
      onlineIds = new Set(j.onlineIds || []);
      renderUsers();
    } catch (e) { usersEl.innerHTML = '<p class="cw-loading">Lỗi tải danh sách nhân viên</p>'; }
  }

  async function startDirect(userId) {
    try {
      const csrf = document.querySelector('meta[name="csrf-token"]').content;
      const r = await fetch('/chat/api/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Accept: 'application/json' },
        body: JSON.stringify({ user_id: userId })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Lỗi tạo chat riêng');
      await loadRooms();
      openRoom(j.roomId);
    } catch (e) { alert(e.message); }
  }

  function switchTab(tab) {
    activeTab = tab;
    tabsEl.querySelectorAll('.cw-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    roomsEl.hidden = tab !== 'rooms';
    usersEl.hidden = tab !== 'users';
    if (tab === 'rooms') loadRooms(); else loadUsers();
  }
  tabsEl.querySelectorAll('.cw-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // ===== Hội thoại =====
  function appendMsg(m) {
    const mine = m.user_id === MY_ID;
    const el = document.createElement('div');
    el.className = 'cw-msg' + (mine ? ' mine' : '');
    let inner = '<div class="cw-bubble">' + (mine ? '' : '<small class="cw-author">' + esc(m.full_name || '') + '</small>');
    if (m.file_url) {
      if (isImgFile(m.file_url)) {
        inner += '<a href="' + esc(m.file_url) + '" target="_blank"><img src="' + esc(m.file_url) + '" class="cw-file-img" alt="' + esc(m.file_name) + '"></a>';
      } else {
        inner += '<a href="' + esc(m.file_url) + '" target="_blank" class="cw-file-row"><i class="fas fa-file-arrow-down"></i>' +
          '<span class="cw-file-name">' + esc(m.file_name) + '</span>' +
          '<small>' + ((m.file_size || 0) / 1024).toFixed(0) + ' KB</small></a>';
      }
    }
    if (m.content) inner += '<p>' + esc(m.content) + '</p>';
    inner += '<small class="cw-time">' + new Date(m.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + '</small></div>';
    el.innerHTML = inner;
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function openRoom(roomId) {
    let room = rooms.find(r => r.id === roomId);
    if (!room) { await loadRooms(); room = rooms.find(r => r.id === roomId); }
    if (!room) return;
    activeRoom = room;
    room.unread = 0;
    renderBadge();
    tabsEl.hidden = true;
    roomsEl.hidden = true;
    usersEl.hidden = true;
    chatEl.hidden = false;
    backBtn.hidden = false;
    titleEl.innerHTML = '<i class="fas ' + (room.type === 'direct' ? 'fa-user' : 'fa-users') + '"></i> ' + esc(room.name);
    msgsEl.innerHTML = '<p class="cw-loading">Đang tải...</p>';
    try {
      const r = await fetch('/chat/api/rooms/' + roomId + '/messages', { headers: { Accept: 'application/json' } });
      const j = await r.json();
      msgsEl.innerHTML = '';
      (j.messages || []).forEach(appendMsg);
      socket.emit('room:read', { roomId });
      input.focus();
    } catch (e) { msgsEl.innerHTML = '<p class="cw-loading">Lỗi tải tin nhắn</p>'; }
  }

  function backToList() {
    activeRoom = null;
    chatEl.hidden = true;
    tabsEl.hidden = false;
    backBtn.hidden = true;
    titleEl.innerHTML = '<i class="fas fa-comments"></i> Chat';
    switchTab(activeTab);
  }

  toggle.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.classList.toggle('open', opening);
    if (opening && !activeRoom) switchTab(activeTab);
  });
  minBtn.addEventListener('click', () => { panel.hidden = true; toggle.classList.remove('open'); });
  backBtn.addEventListener('click', backToList);

  // ===== Đính kèm file =====
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      filePending.querySelector('span').textContent = fileInput.files[0].name;
      filePending.hidden = false;
    }
  });
  fileCancelBtn.addEventListener('click', () => { fileInput.value = ''; filePending.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    const file = fileInput.files[0];
    if (!activeRoom || (!content && !file)) return;
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('caption', content);
      const csrf = document.querySelector('meta[name="csrf-token"]').content;
      try {
        const r = await fetch('/chat/rooms/' + activeRoom.id + '/upload', {
          method: 'POST', headers: { 'x-csrf-token': csrf }, body: fd
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Lỗi gửi file');
      } catch (err) { alert(err.message); }
      fileInput.value = '';
      filePending.hidden = true;
    } else {
      socket.emit('message:send', { roomId: activeRoom.id, content });
    }
    input.value = '';
    input.focus();
  });

  // ===== Realtime =====
  socket.on('presence:update', ({ userId, online }) => {
    if (online) onlineIds.add(userId); else onlineIds.delete(userId);
    const dot = usersEl.querySelector('.cw-dot[data-uid="' + userId + '"]');
    if (dot) dot.classList.toggle('on', online);
    const headSmall = usersEl.querySelector('.cw-users-head small');
    if (headSmall) headSmall.innerHTML = '<span class="cw-online-dot"></span> ' + users.filter(u => onlineIds.has(u.id)).length + ' đang online';
  });

  socket.on('message:new', (m) => {
    if (activeRoom && m.room_id === activeRoom.id && !panel.hidden) {
      appendMsg(m);
      if (m.user_id !== MY_ID) socket.emit('room:read', { roomId: activeRoom.id });
      return;
    }
    if (m.user_id === MY_ID) return;
    const room = rooms.find(r => r.id === m.room_id);
    if (room) {
      room.unread = (room.unread || 0) + 1;
      room.last_message = m.content || (m.file_name ? '📎 ' + m.file_name : '');
      if (!panel.hidden && !activeRoom && activeTab === 'rooms') renderRooms();
    }
    renderBadge();
  });
})();
