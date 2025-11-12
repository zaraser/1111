import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { Server as SocketIOServer } from "socket.io";
import { createServer } from "https";
import fs from "fs";
import path from "path";
import db, {
  userQueries,
  messageQueries,
  blockQueries,
  friendQueries,
  inviteQueries,
} from "../db";

async function startServer() {
  const fastify = Fastify();

  // === CORS ===
  await fastify.register(fastifyCors, {
    origin: "*",
    methods: ["GET", "POST", "DELETE"],
  });

  // === STATIC (React build) ===
  const staticRoot = path.join(__dirname, "..", "..", "public");
  await fastify.register(fastifyStatic, {
    root: staticRoot,
    prefix: "/",
  });

  // === ACTIVE SOCKET USERS ===
  const connectedUsers = new Map<
    string,
    { userId: string; username: string; avatar: string }
  >();
  let io: SocketIOServer | null = null;

  // -------------------------------------------------
  // 📦 REST API
  // -------------------------------------------------

  // === USERS ===
  fastify.get("/api/users", async () => ({ users: userQueries.getAll.all() }));

  fastify.post("/api/users", async (req: any, reply: any) => {
    const { username, avatar = "👤" } = req.body;
    if (!username) return reply.code(400).send({ error: "Missing username" });

    const existing = userQueries.getByUsername.get(username);
    if (existing) {
      return {
        id: existing.id,
        username: existing.username,
        avatar: existing.avatar ?? "👤",
      };
    }

    const id = `user-${Date.now()}`;
    userQueries.create.run(id, username, avatar);
    return { id, username, avatar };
  });

  // === MESSAGES ===
  fastify.get("/api/messages/:userId/:peerId", async (req: any) => {
    const { userId, peerId } = req.params;
    const blocked =
      blockQueries.check.get(userId, peerId) ||
      blockQueries.check.get(peerId, userId);
    if (blocked) return { messages: [] };

    const messages = messageQueries.getConversation.all(
      userId,
      peerId,
      peerId,
      userId
    );
    return { messages };
  });

  // 🟢 Новый вариант — сохраняем сообщение и рассылаем через сокет
  fastify.post("/api/messages", async (req: any, reply: any) => {
    const { senderId, receiverId, content } = req.body;
    if (!senderId || !receiverId || !content)
      return reply.code(400).send({ error: "Missing fields" });

    const blocked =
      blockQueries.check.get(senderId, receiverId) ||
      blockQueries.check.get(receiverId, senderId);
    if (blocked) return reply.code(403).send({ error: "User blocked" });

    const timestamp = new Date().toISOString();

    try {
      // 💾 Сохраняем сообщение в БД
    messageQueries.insert.run(senderId, receiverId, content);
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
    } catch (err) {
      return reply.code(500).send({ error: "DB insert failed" });
    }
  });

  // === BLOCKS ===
  fastify.post("/api/block", async (req: any) => {
    const { blockerId, blockedId } = req.body;
    blockQueries.add.run(blockerId, blockedId);
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

  fastify.delete("/api/block", async (req: any) => {
    const { blockerId, blockedId } = req.body;
    blockQueries.remove.run(blockerId, blockedId);
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

  fastify.get("/api/blocks/:userId", async (req: any) => {
    const { userId } = req.params;
    return {
      blocked: blockQueries.listByUser.all(userId),
      blockedBy: blockQueries.listBlockedBy.all(userId),
    };
  });

  // === FRIENDS ===
  fastify.get("/api/friends/:userId", async (req: any) => {
    const { userId } = req.params;
    return {
      accepted: friendQueries.getFriends.all(userId),
      incoming: friendQueries.getIncoming.all(userId),
      outgoing: friendQueries.getOutgoing.all(userId),
    };
  });

  fastify.post("/api/friends/request", async (req: any) => {
    const { userId, friendId } = req.body;
    friendQueries.createRequest.run(userId, friendId);

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

  fastify.post("/api/friends/accept", async (req: any) => {
    const { userId, friendId } = req.body;
    friendQueries.upsertAccepted.run(userId, friendId);
    friendQueries.upsertAccepted.run(friendId, userId);

    if (io) {
      for (const [socketId, user] of connectedUsers.entries()) {
        if (user.userId === friendId)
          io.to(socketId).emit("friend_accepted", { fromUserId: userId });
      }
    }
    return { success: true };
  });

  fastify.delete("/api/friends", async (req: any) => {
    const { userId, friendId } = req.body;
    friendQueries.deleteRelation.run(userId, friendId);
    friendQueries.deleteRelation.run(friendId, userId);

    if (io) {
      for (const [socketId, user] of connectedUsers.entries()) {
        if (user.userId === friendId)
          io.to(socketId).emit("friend_removed", { fromUserId: userId });
      }
    }
    return { success: true };
  });

  // === GAME INVITES ===
  fastify.post("/api/invite", async (req: any) => {
    const { inviterId, inviteeId } = req.body;
    inviteQueries.create.run(inviterId, inviteeId);
    return { success: true };
  });

  fastify.post("/api/invite/response", async (req: any) => {
    const { inviterId, inviteeId, accepted } = req.body;
    if (accepted) inviteQueries.accept.run(inviterId, inviteeId);
    else inviteQueries.decline.run(inviterId, inviteeId);
    return { success: true };
  });

  fastify.get("/api/invite/incoming/:userId", async (req: any) => {
    const { userId } = req.params;
    return { incoming: inviteQueries.incoming.all(userId) };
  });

  fastify.get("/api/invite/outgoing/:userId", async (req: any) => {
    const { userId } = req.params;
    return { outgoing: inviteQueries.outgoing.all(userId) };
  });

  // === FALLBACK ===
  fastify.setNotFoundHandler((req, reply) => {
    if (!req.url.startsWith("/api")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "Not Found" });
  });

  // -------------------------------------------------
  // ⚡ SOCKET.IO
  // -------------------------------------------------
  const sslKeyPath =
    process.env.SSL_KEY_PATH ?? path.join(__dirname, "..", "ssl", "key.pem");
  const sslCertPath =
    process.env.SSL_CERT_PATH ?? path.join(__dirname, "..", "ssl", "cert.pem");
  const options = { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) };

  const server = createServer(options, (req, res) =>
    fastify.server.emit("request", req, res)
  );
  await fastify.ready();

  io = new SocketIOServer(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket) => {

    socket.emit("online_users", Array.from(connectedUsers.values()));

    socket.on("user_join", ({ userId, username, avatar }) => {
      connectedUsers.set(socket.id, { userId, username, avatar });
      userQueries.updateOnline.run(1, userId);
      io.emit("online_users", Array.from(connectedUsers.values()));
    });

    socket.on("user_leave", ({ userId }) => {
      for (const [id, info] of connectedUsers.entries()) {
        if (info.userId === userId) {
          connectedUsers.delete(id);
          userQueries.updateOnline.run(0, userId);
        }
      }
      const onlineUsersList = Array.from(connectedUsers.values());
      io.emit("online_users", onlineUsersList);
      io.emit("user_offline", { userId });
    });

    socket.on("disconnect", () => {
      const user = connectedUsers.get(socket.id);
      if (user) {
        userQueries.updateOnline.run(0, user.userId);
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
