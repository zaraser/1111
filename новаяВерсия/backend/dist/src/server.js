"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const static_1 = __importDefault(require("@fastify/static"));
const socket_io_1 = require("socket.io");
const https_1 = require("https");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../db");
async function startServer() {
    const fastify = (0, fastify_1.default)();
    // === CORS ===
    await fastify.register(cors_1.default, {
        origin: "*",
        methods: ["GET", "POST", "DELETE"],
    });
    // === STATIC (React build) ===
    const staticRoot = path_1.default.join(__dirname, "..", "..", "public");
    await fastify.register(static_1.default, {
        root: staticRoot,
        prefix: "/",
    });
    // === ACTIVE SOCKET USERS ===
    const connectedUsers = new Map();
    let io = null;
    // -------------------------------------------------
    // 📦 REST API
    // -------------------------------------------------
    // === USERS ===
    fastify.get("/api/users", async () => ({ users: db_1.userQueries.getAll.all() }));
    fastify.post("/api/users", async (req, reply) => {
        const { username, avatar = "👤" } = req.body;
        if (!username)
            return reply.code(400).send({ error: "Missing username" });
        const existing = db_1.userQueries.getByUsername.get(username);
        if (existing) {
            return {
                id: existing.id,
                username: existing.username,
                avatar: existing.avatar ?? "👤",
            };
        }
        const id = `user-${Date.now()}`;
        db_1.userQueries.create.run(id, username, avatar);
        return { id, username, avatar };
    });
    // === MESSAGES ===
    fastify.get("/api/messages/:userId/:peerId", async (req) => {
        const { userId, peerId } = req.params;
        const blocked = db_1.blockQueries.check.get(userId, peerId) ||
            db_1.blockQueries.check.get(peerId, userId);
        if (blocked)
            return { messages: [] };
        const messages = db_1.messageQueries.getConversation.all(userId, peerId, peerId, userId);
        return { messages };
    });
    // 🟢 Новый вариант — сохраняем сообщение и рассылаем через сокет
    fastify.post("/api/messages", async (req, reply) => {
        const { senderId, receiverId, content } = req.body;
        if (!senderId || !receiverId || !content)
            return reply.code(400).send({ error: "Missing fields" });
        const blocked = db_1.blockQueries.check.get(senderId, receiverId) ||
            db_1.blockQueries.check.get(receiverId, senderId);
        if (blocked)
            return reply.code(403).send({ error: "User blocked" });
        const timestamp = new Date().toISOString();
        try {
            // 💾 Сохраняем сообщение в БД
            db_1.messageQueries.insert.run(senderId, receiverId, content);
            const message = { senderId, receiverId, content, timestamp };
            // 📡 Рассылаем обоим пользователям
            if (io) {
                for (const [socketId, user] of connectedUsers.entries()) {
                    if (user.userId === senderId || user.userId === receiverId) {
                        io.to(socketId).emit("private_message", message);
                    }
                }
            }
            return { success: true, message };
        }
        catch (err) {
            return reply.code(500).send({ error: "DB insert failed" });
        }
    });
    // === BLOCKS ===
    fastify.post("/api/block", async (req) => {
        const { blockerId, blockedId } = req.body;
        db_1.blockQueries.add.run(blockerId, blockedId);
        if (io) {
            for (const [socketId, user] of connectedUsers.entries()) {
                if (user.userId === blockedId) {
                    io.to(socketId).emit("user_blocked", { fromUserId: blockerId });
                }
                if (user.userId === blockerId) {
                    io.to(socketId).emit("user_blocked", { fromUserId: blockerId });
                }
            }
        }
        return { success: true };
    });
    fastify.delete("/api/block", async (req) => {
        const { blockerId, blockedId } = req.body;
        db_1.blockQueries.remove.run(blockerId, blockedId);
        if (io) {
            for (const [socketId, user] of connectedUsers.entries()) {
                if (user.userId === blockedId) {
                    io.to(socketId).emit("user_unblocked", { fromUserId: blockerId });
                }
                if (user.userId === blockerId) {
                    io.to(socketId).emit("user_unblocked", { fromUserId: blockerId });
                }
            }
        }
        return { success: true };
    });
    fastify.get("/api/blocks/:userId", async (req) => {
        const { userId } = req.params;
        return {
            blocked: db_1.blockQueries.listByUser.all(userId),
            blockedBy: db_1.blockQueries.listBlockedBy.all(userId),
        };
    });
    // === FRIENDS ===
    fastify.get("/api/friends/:userId", async (req) => {
        const { userId } = req.params;
        return {
            accepted: db_1.friendQueries.getFriends.all(userId),
            incoming: db_1.friendQueries.getIncoming.all(userId),
            outgoing: db_1.friendQueries.getOutgoing.all(userId),
        };
    });
    fastify.post("/api/friends/request", async (req) => {
        const { userId, friendId } = req.body;
        db_1.friendQueries.createRequest.run(userId, friendId);
        if (io) {
            for (const [socketId, user] of connectedUsers.entries()) {
                // Уведомляем получателя о новой заявке
                if (user.userId === friendId)
                    io.to(socketId).emit("friend_request", { fromUserId: userId });
                // Уведомляем отправителя, что заявка создана
                if (user.userId === userId)
                    io.to(socketId).emit("friend_request_created", { userId, friendId });
            }
        }
        return { success: true };
    });
    fastify.post("/api/friends/accept", async (req) => {
        const { userId, friendId } = req.body;
        db_1.friendQueries.upsertAccepted.run(userId, friendId);
        db_1.friendQueries.upsertAccepted.run(friendId, userId);
        if (io) {
            for (const [socketId, user] of connectedUsers.entries()) {
                if (user.userId === friendId)
                    io.to(socketId).emit("friend_accepted", { fromUserId: userId });
            }
        }
        return { success: true };
    });
    fastify.delete("/api/friends", async (req) => {
        const { userId, friendId } = req.body;
        db_1.friendQueries.deleteRelation.run(userId, friendId);
        db_1.friendQueries.deleteRelation.run(friendId, userId);
        if (io) {
            for (const [socketId, user] of connectedUsers.entries()) {
                if (user.userId === friendId)
                    io.to(socketId).emit("friend_removed", { fromUserId: userId });
            }
        }
        return { success: true };
    });
    // === GAME INVITES ===
    fastify.post("/api/invite", async (req) => {
        const { inviterId, inviteeId } = req.body;
        db_1.inviteQueries.create.run(inviterId, inviteeId);
        return { success: true };
    });
    fastify.post("/api/invite/response", async (req) => {
        const { inviterId, inviteeId, accepted } = req.body;
        if (accepted)
            db_1.inviteQueries.accept.run(inviterId, inviteeId);
        else
            db_1.inviteQueries.decline.run(inviterId, inviteeId);
        return { success: true };
    });
    fastify.get("/api/invite/incoming/:userId", async (req) => {
        const { userId } = req.params;
        return { incoming: db_1.inviteQueries.incoming.all(userId) };
    });
    fastify.get("/api/invite/outgoing/:userId", async (req) => {
        const { userId } = req.params;
        return { outgoing: db_1.inviteQueries.outgoing.all(userId) };
    });
    // === FALLBACK ===
    fastify.setNotFoundHandler((req, reply) => {
        if (!req.url.startsWith("/api"))
            return reply.sendFile("index.html");
        return reply.code(404).send({ error: "Not Found" });
    });
    // -------------------------------------------------
    // ⚡ SOCKET.IO
    // -------------------------------------------------
    const sslKeyPath = process.env.SSL_KEY_PATH ?? path_1.default.join(__dirname, "..", "ssl", "key.pem");
    const sslCertPath = process.env.SSL_CERT_PATH ?? path_1.default.join(__dirname, "..", "ssl", "cert.pem");
    const options = { key: fs_1.default.readFileSync(sslKeyPath), cert: fs_1.default.readFileSync(sslCertPath) };
    const server = (0, https_1.createServer)(options, (req, res) => fastify.server.emit("request", req, res));
    await fastify.ready();
    io = new socket_io_1.Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"] },
    });
    io.on("connection", (socket) => {
        socket.emit("online_users", Array.from(connectedUsers.values()));
        socket.on("user_join", ({ userId, username, avatar }) => {
            connectedUsers.set(socket.id, { userId, username, avatar });
            db_1.userQueries.updateOnline.run(1, userId);
            io.emit("online_users", Array.from(connectedUsers.values()));
        });
        socket.on("user_leave", ({ userId }) => {
            for (const [id, info] of connectedUsers.entries()) {
                if (info.userId === userId) {
                    connectedUsers.delete(id);
                    db_1.userQueries.updateOnline.run(0, userId);
                }
            }
            const onlineUsersList = Array.from(connectedUsers.values());
            io.emit("online_users", onlineUsersList);
            io.emit("user_offline", { userId });
        });
        socket.on("disconnect", () => {
            const user = connectedUsers.get(socket.id);
            if (user) {
                db_1.userQueries.updateOnline.run(0, user.userId);
                connectedUsers.delete(socket.id);
                const onlineUsersList = Array.from(connectedUsers.values());
                io.emit("online_users", onlineUsersList);
                io.emit("user_offline", { userId: user.userId });
            }
        });
    });
    // -------------------------------------------------
    // 🚀 START SERVER
    // -------------------------------------------------
    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8443;
    server.listen(PORT, "0.0.0.0", () => {
    });
}
startServer().catch(console.error);
