const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/compartilhar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'compartilhar.html'));
});

app.get('/ao-vivo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ao-vivo.html'));
});

app.get('/', (req, res) => {
  res.redirect('/ao-vivo');
});

// Guarda o id de quem esta transmitindo no momento (1 transmissor por vez)
let broadcasterSocketId = null;

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  // Quem clicou em "Iniciar compartilhamento"
  socket.on('broadcaster', () => {
    broadcasterSocketId = socket.id;
    socket.broadcast.emit('broadcaster-online');
    console.log(`Transmissor definido: ${socket.id}`);
  });

  // Um espectador avisa que quer assistir
  socket.on('watcher', () => {
    if (broadcasterSocketId) {
      // Avisa o transmissor que ha um novo espectador (envia o id dele)
      socket.to(broadcasterSocketId).emit('watcher', socket.id);
    }
  });

  // Repasse de mensagens WebRTC (offer/answer/candidate) entre os dois lados
  socket.on('offer', (targetId, description) => {
    socket.to(targetId).emit('offer', socket.id, description);
  });

  socket.on('answer', (targetId, description) => {
    socket.to(targetId).emit('answer', socket.id, description);
  });

  socket.on('candidate', (targetId, candidate) => {
    socket.to(targetId).emit('candidate', socket.id, candidate);
  });

  socket.on('disconnect', () => {
    if (socket.id === broadcasterSocketId) {
      broadcasterSocketId = null;
      socket.broadcast.emit('broadcaster-offline');
      console.log('Transmissor saiu.');
    } else {
      socket.broadcast.emit('disconnectPeer', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nServidor rodando em http://localhost:${PORT}`);
  console.log(`  -> Compartilhar tela: http://localhost:${PORT}/compartilhar`);
  console.log(`  -> Assistir ao vivo:  http://localhost:${PORT}/ao-vivo\n`);
});
