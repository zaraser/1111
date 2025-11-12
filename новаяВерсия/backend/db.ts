import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'chat.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    avatar TEXT DEFAULT '👤',
    online INTEGER DEFAULT 0,
    last_seen TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS game_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id TEXT NOT NULL,
    invitee_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (sender_id, receiver_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_blocks_user ON blocks (blocker_id);
  CREATE INDEX IF NOT EXISTS idx_friends_user ON friends (user_id);
  CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends (friend_id);
  CREATE INDEX IF NOT EXISTS idx_invites_inviter ON game_invites (inviter_id);
  CREATE INDEX IF NOT EXISTS idx_invites_invitee ON game_invites (invitee_id);
`);

const seedUsers: Array<[string, string, string]> = [
  ['user-1', 'Alice', '👩'],
  ['user-2', 'Bob', '👨'],
  ['user-3', 'Ann', '👩'],
  ['user-4', 'Bobik', '🧑']
];

const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, username, avatar) VALUES (?, ?, ?)');
db.transaction(() => {
  for (const [id, username, avatar] of seedUsers) {
    insertUser.run(id, username, avatar);
  }
})();

export const userQueries = {
  getAll: db.prepare('SELECT id, username, avatar, online, last_seen FROM users ORDER BY username'),
  getById: db.prepare('SELECT id, username, avatar, online, last_seen FROM users WHERE id = ?'),
  getByUsername: db.prepare('SELECT id, username, avatar, online, last_seen FROM users WHERE username = ?'),
  create: db.prepare('INSERT INTO users (id, username, avatar) VALUES (?, ?, ?)'),
  updateOnline: db.prepare('UPDATE users SET online = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?')
};

export const messageQueries = {
  getConversation: db.prepare(`
    SELECT sender_id AS senderId,
           receiver_id AS receiverId,
           content,
           timestamp
    FROM messages
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
    ORDER BY timestamp ASC
  `),
  insert: db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)')
};

export const blockQueries = {
  listByUser: db.prepare('SELECT blocked_id AS blockedId FROM blocks WHERE blocker_id = ?'),
  listBlockedBy: db.prepare('SELECT blocker_id AS blockerId FROM blocks WHERE blocked_id = ?'),
  check: db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?'),
  add: db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)'),
  remove: db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
};

export const friendQueries = {
  getFriends: db.prepare(`
    SELECT f.friend_id AS friend_id,
           u.username AS friend_name,
           u.avatar,
           f.status
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'accepted'
    ORDER BY u.username
  `),
  getIncoming: db.prepare(`
    SELECT f.user_id AS friend_id,
           u.username AS friend_name,
           u.avatar,
           f.status
    FROM friends f
    JOIN users u ON u.id = f.user_id
    WHERE f.friend_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `),
  getOutgoing: db.prepare(`
    SELECT f.friend_id AS friend_id,
           u.username AS friend_name,
           u.avatar,
           f.status
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `),
  createRequest: db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')"),
  acceptRequest: db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?"),
  upsertAccepted: db.prepare("INSERT OR REPLACE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')"),
  deleteRelation: db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?')
};

export const inviteQueries = {
  create: db.prepare("INSERT INTO game_invites (inviter_id, invitee_id, status) VALUES (?, ?, 'pending')"),
  cancel: db.prepare("DELETE FROM game_invites WHERE inviter_id = ? AND invitee_id = ? AND status = 'pending'"),
  incoming: db.prepare(`
    SELECT inviter_id AS userId,
           created_at AS createdAt,
           status
    FROM game_invites
    WHERE invitee_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `),
  outgoing: db.prepare(`
    SELECT invitee_id AS userId,
           created_at AS createdAt,
           status
    FROM game_invites
    WHERE inviter_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `),
  accept: db.prepare("UPDATE game_invites SET status = 'accepted' WHERE inviter_id = ? AND invitee_id = ? AND status = 'pending'"),
  decline: db.prepare("UPDATE game_invites SET status = 'declined' WHERE inviter_id = ? AND invitee_id = ? AND status = 'pending'"),
  cleanup: db.prepare(`
    DELETE FROM game_invites
    WHERE status = 'pending'
      AND created_at < datetime('now', '-1 day')
  `)
};

export default db;
