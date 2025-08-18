const express = require('express');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const server = app.listen(4000, () => {
  console.log('Backend listening on http://localhost:4000');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('New WS connection');
  ws.on('message', (msg) => console.log('Received:', msg.toString()));
});
