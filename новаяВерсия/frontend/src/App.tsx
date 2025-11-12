import React, { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import Front, { GamePage } from "./front";
import { makeSocket, joinAs } from "./socketFrontend";
import { useAppFunctions } from "./functionFront";
import type { User, Message, Friend, Invite } from "./types";

const API_BASE = "https://localhost:8443";

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [messagesByUser, setMessagesByUser] = useState<Record<string, Message[]>>({});
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  
  // Обертка для setSelectedUser, чтобы можно было передавать null
  const handleSetSelectedUser = (user: User | null) => {
    setSelectedUser(user);
  };
  const [messageInput, setMessageInput] = useState("");
  const [unreadMessages, setUnreadMessages] = useState<Set<string>>(new Set());
  const [systemMessage, setSystemMessage] = useState<string>("");

  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [blockedByUsers, setBlockedByUsers] = useState<string[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<Friend[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<Friend[]>([]);

  const [incomingInvites, setIncomingInvites] = useState<Invite[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<Invite[]>([]);
  const [isInviteCooldown, setIsInviteCooldown] = useState(false);
  const [isInviteModalOpen, setInviteModalOpen] = useState(false);
  const [isFriendsModalOpen, setFriendsModalOpen] = useState(false);

  const [showLogin, setShowLogin] = useState(true);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [showMatchHistory, setShowMatchHistory] = useState(false);
  const [showTournamentMatches, setShowTournamentMatches] = useState(false);

  const {
    loadFriendsData,
    addFriend,
    acceptFriend,
    removeFriend,
    declineFriendRequest,
    cancelFriendRequest,
    sendGameInvite,
    cancelGameInvite,
    handleLogin,
    sendMessage,
    blockUser,
    unblockUser,
    handleLogout,
    clearUnreadMessages,
  } = useAppFunctions({
    currentUser,
    socket,
    selectedUser,
    messageInput,
    blockedUsers,
    setCurrentUser,
    setShowLogin,
    setSocket,
    setFriends,
    setIncomingRequests,
    setOutgoingRequests,
      setMessagesByUser,
      setUnreadMessages,
      setMessageInput,
      setSystemMessage,
      setBlockedUsers,
      setBlockedByUsers,
      setOutgoingInvites,
    setIncomingInvites,
    setIsInviteCooldown, // ✅ добавлено
  });

  // === 0. Загрузка пользователей при монтировании (для экрана логина) ===
  useEffect(() => {
    fetch(`${API_BASE}/api/users`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.users) {
          // Преобразуем формат данных: id -> userId
          const users: User[] = data.users.map((u: any) => ({
            userId: u.id || u.userId,
            username: u.username,
            avatar: u.avatar || '👤',
            online: u.online === 1 || u.online === true,
          }));
          setAllUsers(users);
        } else {
          setAllUsers([]);
        }
      })
      .catch(() => setAllUsers([]));
  }, []); // Загружаем один раз при монтировании

  // === 1. Загрузка друзей и блокированных после логина ===
  useEffect(() => {
    if (!currentUser) return;

    loadFriendsData();

    const loadBlocks = () => {
      fetch(`${API_BASE}/api/blocks/${currentUser.userId}`)
        .then((res) => res.json())
        .then((data) => {
          const list = (data.blocked || []).map(
            (b: { blockedId?: string; blocked_id?: string }) => b.blockedId ?? b.blocked_id
          );
          setBlockedUsers(list);
          const blockedByList = (data.blockedBy || []).map(
            (b: { blockerId?: string; blocker_id?: string }) => b.blockerId ?? b.blocker_id
          );
          setBlockedByUsers(blockedByList);
        })
        .catch(() => {});
    };

    loadBlocks();
  }, [currentUser]);

  // === 2. Подключение сокета ===
  useEffect(() => {
    const s = makeSocket();

    s.on("connect", () => {
      if (currentUser) joinAs(s, currentUser);
    });

    s.on("disconnect", () => setOnlineUsers([]));
    
    s.on("online_users", (users: User[]) => {
      setOnlineUsers(users);
    });

    // Обработка отдельных событий онлайн/офлайн для более точного обновления
    s.on("user_online", ({ userId, username, avatar }: { userId: string; username: string; avatar?: string }) => {
      setOnlineUsers((prev) => {
        if (prev.some((u) => u.userId === userId)) {
          return prev; // Уже в списке
        }
        return [...prev, { userId, username, avatar: avatar || '👤', online: true }];
      });
    });

    s.on("user_offline", ({ userId }: { userId: string }) => {
      setOnlineUsers((prev) => prev.filter((u) => u.userId !== userId));
    });

    s.on("private_message", (message: Message) => {
      if (!currentUser) return;
      
      const otherId =
        message.senderId === currentUser.userId ? message.receiverId : message.senderId;
      
      // Проверяем блокировку
      setBlockedUsers((currentBlocked) => {
        if (message.senderId !== currentUser.userId && currentBlocked.includes(otherId)) {
          return currentBlocked; // Сообщение заблокировано
        }
        
        // Обновляем сообщения
        setMessagesByUser((prev) => {
          // Проверяем на дубликаты по timestamp и content
          const existing = prev[otherId] || [];
          const isDuplicate = existing.some(
            (m) => 
              m.timestamp === message.timestamp && 
              m.content === message.content &&
              m.senderId === message.senderId &&
              m.receiverId === message.receiverId
          );
          if (isDuplicate) {
            return prev;
          }
          return {
            ...prev,
            [otherId]: [...existing, message],
          };
        });

        // Обновляем непрочитанные сообщения
        if (message.senderId !== currentUser.userId) {
          setSelectedUser((currentSelected) => {
            if (currentSelected?.userId !== otherId) {
              setUnreadMessages((prev) => new Set(prev).add(otherId));
            }
            return currentSelected;
          });
        }
        
        return currentBlocked;
      });
    });

    setSocket(s);
    return () => {
      if (currentUser) s.emit("user_leave", { userId: currentUser.userId });
      s.disconnect();
    };
  }, [currentUser]);

  // === 3. Загрузка сообщений при выборе собеседника ===
  useEffect(() => {
    if (!currentUser || !selectedUser) return;
    fetch(`${API_BASE}/api/messages/${currentUser.userId}/${selectedUser.userId}`)
      .then((res) => res.json())
      .then((data) => {
        setMessagesByUser((prev) => ({
          ...prev,
          [selectedUser.userId]: data.messages || [],
        }));
        clearUnreadMessages(selectedUser.userId);
        // Автоскролл вниз после загрузки сообщений
        setTimeout(() => {
          const messagesArea = document.querySelector('.messages-area');
          if (messagesArea) {
            messagesArea.scrollTop = messagesArea.scrollHeight;
          }
        }, 100);
      })
      .catch(() => {});
  }, [currentUser, selectedUser]);

  // === 3.1. Автоскролл при получении новых сообщений ===
  useEffect(() => {
    if (!selectedUser) return;
    const messagesArea = document.querySelector('.messages-area');
    if (messagesArea) {
      const isNearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 100;
      if (isNearBottom) {
        setTimeout(() => {
          messagesArea.scrollTop = messagesArea.scrollHeight;
        }, 50);
      }
    }
  }, [messagesByUser, selectedUser]);

  // === 4. Отправка user_leave при закрытии окна ===
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (socket && currentUser)
        socket.emit("user_leave", { userId: currentUser.userId });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [socket, currentUser]);

  // === 5. Слушаем уведомления друзей через сокет ===
  useEffect(() => {
    if (!socket) return;
    const updateFriends = () => loadFriendsData();

    socket.on("friend_request", updateFriends);
    socket.on("friend_accepted", updateFriends);
    socket.on("friend_removed", updateFriends);
    socket.on("friend_declined", updateFriends);
    socket.on("friend_request_created", updateFriends);

    return () => {
      socket.off("friend_request", updateFriends);
      socket.off("friend_accepted", updateFriends);
      socket.off("friend_removed", updateFriends);
      socket.off("friend_declined", updateFriends);
      socket.off("friend_request_created", updateFriends);
    };
  }, [socket]);

  // === 6. Слушаем уведомления о блокировках через сокет ===
  useEffect(() => {
    if (!socket || !currentUser) return;

    const updateBlocks = () => {
      fetch(`${API_BASE}/api/blocks/${currentUser.userId}`)
        .then((res) => res.json())
        .then((data) => {
          const list = (data.blocked || []).map(
            (b: { blockedId?: string; blocked_id?: string }) => b.blockedId ?? b.blocked_id
          );
          setBlockedUsers(list);
          const blockedByList = (data.blockedBy || []).map(
            (b: { blockerId?: string; blocker_id?: string }) => b.blockerId ?? b.blocker_id
          );
          setBlockedByUsers(blockedByList);
        })
        .catch(() => {});
    };

    socket.on("user_blocked", updateBlocks);
    socket.on("user_unblocked", updateBlocks);

    return () => {
      socket.off("user_blocked", updateBlocks);
      socket.off("user_unblocked", updateBlocks);
    };
  }, [socket, currentUser]);

  if (typeof window !== "undefined" && window.location.pathname === "/game") {
    return <GamePage />;
  }

  return (
    <Front
      showLogin={showLogin}
      handleLogin={handleLogin}
      currentUser={currentUser}
      allUsers={allUsers}
      onlineUsers={onlineUsers}
      messagesByUser={messagesByUser}
      selectedUser={selectedUser}
      setSelectedUser={handleSetSelectedUser}
      messageInput={messageInput}
      setMessageInput={setMessageInput}
      unreadMessages={unreadMessages}
      systemMessage={systemMessage}
      friends={friends}
      incomingRequests={incomingRequests}
      outgoingRequests={outgoingRequests}
      blockedUsers={blockedUsers}
      blockedByUsers={blockedByUsers}
      isInviteCooldown={isInviteCooldown}
      isInviteModalOpen={isInviteModalOpen}
      setInviteModalOpen={setInviteModalOpen}
      isFriendsModalOpen={isFriendsModalOpen}
      setFriendsModalOpen={setFriendsModalOpen}
      incomingInvites={incomingInvites}
      setIncomingInvites={setIncomingInvites}
      outgoingInvites={outgoingInvites}
      sendMessage={sendMessage}
      addFriend={addFriend}
      acceptFriend={acceptFriend}
      removeFriend={removeFriend}
      declineFriendRequest={declineFriendRequest}
      cancelFriendRequest={cancelFriendRequest}
      blockUser={blockUser}
      unblockUser={unblockUser}
      sendGameInvite={sendGameInvite}
      cancelGameInvite={cancelGameInvite}
      handleLogout={handleLogout}
      socket={socket}
      showBlacklist={showBlacklist}
      setShowBlacklist={setShowBlacklist}
      showMatchHistory={showMatchHistory}
      setShowMatchHistory={setShowMatchHistory}
      showTournamentMatches={showTournamentMatches}
      setShowTournamentMatches={setShowTournamentMatches}
    />
  );
};

export default App;

