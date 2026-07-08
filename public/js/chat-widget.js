// Popup chat góc phải dưới — chạy trên mọi trang (trừ /chat).
// Danh sách phòng + hội thoại mini, gửi/nhận realtime qua Socket.IO.
(function () {
  const root = document.getElementById('chatWidget');
  if (!root || typeof io === 'undefined') return;

  const MY_ID = root.dataset.myId;
  const toggle = document.getElementById('cwToggle');
  const panel = document.getElementById('cwPanel');
  const badge = document.getElementById('cwBadge');
  const roomsEl = document.getElementById('cwRooms');
  const chatEl = document.getElementById('cwChat');
  const msgsEl = document.getElementById('cwMsgs');
  const form = document.getElementById('cwForm');
  const input = document.getElementById('cwText');
  const backBtn = document.getElementById('cwBack');
  const minBtn = document.getElementById('cwMin');
  const titleEl = document.getElementById('cwTitle');

  let rooms = [];
  let activeRoom = null;
  const socket = io();

  function totalUnread() { return rooms.reduce((s, r) => s + (r.unread || 0), 0); }
  function renderBadge() {
    const n = totalUnread();
    badge.hidden = n <= 0;
    badge.textContent = n > 99 ? '99+' : n;
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function renderRooms() {
    if (!rooms.length) {
      roomsEl.innerHTML = '<p class="cw-loading">Chưa có phòng chat nào.<br><a href="/chat">Mở trang chat để bắt đầu →</a></p>';
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

  function appendMsg(m) {
    const mine = m.user_id === MY_ID;
    const el = document.createElement('div');
    el.className = 'cw-msg' + (mine ? ' mine' : '');
    el.innerHTML = '<div class="cw-bubble">' +
      (mine ? '' : '<small class="cw-author">' + esc(m.full_name || '') + '</small>') +
      '<p>' + esc(m.content) + '</p>' +
      '<small class="cw-time">' + new Date(m.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + '</small>' +
      '</div>';
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function openRoom(roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    activeRoom = room;
    room.unread = 0;
    renderBadge();
    roomsEl.hidden = true;
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

  function backToRooms() {
    activeRoom = null;
    chatEl.hidden = true;
    roomsEl.hidden = false;
    backBtn.hidden = true;
    titleEl.innerHTML = '<i class="fas fa-comments"></i> Chat';
    loadRooms();
  }

  toggle.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.classList.toggle('open', opening);
    if (opening) { activeRoom ? null : loadRooms(); }
  });
  minBtn.addEventListener('click', () => { panel.hidden = true; toggle.classList.remove('open'); });
  backBtn.addEventListener('click', backToRooms);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content || !activeRoom) return;
    socket.emit('message:send', { roomId: activeRoom.id, content });
    input.value = '';
    input.focus();
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
      room.last_message = m.content;
      if (!panel.hidden && !activeRoom) renderRooms();
    }
    renderBadge();
  });
})();
