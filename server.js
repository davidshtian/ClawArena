const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

// Serve rules
app.get('/rules', (_req, res) => {
  res.type('text/plain').sendFile(path.join(__dirname, 'RULES.md'));
});

// --- Helpers ---
const crypto = require('crypto');

function validateName(name) {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 20) return false;
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

// --- State ---
let agents = [];       // [{ name, score, token }]
let game = null;       // { round, totalRounds, phase, turn, history, chatLog, submissions }
let eventLog = [];

const ROUNDS = 10;
const CHAT_TURNS = 3;
const PHASE_TIMEOUT = 60000;
let phaseTimer = null;

function broadcast(event) {
  eventLog.push(event);
  const data = JSON.stringify(event);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(data); });
}

wss.on('connection', (ws) => {
  if (wss.clients.size > 50) { ws.close(); return; }
  ws.send(JSON.stringify({
    type: 'snapshot',
    agents: agents.map(a => ({ name: a.name, score: a.score })),
    game: game ? { round: game.round, totalRounds: game.totalRounds, phase: game.phase } : null,
    eventLog
  }));
});

// --- API ---
app.post('/join', (req, res) => {
  if (game && game.phase === 'done') {
    agents = [];
    game = null;
    eventLog = [];
  }

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'need name' });
  if (!validateName(name)) return res.status(400).json({ error: 'name must be 1-20 chars, alphanumeric/dash/underscore only' });
  if (agents.find(a => a.name === name)) return res.status(400).json({ error: 'name taken' });
  if (agents.length >= 2) return res.status(400).json({ error: 'arena full' });

  const token = crypto.randomBytes(16).toString('hex');
  agents.push({ name, score: 0, token });
  broadcast({ type: 'join', name, count: agents.length });
  res.json({ ok: true, position: agents.length, token });

  if (agents.length === 2) startGame();
});

app.get('/status', (_req, res) => {
  res.json({
    agents: agents.map(a => ({ name: a.name, score: a.score })),
    game: game ? { round: game.round, totalRounds: game.totalRounds, phase: game.phase } : null
  });
});

app.get('/play', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'need name param' });

  const agent = agents.find(a => a.name === name);
  if (!agent) return res.status(404).json({ error: 'not in game' });

  if (!game) return res.json({ status: 'waiting', message: 'Waiting for opponent to join...' });

  if (game.phase === 'done') {
    const winner = agents[0].score > agents[1].score ? agents[0].name
      : agents[1].score > agents[0].score ? agents[1].name : 'TIE';
    return res.json({
      status: 'done',
      result: { winner, scores: { [agents[0].name]: agents[0].score, [agents[1].name]: agents[1].score } }
    });
  }

  // Has this agent already submitted for current phase?
  if (game.submissions[name]) {
    return res.json({ status: 'waiting', message: 'Waiting for opponent...' });
  }

  const opponent = agents.find(a => a.name !== name).name;

  if (game.phase === 'chat') {
    return res.json({
      status: 'your_turn',
      phase: 'chat',
      round: game.round,
      turn: game.turn,
      opponent,
      history: game.history,
      chatLog: game.chatLog
    });
  }

  if (game.phase === 'action') {
    return res.json({
      status: 'your_turn',
      phase: 'action',
      round: game.round,
      opponent,
      history: game.history,
      chatLog: game.chatLog
    });
  }

  res.json({ status: 'waiting', message: 'Processing...' });
});

app.post('/play', (req, res) => {
  const { name, token, message, action } = req.body;
  if (!name || !token) return res.status(400).json({ error: 'need name and token' });

  const agent = agents.find(a => a.name === name);
  if (!agent) return res.status(404).json({ error: 'not in game' });
  if (agent.token !== token) return res.status(403).json({ error: 'invalid token' });
  if (!game || game.phase === 'done') return res.status(400).json({ error: 'no active game' });
  if (game.submissions[name]) return res.status(400).json({ error: 'already submitted this phase' });

  if (game.phase === 'chat') {
    game.submissions[name] = { message: (message || '...').slice(0, 100) };
  } else if (game.phase === 'action') {
    game.submissions[name] = { action: ['cooperate', 'betray'].includes(action) ? action : 'cooperate' };
  } else {
    return res.status(400).json({ error: 'not accepting submissions' });
  }

  res.json({ ok: true });
  checkAdvance();
});

// --- Game Engine ---
function score(a, b) {
  if (a === 'cooperate' && b === 'cooperate') return [3, 3];
  if (a === 'betray' && b === 'betray') return [1, 1];
  if (a === 'betray') return [5, 0];
  return [0, 5];
}

function startGame() {
  game = {
    round: 1,
    totalRounds: ROUNDS,
    phase: 'chat',
    turn: 0,
    history: [],
    chatLog: [],
    submissions: {}
  };
  broadcast({ type: 'game_start', agents: agents.map(a => a.name), totalRounds: ROUNDS });
  broadcast({ type: 'round_start', round: 1 });
  resetPhaseTimer();
}

function resetPhaseTimer() {
  if (phaseTimer) clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => forceDefaults(), PHASE_TIMEOUT);
}

function forceDefaults() {
  if (!game || game.phase === 'done') return;
  for (const a of agents) {
    if (!game.submissions[a.name]) {
      if (game.phase === 'chat') game.submissions[a.name] = { message: '...' };
      else if (game.phase === 'action') game.submissions[a.name] = { action: 'cooperate' };
    }
  }
  checkAdvance();
}

function checkAdvance() {
  if (!game || game.phase === 'done') return;
  if (agents.length < 2) return;
  // Both submitted?
  if (!game.submissions[agents[0].name] || !game.submissions[agents[1].name]) return;

  if (phaseTimer) clearTimeout(phaseTimer);

  if (game.phase === 'chat') {
    advanceChat();
  } else if (game.phase === 'action') {
    advanceAction();
  }
}

function advanceChat() {
  const sub0 = game.submissions[agents[0].name];
  const sub1 = game.submissions[agents[1].name];

  game.chatLog.push(
    { from: agents[0].name, message: sub0.message },
    { from: agents[1].name, message: sub1.message }
  );

  broadcast({ type: 'chat', round: game.round, turn: game.turn, messages: [
    { name: agents[0].name, message: sub0.message },
    { name: agents[1].name, message: sub1.message }
  ]});

  game.submissions = {};
  game.turn++;

  if (game.turn >= CHAT_TURNS) {
    // Move to action phase
    game.phase = 'action';
    broadcast({ type: 'action_phase', round: game.round });
  }

  resetPhaseTimer();
}

function advanceAction() {
  const sub0 = game.submissions[agents[0].name];
  const sub1 = game.submissions[agents[1].name];

  const act0 = sub0.action;
  const act1 = sub1.action;
  const [s0, s1] = score(act0, act1);
  agents[0].score += s0;
  agents[1].score += s1;

  game.history.push({
    round: game.round,
    actions: { [agents[0].name]: act0, [agents[1].name]: act1 },
    scores: { [agents[0].name]: s0, [agents[1].name]: s1 }
  });

  broadcast({ type: 'round_result', round: game.round, actions: [
    { name: agents[0].name, action: act0, roundScore: s0, totalScore: agents[0].score },
    { name: agents[1].name, action: act1, roundScore: s1, totalScore: agents[1].score }
  ]});

  // Next round or end
  if (game.round >= ROUNDS) {
    game.phase = 'done';
    broadcast({ type: 'game_over', results: agents.map(a => ({ name: a.name, score: a.score })) });
    if (phaseTimer) clearTimeout(phaseTimer);
  } else {
    game.round++;
    game.phase = 'chat';
    game.turn = 0;
    game.chatLog = [];
    game.submissions = {};
    broadcast({ type: 'round_start', round: game.round });
    resetPhaseTimer();
  }
}

// --- Start ---
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`Arena running on http://${HOST}:${PORT}`));
