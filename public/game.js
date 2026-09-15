const socket = io();
const params = new URLSearchParams(location.search);
const room = params.get('room');
const playerToken = localStorage.getItem('theMindPlayerToken');
const $ = id => document.getElementById(id);
let state = null;

$('roomLabel').textContent = room ? `PHÒNG ${room}` : '';

function escapeHtml(v){ return String(v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c])); }
function render(){
  if(!state) return;
  $('level').textContent = `${Math.min(state.level || 1, state.maxLevel)}/${state.maxLevel}`;
  const maxLives = 5;
  $('lives').textContent = '♥'.repeat(Math.max(0,state.lives)) + '♡'.repeat(Math.max(0,maxLives-state.lives));
  $('shurikens').textContent = '★'.repeat(state.shurikens) + '☆'.repeat(Math.max(0,3-state.shurikens));
  $('players').innerHTML = state.players.map(p => `
    <div class="player-card ${p.id===state.meId?'me':''}">
      <div class="player-name">${escapeHtml(p.name)} ${p.isBot?'🤖':''}</div>
      <div class="card-count">${p.count} lá</div>
      <div class="mini-bar"><span style="width:${Math.min(100,p.count*100/Math.max(1,state.level))}%"></span></div>
    </div>`).join('');
  const hand = (state.hand || []).slice().sort((a,b)=>a-b);
  $('hand').innerHTML = hand.length ? hand.map(card => `<button class="playing-card" data-card="${card}"><span>${card}</span></button>`).join('') : '<div class="empty-hand">Hết bài trong cấp độ này…</div>';
  document.querySelectorAll('.playing-card').forEach(btn => btn.onclick=()=>socket.emit('game:play',{card:Number(btn.dataset.card)}));
  $('shurikenBtn').disabled = state.phase !== 'playing' || state.shurikens <= 0;
  $('playPile').textContent = state.played?.length ? state.played[state.played.length-1].value : '—';
  if(state.lastPlay){
    $('lastPlay').className=state.lastPlay.mistake?'last-play mistake':'last-play';
    $('lastPlay').textContent=state.lastPlay.mistake?`⚠️ ${state.lastPlay.player} đánh ${state.lastPlay.value} — lá thấp nhất lúc đó là ${state.lastPlay.expected}. Mất 1 mạng.`:`${state.lastPlay.player} vừa đánh ${state.lastPlay.value}`;
  }
  $('statusTitle').textContent = state.phase === 'won' ? 'CHIẾN THẮNG 🎉' : state.phase === 'lost' ? 'THẤT BẠI' : `CẤP ĐỘ ${state.level}`;
  $('statusText').textContent = state.phase === 'playing' ? 'Im lặng. Cảm nhận nhịp chơi và tự chọn thời điểm.' : state.phase === 'won' ? 'Cả đội đã hoàn thành The Mind!' : 'Cả đội đã hết mạng.';
  $('statusCard').classList.toggle('danger',state.phase==='lost');
}
function showEnd(phase){
  $('endPanel').hidden=false;
  $('endEmoji').textContent=phase==='won'?'🎉':'💥';
  $('endTitle').textContent=phase==='won'?'Đội đã đồng bộ!':'Hết mạng!';
  $('endText').textContent=phase==='won'?`Hoàn thành ${state.maxLevel} cấp độ.`:`Các bạn dừng ở cấp độ ${state.level}.`;
}
$('shurikenBtn').onclick=()=>{ if(state?.shurikens>0) socket.emit('game:shuriken'); };
$('restartBtn').onclick=()=>socket.emit('game:restart');
$('backBtn').onclick=()=>location.href='/';
socket.on('game:state', s=>{ state=s; $('endPanel').hidden=!['won','lost'].includes(s.phase); render(); if(['won','lost'].includes(s.phase)) showEnd(s.phase); });
socket.on('game:levelComplete', ({level,reward})=>{
  $('statusTitle').textContent='HOÀN THÀNH!';
  $('statusText').textContent=reward==='life'?`Cấp ${level} xong — nhận thêm 1 mạng.`:reward==='shuriken'?`Cấp ${level} xong — nhận thêm 1 phi tiêu.`:`Cấp ${level} xong.`;
});
socket.on('game:shurikenUsed',()=>{ $('statusTitle').textContent='PHI TIÊU ★'; $('statusText').textContent='Mỗi người đã bỏ lá thấp nhất.'; });
socket.on('game:error',msg=>{ $('statusText').textContent=msg; });
socket.on('game:joined',s=>{ state=s; render(); });
if(room && playerToken) socket.emit('game:join',{room,token:playerToken});
else $('statusText').textContent='Không xác định được người chơi hoặc mã phòng.';
