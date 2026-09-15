const socket = io();
const config = window.GAME_CONFIG || {};
const $ = (id) => document.getElementById(id);
const playerToken = localStorage.getItem('theMindPlayerToken') || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
localStorage.setItem('theMindPlayerToken', playerToken);

const state = { room: null };

$('gameName').textContent = config.name || 'The Mind';
$('playerLimit').textContent = `Cần ít nhất ${config.minPlayers} người · tối đa ${config.maxPlayers} người`;
$('rules').innerHTML = (config.rules || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join('');

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function showError(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
function renderRoom(room) {
  state.room = room;
  $('setupView').hidden = true;
  $('roomView').hidden = false;
  $('roomCodeLabel').textContent = room.code;
  const isHost = room.hostId === socket.id;
  $('players').innerHTML = '';
  room.players.forEach((player) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    const name = document.createElement('span');
    name.textContent = `${player.name}${player.id === room.hostId ? ' 👑' : ''}${player.id === socket.id ? ' (Bạn)' : ''}`;
    chip.appendChild(name);
    if (isHost && player.id !== socket.id) {
      const kick = document.createElement('button');
      kick.className = 'kick-btn'; kick.textContent = 'KICK';
      kick.onclick = () => socket.emit('room:kick', { playerId: player.id });
      chip.appendChild(kick);
    }
    $('players').appendChild(chip);
  });
  $('addBotBtn').disabled = !isHost || room.started || room.players.length >= config.maxPlayers;
  $('startBtn').disabled = !isHost || room.started || room.players.length < config.minPlayers;
}
function goToGame(room) { window.location.href = `/game.html?room=${encodeURIComponent(room.code)}`; }

$('createBtn').onclick = () => {
  showError('');
  const name = $('playerName').value.trim();
  if (!name) return showError('Hãy nhập tên người chơi.');
  localStorage.setItem('theMindPlayerName', name);
  socket.emit('room:create', { name, token: playerToken });
};
$('joinBtn').onclick = () => {
  showError('');
  const name = $('playerName').value.trim();
  const code = $('roomCode').value.trim().toUpperCase();
  if (!name) return showError('Hãy nhập tên người chơi.');
  if (!code) return showError('Hãy nhập mã phòng.');
  localStorage.setItem('theMindPlayerName', name);
  socket.emit('room:join', { name, code, token: playerToken });
};
$('addBotBtn').onclick = () => socket.emit('room:addBot');
$('startBtn').onclick = () => socket.emit('room:start');
$('copyBtn').onclick = async () => {
  if (!state.room?.code) return;
  try { await navigator.clipboard.writeText(state.room.code); $('copyBtn').textContent = '✓ Đã sao chép'; setTimeout(() => $('copyBtn').textContent = '📋 Sao chép', 1200); }
  catch { showError(`Mã phòng: ${state.room.code}`); }
};
$('leaveBtn').onclick = () => window.location.reload();
$('playerName').onkeydown = (e) => { if (e.key === 'Enter') $('createBtn').click(); };
$('roomCode').onkeydown = (e) => { if (e.key === 'Enter') $('joinBtn').click(); };

socket.on('room:joined', renderRoom);
socket.on('room:update', renderRoom);
socket.on('room:error', showError);
socket.on('room:kicked', () => { alert('Bạn đã bị chủ phòng kick.'); window.location.reload(); });
socket.on('game:start', goToGame);
