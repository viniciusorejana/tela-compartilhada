const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { execFile, spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || true }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/compartilhar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'compartilhar.html'));
});

app.get('/ao-vivo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ao-vivo.html'));
});

// TURN e necessario quando os navegadores nao conseguem abrir uma conexao direta.
app.get('/api/rtc-config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map(url => url.trim()).filter(Boolean);

  if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.json({ iceServers });
});

app.get('/', (req, res) => {
  res.redirect('/ao-vivo');
});

let broadcasterSocketId = null;
const audioCaptureProcesses = new Map();

function listarProcessos() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command',
      'Get-Process | Select-Object ProcessName,Id,MainWindowTitle | ConvertTo-Json -Compress'],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
        if (error) return resolve([]);
        try {
          const processes = JSON.parse(stdout || '[]');
          resolve((Array.isArray(processes) ? processes : [processes])
            .filter(process => process && process.Id)
            .map(process => ({
              name: process.ProcessName,
              pid: Number(process.Id),
              title: process.MainWindowTitle || ''
            }))
            .sort((a, b) => a.name.localeCompare(b.name)));
        } catch (_) {
          resolve([]);
        }
      });
  });
}

function pararCapturaAudio(socketId) {
  const captures = audioCaptureProcesses.get(socketId) || [];
  captures.forEach(capture => capture.kill());
  audioCaptureProcesses.delete(socketId);
}

function misturarAudio(socket, captures) {
  const frameBytes = 441 * 2 * 2;
  const buffers = captures.map(() => Buffer.alloc(0));

  captures.forEach((capture, index) => {
    capture.stdout.on('data', chunk => {
      buffers[index] = Buffer.concat([buffers[index], chunk]);
      while (buffers.every(buffer => buffer.length >= frameBytes)) {
        const mixed = Buffer.alloc(frameBytes);
        for (let offset = 0; offset < frameBytes; offset += 2) {
          let sample = 0;
          buffers.forEach(buffer => { sample += buffer.readInt16LE(offset); });
          sample = Math.max(-32768, Math.min(32767, sample));
          mixed.writeInt16LE(sample, offset);
        }
        buffers.forEach((buffer, bufferIndex) => {
          buffers[bufferIndex] = buffer.subarray(frameBytes);
        });
        socket.emit('audio-data', mixed);
      }
    });
  });
}

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  // Quem clicou em "Iniciar compartilhamento"
  socket.on('broadcaster', () => {
    if (broadcasterSocketId && broadcasterSocketId !== socket.id) {
      const previousBroadcaster = io.sockets.sockets.get(broadcasterSocketId);
      if (previousBroadcaster) previousBroadcaster.emit('broadcaster-replaced');
      pararCapturaAudio(broadcasterSocketId);
    }
    broadcasterSocketId = socket.id;
    console.log(`Transmissor definido: ${socket.id}`);
  });

  socket.on('broadcaster-ready', () => {
    if (socket.id === broadcasterSocketId) socket.broadcast.emit('broadcaster-online');
  });

  socket.on('audio-processes', async (callback) => {
    if (typeof callback === 'function') callback(await listarProcessos());
  });

  socket.on('audio-start', (request) => {
    if (socket.id !== broadcasterSocketId) return;
    const processIds = Array.isArray(request?.processIds)
      ? request.processIds.map(Number).filter(Number.isInteger)
      : [];
    const mode = request?.mode === 'exclude' ? 'exclude' : 'include';
    if (!processIds.length || (mode === 'exclude' && processIds.length > 1)) return;
    pararCapturaAudio(socket.id);

    const helperPath = path.join(__dirname, 'native', 'audio-helper', 'x64', 'Release', 'ApplicationLoopback.exe');
    const captures = processIds.map(processId => spawn(helperPath, [String(processId), mode], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }));
    audioCaptureProcesses.set(socket.id, captures);
    misturarAudio(socket, captures);
    captures.forEach(capture => {
      capture.stderr.on('data', (chunk) => console.error(`Audio helper: ${chunk}`));
      capture.on('close', () => {
        if (audioCaptureProcesses.get(socket.id)?.includes(capture)) {
          audioCaptureProcesses.set(socket.id, audioCaptureProcesses.get(socket.id).filter(item => item !== capture));
        }
      });
      capture.on('error', (error) => {
      console.error(`Nao foi possivel iniciar o audio helper: ${error.message}`);
      socket.emit('audio-error', 'Helper de audio nao encontrado. Compile o projeto nativo.');
      });
    });
  });

  socket.on('audio-stop', () => pararCapturaAudio(socket.id));

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
    pararCapturaAudio(socket.id);
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
const HOST = process.env.HOST || '0.0.0.0';
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
server.listen(PORT, HOST, () => {
  console.log(`\nServidor rodando em ${publicUrl}`);
  console.log(`  -> Compartilhar tela: ${publicUrl}/compartilhar`);
  console.log(`  -> Assistir ao vivo:  ${publicUrl}/ao-vivo\n`);
});
