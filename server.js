const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DATA_FILE = path.join(__dirname, 'chat-history.json');

function loadHistory() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
  }
  return [];
}

function saveHistory(messages) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(messages, null, 2));
}

let messages = loadHistory();
const onlineUsers = new Map();

app.use(express.static('public'));

io.on('connection', (socket) => {
  socket.on('join', (username) => {
    if (!username || username.trim() === '') return;
    const name = username.trim();
    if (Array.from(onlineUsers.values()).some(n => n === name)) {
      socket.emit('nameError', '别盗你爹号，换一个名字');
      return;
    }
    socket.username = name;
    onlineUsers.set(socket.id, name);
    socket.emit('joinSuccess');
    socket.emit('history', messages);
    io.emit('onlineUsers', Array.from(onlineUsers.values()));
    io.emit('system', { type: 'join', username: name });
  });

  socket.on('chat message', (msg) => {
    if (!socket.username || typeof msg !== 'string' || !msg.trim()) return;
    const data = { type: 'text', username: socket.username, content: msg.trim(), timestamp: new Date().toISOString() };
    messages.push(data);
    saveHistory(messages);
    io.emit('chat message', data);
  });

  socket.on('chat image', (data) => {
    if (!socket.username || !data.base64) return;
    const imageData = { type: 'image', username: socket.username, content: data.base64, timestamp: new Date().toISOString() };
    messages.push(imageData);
    saveHistory(messages);
    io.emit('chat message', imageData);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      io.emit('system', { type: 'leave', username: socket.username });
      onlineUsers.delete(socket.id);
      io.emit('onlineUsers', Array.from(onlineUsers.values()));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌌 深海聊天室已启动 → 端口 ${PORT}`);
});
