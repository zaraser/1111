"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const socket_io_1 = require("socket.io");
const https_1 = require("https");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./db");
async function startServer() {
    const fastify = (0, fastify_1.default)();
    // Разрешаем CORS
    await fastify.register(Promise.resolve().then(() => __importStar(require('@fastify/cors'))), {
        origin: '*',
        methods: ['GET', 'POST', 'DELETE'],
    });
    // Отдаём React (frontend)
    await fastify.register(Promise.resolve().then(() => __importStar(require('@fastify/static'))), {
        root: path_1.default.join(process.cwd(), 'build'),
        prefix: '/',
    });
    // Хранилище активных соединений
    const connectedUsers = new Map();
    // ---------------- REST API ----------------
    // === Пользователи ===
    fastify.get('/api/users', async () => ({ users: db_1.userQueries.getAll.all() }));
    fastify.post('/api/users', async (req, reply) => {
        const { username, avatar = '👤' } = req.body;
        if (!username)
            return reply.code(400).send({ error: 'Missing username' });
        const existing = db_1.userQueries.getByUsername.get(username);
        if (existing)
            return reply.code(409).send({ error: 'Username taken' });
        const id = `user-${Date.now()}`;
        db_1.userQueries.create.run(id, username, avatar);
        return { id, username, avatar };
    });
    // === Сообщения ===
    fastify.get('/api/messages/:userId/:peerId', async (req) => {
        const { userId, peerId } = req.params;
        const blocked = db_1.blockQueries.check.get(userId, peerId) ||
            db_1.blockQueries.check.get(peerId, userId);
        if (blocked)
            return { messages: [] };
        const messages = db_1.messageQueries.getConversation.all(userId, peerId, peerId, userId);
        return { messages };
    });
    fastify.post('/api/messages', async (req, reply) => {
        const { senderId, receiverId, content } = req.body;
        if (!senderId || !receiverId || !content)
            return reply.code(400).send({ error: 'Missing fields' });
        const blocked = db_1.blockQueries.check.get(senderId, receiverId) ||
            db_1.blockQueries.check.get(receiverId, senderId);
        if (blocked)
            return reply.code(403).send({ error: 'User blocked' });
        db_1.messageQueries.insert.run(senderId, receiverId, content);
        return { success: true };
    });
    // === Блокировка ===
    fastify.post('/api/block', async (req) => {
        const { blockerId, blockedId } = req.body;
        db_1.blockQueries.add.run(blockerId, blockedId);
        return { success: true }; // ✅ Добавили return
    });
    fastify.delete('/api/block', async (req) => {
        const { blockerId, blockedId } = req.body;
        db_1.blockQueries.remove.run(blockerId, blockedId);
        return { success: true }; // ✅ Добавили return
    });
    fastify.get('/api/blocks/:userId', async (req) => {
        const { userId } = req.params;
        const blocked = db_1.blockQueries.listByUser.all(userId);
        return { blocked };
    });
    // === Друзья ===
    fastify.get('/api/friends/:userId', async (req) => {
        const { userId } = req.params;
        return {
            accepted: db_1.friendQueries.getFriends.all(userId),
            incoming: db_1.friendQueries.getIncoming.all(userId),
        };
    });
    fastify.post('/api/friends/request', async (req) => {
        const { userId, friendId } = req.body;
        db_1.friendQueries.createRequest.run(userId, friendId);
        return { success: true };
    });
    fastify.post('/api/friends/accept', async (req) => {
        const { userId, friendId } = req.body;
        db_1.friendQueries.upsertAccepted.run(userId, friendId);
        db_1.friendQueries.upsertAccepted.run(friendId, userId);
        return { success: true };
    });
    // === Игровые приглашения ===
    fastify.post('/api/invite', async (req) => {
        const { inviterId, inviteeId } = req.body;
        db_1.inviteQueries.create.run(inviterId, inviteeId);
        return { success: true };
    });
    fastify.post('/api/invite/response', async (req) => {
        const { inviterId, inviteeId, accepted } = req.body;
        if (accepted)
            db_1.inviteQueries.accept.run(inviterId, inviteeId);
        else
            db_1.inviteQueries.decline.run(inviterId, inviteeId);
        return { success: true };
    });
    fastify.get('/api/invite/incoming/:userId', async (req) => {
        const { userId } = req.params;
        return { incoming: db_1.inviteQueries.incoming.all(userId) };
    });
    fastify.get('/api/invite/outgoing/:userId', async (req) => {
        const { userId } = req.params;
        return { outgoing: db_1.inviteQueries.outgoing.all(userId) };
    });
    // === React fallback ===
    fastify.setNotFoundHandler((req, reply) => {
        if (!req.url.startsWith('/api'))
            return reply.sendFile('index.html');
        reply.code(404).send({ error: 'Not Found' });
    });
    // ---------------- HTTPS + SOCKET.IO ----------------
    const options = {
        key: fs_1.default.readFileSync('key.pem'),
        cert: fs_1.default.readFileSync('cert.pem'),
    };
    const server = (0, https_1.createServer)(options, (req, res) => fastify.server.emit('request', req, res));
    await fastify.ready();
    const io = new socket_io_1.Server(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
    });
    io.on('connection', (socket) => {
        console.log('🟢 Connected:', socket.id);
        socket.on('user_join', ({ userId, username, avatar }) => {
            connectedUsers.set(socket.id, { userId, username, avatar });
            db_1.userQueries.updateOnline.run(1, userId);
            io.emit('online_users', Array.from(connectedUsers.values()));
        });
        socket.on('private_message', (msg) => {
            const { senderId, receiverId, content } = msg;
            const blocked = db_1.blockQueries.check.get(senderId, receiverId) ||
                db_1.blockQueries.check.get(receiverId, senderId);
            if (blocked)
                return socket.emit('message_blocked', { receiverId });
            const timestamp = new Date().toISOString();
            db_1.messageQueries.insert.run(senderId, receiverId, content);
            const message = { senderId, receiverId, content, timestamp };
            for (const [id, user] of connectedUsers.entries()) {
                if (user.userId === senderId || user.userId === receiverId)
                    io.to(id).emit('private_message', message);
            }
        });
        socket.on('game_invite', ({ inviterId, inviteeId }) => {
            db_1.inviteQueries.create.run(inviterId, inviteeId);
            for (const [id, user] of connectedUsers.entries()) {
                if (user.userId === inviteeId)
                    io.to(id).emit('game_invite', { inviterId, createdAt: new Date().toISOString() });
            }
        });
        socket.on('game_invite_response', ({ inviterId, inviteeId, accepted }) => {
            if (accepted)
                db_1.inviteQueries.accept.run(inviterId, inviteeId);
            else
                db_1.inviteQueries.decline.run(inviterId, inviteeId);
            for (const [id, user] of connectedUsers.entries()) {
                if (user.userId === inviterId)
                    io.to(id).emit('game_invite_response', { inviteeId, accepted });
            }
        });
        socket.on('user_leave', ({ userId }) => {
            for (const [id, info] of connectedUsers.entries()) {
                if (info.userId === userId) {
                    connectedUsers.delete(id);
                    db_1.userQueries.updateOnline.run(0, userId);
                }
            }
            io.emit('online_users', Array.from(connectedUsers.values()));
        });
        socket.on('disconnect', () => {
            const user = connectedUsers.get(socket.id);
            if (user) {
                db_1.userQueries.updateOnline.run(0, user.userId);
                connectedUsers.delete(socket.id);
                io.emit('online_users', Array.from(connectedUsers.values()));
            }
        });
    });
    // ---------------- START ----------------
    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8443;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Chat backend ready: https://localhost:${PORT}`);
    });
}
startServer().catch(console.error);
