const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*' },
    pingTimeout:  60000,
    pingInterval: 25000
});

// Serve the game from /public
app.use(express.static(path.join(__dirname, 'public')));

// ── Room registry ──────────────────────────────────────────────────────────
// rooms[code] = { code, players:[{id,name,number}], config, p1Ready, p2Ready }
const rooms = new Map();

function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
}

function getRoom(socket) {
    return rooms.get(socket.data.code);
}

// ── Socket handlers ────────────────────────────────────────────────────────
io.on('connection', socket => {

    // ── Create room ──
    socket.on('create-room', ({ name }) => {
        let code;
        do { code = makeCode(); } while (rooms.has(code));

        rooms.set(code, {
            code,
            players: [{ id: socket.id, name, number: 1 }],
            config: null,
            p1Ready: false,
            p2Ready: false
        });
        socket.join(code);
        socket.data.code   = code;
        socket.data.number = 1;
        socket.data.name   = name;
        socket.emit('room-created', { code });
    });

    // ── Join room ──
    socket.on('join-room', ({ code, name }) => {
        const key  = (code || '').toUpperCase().trim();
        const room = rooms.get(key);
        if (!room)                  { socket.emit('join-error', 'Sala no encontrada'); return; }
        if (room.players.length >= 2) { socket.emit('join-error', 'La sala ya está llena'); return; }

        room.players.push({ id: socket.id, name, number: 2 });
        socket.join(key);
        socket.data.code   = key;
        socket.data.number = 2;
        socket.data.name   = name;

        // Tell P2 who they are and who P1 is
        socket.emit('room-joined', { playerNumber: 2, opponentName: room.players[0].name });
        // Tell P1 that P2 joined
        socket.to(key).emit('opponent-joined', { name });
    });

    // ── P1 sets target score and is ready ──
    socket.on('p1-ready', ({ targetScore, gameMode }) => {
        const room = getRoom(socket);
        if (!room || socket.data.number !== 1) return;
        room.config           = room.config || {};
        room.config.targetScore = targetScore;
        room.config.gameMode    = gameMode || 'libre';
        room.p1Ready            = true;
        maybeStartGame(room);
    });

    // ── P2 sets their ball color and is ready ──
    socket.on('p2-ready', ({ p2Ball }) => {
        const room = getRoom(socket);
        if (!room || socket.data.number !== 2) return;
        room.config       = room.config || {};
        room.config.p2Ball = p2Ball;
        room.p2Ready       = true;
        maybeStartGame(room);
    });

    // ── Shoot: relay shot params to the opponent ──
    // Includes starting positions so both sides start from identical state.
    socket.on('shoot', data => {
        socket.to(socket.data.code).emit('opponent-shoot', data);
    });

    // ── Shot settled: relay final state to opponent ──
    socket.on('shot-settled', data => {
        socket.to(socket.data.code).emit('shot-settled', data);
    });

    // ── Disconnect ──
    socket.on('disconnect', () => {
        const code = socket.data.code;
        if (!code) return;
        socket.to(code).emit('opponent-left');
        rooms.delete(code);
    });
});

function maybeStartGame(room) {
    if (!room.p1Ready || !room.p2Ready) return;
    io.to(room.code).emit('game-start', { config: room.config });
}

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Billar Francés — servidor en http://localhost:${PORT}`));
