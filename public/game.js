const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

let state = 'waiting';
let agentNames = [];
let agentSprites = ['idle', 'idle'];
let scores = [0, 0];
let round = 0;
let totalRounds = 10;
let chatBubbles = [null, null];
let resultCards = [null, null];
let particles = [];
let shakeTimer = 0;
let flashAlpha = 0;
let statusText = 'Waiting for agents to join...';
let statusSub = 'POST /join to enter the arena';

const AGENT_X = [120, 520];
const AGENT_Y = 240;
const PIXEL_SCALE = 4;

function handleEvent(evt, isReplay) {
  switch (evt.type) {
    case 'join':
      if (evt.count === 1) {
        agentNames = [evt.name];
        statusText = `${evt.name} has entered!`;
        statusSub = 'Waiting for opponent...';
        state = 'waiting';
      }
      if (evt.count === 2) {
        agentNames[1] = evt.name;
        statusText = 'Both agents ready!';
        statusSub = 'Battle starting soon...';
        state = 'ready';
      }
      break;

    case 'game_start':
      agentNames = evt.agents;
      totalRounds = evt.totalRounds;
      scores = [0, 0];
      state = 'playing';
      statusText = '';
      statusSub = '';
      break;

    case 'round_start':
      round = evt.round;
      chatBubbles = [null, null];
      resultCards = [null, null];
      agentSprites = ['idle', 'idle'];
      break;

    case 'chat':
      agentSprites = ['talk', 'talk'];
      if (!isReplay) {
        chatBubbles = [
          { text: evt.messages[0].message, timer: 120 },
          { text: evt.messages[1].message, timer: 120 }
        ];
      }
      break;

    case 'action_phase':
      chatBubbles = [null, null];
      agentSprites = ['idle', 'idle'];
      break;

    case 'round_result': {
      const a0 = evt.actions[0], a1 = evt.actions[1];
      resultCards = [
        { action: a0.action, score: a0.roundScore },
        { action: a1.action, score: a1.roundScore }
      ];
      scores = [a0.totalScore, a1.totalScore];
      agentSprites[0] = a0.roundScore >= 3 ? 'happy' : (a0.roundScore === 0 ? 'sad' : 'idle');
      agentSprites[1] = a1.roundScore >= 3 ? 'happy' : (a1.roundScore === 0 ? 'sad' : 'idle');
      if (!isReplay) {
        if (a0.action === 'betray' || a1.action === 'betray') shakeTimer = 15;
        if (a0.action === 'cooperate' && a1.action === 'cooperate') spawnParticles(W / 2, AGENT_Y, '#4ade80', 20);
        if (a0.action === 'betray' && a1.action === 'betray') spawnParticles(W / 2, AGENT_Y, '#f87171', 20);
      }
      break;
    }

    case 'game_over':
      state = 'done';
      scores = [evt.results[0].score, evt.results[1].score];
      const winner = scores[0] > scores[1] ? agentNames[0] : scores[1] > scores[0] ? agentNames[1] : 'TIE';
      statusText = winner === 'TIE' ? "It's a tie!" : `${winner} wins!`;
      statusSub = `${agentNames[0]}: ${scores[0]}  vs  ${agentNames[1]}: ${scores[1]}`;
      if (!isReplay) {
        flashAlpha = 1.0;
        spawnParticles(W / 2, H / 2, '#fbbf24', 50);
      }
      break;
  }
}

const ws = new WebSocket(`ws://${location.host}`);
ws.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type === 'snapshot') {
    for (const past of evt.eventLog) handleEvent(past, true);
    return;
  }
  handleEvent(evt, false);
};

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6 - 2,
      life: 40 + Math.random() * 30,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function drawBg() {
  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1a1a30';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, W - 40, H - 40);
  [[24,24],[W-32,24],[24,H-32],[W-32,H-32]].forEach(([cx,cy]) => { ctx.fillStyle='#e94560'; ctx.fillRect(cx,cy,8,8); });
}

function drawHeader() {
  ctx.fillStyle = '#e94560';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('AGENT ARENA', W / 2, 50);
  if (state === 'playing' || state === 'done') {
    ctx.fillStyle = '#8892b0'; ctx.font = '12px monospace';
    ctx.fillText(`ROUND ${round} / ${totalRounds}`, W / 2, 70);
    ctx.fillStyle = SPRITE_PALETTE.agent0[3]; ctx.textAlign = 'right'; ctx.font = 'bold 14px monospace';
    ctx.fillText(`${agentNames[0]||'???'}: ${scores[0]}`, W/2-20, 90);
    ctx.fillStyle = SPRITE_PALETTE.agent1[3]; ctx.textAlign = 'left';
    ctx.fillText(`${agentNames[1]||'???'}: ${scores[1]}`, W/2+20, 90);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 12px monospace';
    ctx.fillText('VS', W/2, 90);
  }
}

function drawAgents() {
  for (let i = 0; i < 2; i++) {
    if (!agentNames[i]) continue;
    const pk = i===0?'agent0':'agent1';
    const sprite = SPRITES[agentSprites[i]]||SPRITES.idle;
    const x = AGENT_X[i]-(16*PIXEL_SCALE)/2, y = AGENT_Y;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(AGENT_X[i], y+16*PIXEL_SCALE+8, 24, 6, 0, 0, Math.PI*2); ctx.fill();
    drawSprite(ctx, sprite, SPRITE_PALETTE[pk], x, y, PIXEL_SCALE);
    ctx.fillStyle = SPRITE_PALETTE[pk][3]; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(agentNames[i].slice(0,12), AGENT_X[i], y+16*PIXEL_SCALE+24);
  }
}

function drawBubbles() {
  for (let i = 0; i < 2; i++) {
    const b = chatBubbles[i];
    if (!b || b.timer <= 0) continue;
    b.timer--;
    const bx = AGENT_X[i], by = AGENT_Y - 20, maxW = 180;
    ctx.font = '10px monospace';
    const text = b.text.length > 60 ? b.text.slice(0,57)+'...' : b.text;
    const lines = wrapText(ctx, text, maxW-16);
    const bw = maxW, bh = lines.length*14+12, bx0 = bx-bw/2, by0 = by-bh;
    ctx.fillStyle = 'rgba(30,30,50,0.95)'; roundRect(ctx,bx0,by0,bw,bh,6); ctx.fill();
    ctx.strokeStyle = '#4a4a6a'; ctx.lineWidth = 1; roundRect(ctx,bx0,by0,bw,bh,6); ctx.stroke();
    ctx.fillStyle = 'rgba(30,30,50,0.95)';
    ctx.beginPath(); ctx.moveTo(bx-5,by0+bh); ctx.lineTo(bx,by0+bh+8); ctx.lineTo(bx+5,by0+bh); ctx.fill();
    ctx.fillStyle = '#ccd6f6'; ctx.textAlign = 'left';
    lines.forEach((l,li) => ctx.fillText(l, bx0+8, by0+14+li*14));
  }
}

function drawResultCards() {
  for (let i = 0; i < 2; i++) {
    const r = resultCards[i]; if (!r) continue;
    const cx = W/2+(i===0?-80:80), cy = AGENT_Y+30;
    const isCoop = r.action==='cooperate', color = isCoop?'#4ade80':'#f87171', icon = isCoop?'COOP':'BTRY';
    ctx.fillStyle = 'rgba(15,15,26,0.9)'; roundRect(ctx,cx-35,cy-15,70,40,4); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; roundRect(ctx,cx-35,cy-15,70,40,4); ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText(icon,cx,cy+2);
    ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 10px monospace'; ctx.fillText(`+${r.score}`,cx,cy+18);
  }
}

function drawParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--;
    const a = Math.min(1, p.life/20);
    ctx.fillStyle = p.color + Math.floor(a*255).toString(16).padStart(2,'0');
    ctx.fillRect(p.x-p.size/2, p.y-p.size/2, p.size, p.size);
  });
}

function drawStatus() {
  if (!statusText) return;
  ctx.fillStyle = '#ccd6f6'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
  ctx.fillText(statusText, W/2, H/2-10);
  if (statusSub) { ctx.fillStyle = '#8892b0'; ctx.font = '12px monospace'; ctx.fillText(statusSub, W/2, H/2+15); }
}

function drawFlash() {
  if (flashAlpha > 0) { ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`; ctx.fillRect(0,0,W,H); flashAlpha -= 0.03; }
}

function drawScoreBoard() {
  if (state !== 'playing') return;
  const tot = Math.max(scores[0]+scores[1],1), barY=H-40, barW=W-80, barH=8, barX=40;
  ctx.fillStyle='#1a1a30'; roundRect(ctx,barX,barY,barW,barH,4); ctx.fill();
  const r = scores[0]/tot;
  if (scores[0]>0) { ctx.fillStyle=SPRITE_PALETTE.agent0[3]; roundRect(ctx,barX,barY,barW*r,barH,4); ctx.fill(); }
  if (scores[1]>0) { ctx.fillStyle=SPRITE_PALETTE.agent1[3]; roundRect(ctx,barX+barW*r,barY,barW*(1-r),barH,4); ctx.fill(); }
}

function wrapText(ctx, text, maxW) {
  const words=text.split(' '), lines=[]; let line='';
  for (const w of words) { const t=line?line+' '+w:w; if(ctx.measureText(t).width>maxW&&line){lines.push(line);line=w;}else{line=t;} }
  if(line)lines.push(line); return lines;
}

function roundRect(ctx,x,y,w,h,r) {
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function frame() {
  ctx.save();
  if (shakeTimer > 0) { shakeTimer--; ctx.translate(Math.random()*6-3, Math.random()*6-3); }
  drawBg(); drawHeader();
  if (state==='waiting'||state==='ready') { drawStatus(); drawAgents(); }
  else if (state==='playing') { drawAgents(); drawBubbles(); drawResultCards(); drawScoreBoard(); }
  else if (state==='done') { drawAgents(); drawStatus(); }
  drawParticles(); drawFlash(); ctx.restore();
  requestAnimationFrame(frame);
}
frame();
