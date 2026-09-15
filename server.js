const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const GAME = { name: 'The Mind', minPlayers: 2, maxPlayers: 4, maxBots: 4 };

app.use(express.static(path.join(__dirname, 'public')));
app.get('/config.js', (_req, res) => res.type('application/javascript').send(`window.GAME_CONFIG=${JSON.stringify({ name: GAME.name, minPlayers: GAME.minPlayers, maxPlayers: GAME.maxPlayers, maxBots: GAME.maxBots, rules: ['Cả đội cùng đánh các lá số 1–100 theo thứ tự tăng dần.','Không được nói, cho xem bài hoặc ra hiệu về giá trị lá bài.','Mỗi người tự chọn thời điểm đánh bài của mình.','Đánh sai thứ tự: mất 1 mạng; các lá nhỏ hơn lá vừa đánh sẽ bị bỏ.','Phi tiêu: cả đội đồng ý thì mỗi người bỏ lá thấp nhất đang có.','Hoàn thành toàn bộ cấp độ trước khi hết mạng để chiến thắng.'] })};`));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const ALLOWED = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode() { let c; do c = Array.from({ length: 5 }, () => ALLOWED[Math.floor(Math.random() * ALLOWED.length)]).join(''); while (rooms.has(c)); return c; }
function nameOf(name) { return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24) || 'Người chơi'; }
function publicRoom(room) { return { code: room.code, hostId: room.hostId, started: room.started, players: room.players.map(p => ({ id:p.id,name:p.name,isBot:p.isBot,botId:p.botId })) }; }
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function host(socket, room) { return room && room.hostId === socket.id; }
function living(room) { return room.players.some(p => !p.isBot); }

function shuffle(a) { for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function levelLimit(n) { return n === 2 ? 12 : n === 3 ? 10 : 8; }
function initialLives(n) { return n; }
function startingShurikens() { return 1; }
function reward(level, room) {
  if (![2,3,5,6,8,9].includes(level)) return null;
  if (level % 2 === 0) { room.game.shurikens = Math.min(3, room.game.shurikens + 1); return 'shuriken'; }
  room.game.lives = Math.min(5, room.game.lives + 1); return 'life';
}

function dealLevel(room) {
  const game = room.game;
  game.level += 1;
  game.played = [];
  game.phase = 'playing';
  game.lastPlay = null;
  const deck = shuffle(Array.from({length:100}, (_,i)=>i+1)).slice(0);
  room.players.forEach(p => { p.hand = deck.splice(0, game.level).sort((a,b)=>a-b); });
  io.to(room.code).emit('game:state', clientState(room));
}

function nextLevel(room) {
  const max = levelLimit(room.players.length);
  const completed = room.game.level;
  const got = reward(completed, room);
  if (completed >= max) {
    room.game.phase = 'won';
    io.to(room.code).emit('game:state', clientState(room));
    return;
  }
  io.to(room.code).emit('game:levelComplete', { level: completed, reward: got });
  setTimeout(() => { if (rooms.get(room.code) === room && room.game.phase !== 'lost' && room.game.phase !== 'won') dealLevel(room); }, 900);
}

function lowerCards(room, value) {
  room.players.forEach(p => { if (p.hand) p.hand = p.hand.filter(c => c >= value); });
}

function botThink(room, p) {
  if (!p.isBot || room.game.phase !== 'playing') return;
  if (!p.hand.length) return;
  const card = p.hand[0];
  const all = room.players.flatMap(x => x.hand || []).filter(x => x !== card);
  const minOther = all.length ? Math.min(...all) : Infinity;
  const ratio = Math.max(900, Math.min(6500, card * 55));
  const spread = minOther === Infinity ? 0 : Math.max(0, minOther - card);
  const delay = Math.max(400, Math.min(7000, ratio - spread * 18 + Math.random() * 650));
  p.botTimer = setTimeout(() => {
    if (rooms.get(room.code) !== room || room.game.phase !== 'playing') return;
    playCard(room, p.id, card, true);
  }, delay);
}
function scheduleBots(room) { room.players.filter(p => p.isBot).forEach(p => botThink(room,p)); }

function playCard(room, playerId, card, fromBot=false) {
  if (room.game.phase !== 'playing') return;
  const p = room.players.find(x => x.id === playerId);
  if (!p || !Array.isArray(p.hand)) return;
  const idx = p.hand.indexOf(Number(card));
  if (idx < 0) return;
  const value = p.hand[idx];
  const currentHands = room.players.flatMap(x => x.hand || []);
  const expected = Math.min(...currentHands);
  p.hand.splice(idx,1);

  if (value !== expected) {
    room.game.lives -= 1;
    lowerCards(room, value);
    room.game.lastPlay = { player: p.name, value, expected, mistake: true };
    if (room.game.lives <= 0) room.game.phase = 'lost';
  } else {
    room.game.played.push({ value, player: p.name });
    room.game.lastPlay = { player: p.name, value, mistake: false };
  }

  io.to(room.code).emit('game:state', clientState(room));
  if (room.game.phase === 'lost' || room.game.phase === 'won') return;
  const remaining = room.players.reduce((sum,x)=>sum+(x.hand?.length||0),0);
  if (remaining === 0) nextLevel(room); else if (!fromBot) scheduleBots(room);
}

function useShuriken(room) {
  if (room.game.phase !== 'playing' || room.game.shurikens <= 0) return false;
  room.game.shurikens -= 1;
  room.players.forEach(p => { if (p.hand?.length) p.hand.shift(); });
  io.to(room.code).emit('game:shurikenUsed');
  io.to(room.code).emit('game:state', clientState(room));
  if (room.players.reduce((s,p)=>s+(p.hand?.length||0),0)===0) nextLevel(room); else scheduleBots(room);
  return true;
}

function clientState(room) {
  const game = room.game;
  return {
    code: room.code, phase: game.phase, level: game.level, maxLevel: levelLimit(room.players.length), lives: game.lives, shurikens: game.shurikens,
    played: game.played.slice(-12), lastPlay: game.lastPlay,
    players: room.players.map(p => ({ id:p.id,name:p.name,isBot:p.isBot,count:p.hand?.length||0 })),
    hands: Object.fromEntries(room.players.filter(p=>!p.isBot).map(p=>[p.id,p.hand||[]])),
    myHandMap: Object.fromEntries(room.players.map(p=>[p.id,p.hand||[]]))
  };
}

io.on('connection', socket => {
  socket.on('room:create', ({name}) => {
    if (socket.data.roomCode) return socket.emit('room:error','Bạn đã ở trong một phòng.');
    const code=roomCode(); const room={code,hostId:socket.id,started:false,players:[],game:null}; rooms.set(code,room); socket.join(code); socket.data.roomCode=code;
    room.players.push({id:socket.id,name:nameOf(name),isBot:false,hand:[]}); socket.emit('room:joined',publicRoom(room)); emitRoom(room);
  });
  socket.on('room:join', ({name,code}) => {
    if (socket.data.roomCode) return socket.emit('room:error','Bạn đã ở trong một phòng.');
    const room=rooms.get(String(code||'').trim().toUpperCase()); if(!room) return socket.emit('room:error','Không tìm thấy phòng.'); if(room.started) return socket.emit('room:error','Ván chơi đã bắt đầu.'); if(room.players.length>=GAME.maxPlayers) return socket.emit('room:error','Phòng đã đầy.');
    socket.join(room.code); socket.data.roomCode=room.code; room.players.push({id:socket.id,name:nameOf(name),isBot:false,hand:[]}); socket.emit('room:joined',publicRoom(room)); emitRoom(room);
  });
  socket.on('room:addBot',()=>{ const room=rooms.get(socket.data.roomCode); if(!host(socket,room)||room.started)return; if(room.players.length>=GAME.maxPlayers)return socket.emit('room:error','Phòng đã đủ người.'); const n=room.players.filter(p=>p.isBot).length+1; room.players.push({id:`bot-${room.code}-${Date.now()}-${n}`,name:`Bot ${n}`,isBot:true,botId:n,hand:[]}); emitRoom(room); });
  socket.on('room:kick',({playerId})=>{ const room=rooms.get(socket.data.roomCode); if(!host(socket,room)||room.started||playerId===socket.id)return; const i=room.players.findIndex(p=>p.id===playerId); if(i<0)return; const removed=room.players.splice(i,1)[0]; if(!removed.isBot){ io.to(removed.id).emit('room:kicked'); const s=io.sockets.sockets.get(removed.id); if(s){s.leave(room.code);s.data.roomCode=null;} } if(room.hostId===playerId){const h=room.players.find(p=>!p.isBot);room.hostId=h?.id||room.players[0]?.id;} emitRoom(room); });
  socket.on('room:start',()=>{ const room=rooms.get(socket.data.roomCode); if(!host(socket,room)||room.started)return; if(room.players.length<GAME.minPlayers)return socket.emit('room:error',`Cần ít nhất ${GAME.minPlayers} người để bắt đầu.`); room.started=true; const n=room.players.length; room.game={phase:'playing',level:0,lives:initialLives(n),shurikens:startingShurikens(),played:[],lastPlay:null}; emitRoom(room); io.to(room.code).emit('game:start',publicRoom(room)); dealLevel(room); scheduleBots(room); });
  socket.on('game:play',({card})=>{ const room=rooms.get(socket.data.roomCode); if(!room||!room.started)return; playCard(room,socket.id,Number(card)); });
  socket.on('game:shuriken',()=>{ const room=rooms.get(socket.data.roomCode); if(!room||!room.started)return; useShuriken(room); });
  socket.on('game:restart',()=>{ const room=rooms.get(socket.data.roomCode); if(!host(socket,room)||!room.started)return; room.game={phase:'playing',level:0,lives:initialLives(room.players.length),shurikens:1,played:[],lastPlay:null}; room.players.forEach(p=>{p.hand=[];if(p.botTimer)clearTimeout(p.botTimer);}); dealLevel(room); scheduleBots(room); });
  socket.on('disconnect',()=>{ const code=socket.data.roomCode; const room=rooms.get(code); if(!room)return; const i=room.players.findIndex(p=>p.id===socket.id); if(i>=0)room.players.splice(i,1); if(!room.players.length){ rooms.delete(code); return; } if(room.hostId===socket.id){ const h=room.players.find(p=>!p.isBot)||room.players[0]; room.hostId=h.id; } if(room.started&&room.game){ if(room.players.length<2)room.game.phase='lost'; emitRoom(room); io.to(room.code).emit('game:state',clientState(room)); } else emitRoom(room); });
});
server.listen(PORT,()=>console.log(`The Mind Online running on ${PORT}`));
