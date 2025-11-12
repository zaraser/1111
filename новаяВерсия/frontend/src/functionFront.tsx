import type { Socket } from "socket.io-client";
import type { User, Message, Friend } from "./types";

interface UseAppFunctionsProps {
  currentUser: User | null;
  socket: Socket | null;
  selectedUser: User | null;
  messageInput: string;
  blockedUsers: string[];

  setCurrentUser: (u: User | null) => void;
  setShowLogin: (v: boolean) => void;
  setSocket: (s: Socket | null) => void;
  setFriends: (f: Friend[]) => void;
  setIncomingRequests: (f: Friend[]) => void;
  setOutgoingRequests: React.Dispatch<React.SetStateAction<Friend[]>>;
  setMessagesByUser: React.Dispatch<
    React.SetStateAction<Record<string, Message[]>>
  >;
  setUnreadMessages: React.Dispatch<React.SetStateAction<Set<string>>>;
      setMessageInput: (v: string) => void;
      setSystemMessage: (msg: string) => void;
      setBlockedUsers: React.Dispatch<React.SetStateAction<string[]>>;
      setBlockedByUsers: (ids: string[]) => void;
      setOutgoingInvites: (v: any) => void;
  setIncomingInvites: (v: any) => void;
  setIsInviteCooldown: (v: boolean) => void;
}

const API_BASE = "https://localhost:8443";

// =========================
// 🔹 Утилита для безопасных запросов (с fallback на HTTP)
// =========================
export async function safeFetch(url: string, options?: RequestInit): Promise<Response | null> {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      return null;
    }
    return response;
  } catch (error: any) {
    // Если ошибка SSL и используется HTTPS, пробуем HTTP
    if (url.includes('https://') && (error?.message?.includes('certificate') || error?.message?.includes('SSL') || error?.message?.includes('Failed to fetch'))) {
      const httpUrl = url.replace('https://', 'http://');
      try {
        const response = await fetch(httpUrl, options);
        if (!response.ok) {
          return null;
        }
        return response;
      } catch (retryError) {
        return null;
      }
    }
    return null;
  }
}

// =========================
// 🔹 Утилита для запросов
// =========================
async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
  }

// =========================
// ⚙️ Основная логика приложения
// =========================
export function useAppFunctions({
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
  setIsInviteCooldown,
}: UseAppFunctionsProps) {

  // === 🔐 ЛОГИН ===
  const handleLogin = async (username: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!res.ok) {
        alert("Ошибка при входе: сервер вернул ошибку");
        return;
      }
      
      const userData = await res.json();
      
      // Преобразуем формат данных: id -> userId (как в App.tsx)
      // Важно: сервер возвращает { id, username, avatar }, а нам нужен userId
      const user: User = {
        userId: userData.id || userData.userId || '',
        username: userData.username || '',
        avatar: userData.avatar || '👤',
        online: userData.online === 1 || userData.online === true,
      };
      
      // Проверяем, что userId действительно установлен
      if (!user.userId) {
        alert("Ошибка: не удалось получить ID пользователя");
        return;
      }
      
      setCurrentUser(user);
    setShowLogin(false);

      if (socket) {
        const sendJoin = () =>
          socket.emit("user_join", {
            userId: user.userId,
            username: user.username,
            avatar: user.avatar,
          });
        if (socket.connected) sendJoin();
        else socket.once("connect", sendJoin);
      }
    } catch (err) {
      alert("Не удалось подключиться к серверу.");
    }
  };

  // === 🚪 ЛОГАУТ ===
  const handleLogout = () => {
    if (socket && currentUser) {
      socket.emit("user_leave", { userId: currentUser.userId });
      setTimeout(() => socket.disconnect(), 100);
    }
    setSocket(null);
    setCurrentUser(null);
    setShowLogin(true);
    setFriends([]);
    setIncomingRequests([]);
    setOutgoingRequests([]);
  };

  // === 💬 ОТПРАВКА СООБЩЕНИЯ ===
  const sendMessage = async () => {
    if (!currentUser || !selectedUser || !messageInput.trim()) return;
    
    // Проверяем блокировки перед отправкой
    if (blockedUsers.includes(selectedUser.userId)) {
      setMessageInput("");
      setSystemMessage("Пользователь недоступен для сообщений 🚫");
      setTimeout(() => setSystemMessage(""), 3000);
      return;
    }

    const content = messageInput.trim();
    const originalInput = messageInput;
    setMessageInput("");

    // Проверяем, что userId существует
    if (!currentUser.userId || !selectedUser.userId) {
      setMessageInput(originalInput);
      return;
    }

    try {
      // Проверяем, что все поля заполнены
      if (!currentUser.userId || !selectedUser.userId || !content) {
        setMessageInput(originalInput);
        return;
      }
      
      const requestBody = {
        senderId: currentUser.userId,
        receiverId: selectedUser.userId,
        content,
      };
      
      const response = await safeFetch(`${API_BASE}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      
      if (!response) {
        setMessageInput(originalInput);
        setSystemMessage("Ошибка: сервер не ответил");
        setTimeout(() => setSystemMessage(""), 3000);
        return;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setMessageInput(originalInput);
        // Если ошибка 403 - это блокировка
        if (response.status === 403) {
          setSystemMessage("Пользователь недоступен для сообщений 🚫");
        } else {
          setSystemMessage(`Ошибка: ${errorData.error || response.statusText}`);
        }
        setTimeout(() => setSystemMessage(""), 3000);
        return;
      }
      
      // Сервер сам разошлёт сообщение по сокету
    } catch (err) {
      setMessageInput(originalInput);
      setSystemMessage("Ошибка при отправке сообщения");
      setTimeout(() => setSystemMessage(""), 3000);
    }
  };

  // === 👥 ДРУЗЬЯ ===
  const loadFriendsData = async () => {
    if (!currentUser) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/friends/${currentUser.userId}`);
      const data = await res.json();
      setFriends(data.accepted || []);
      setIncomingRequests(data.incoming || []);
      setOutgoingRequests(data.outgoing || []);
    } catch (e) {
      // Ошибка загрузки друзей
    }
  };

  const addFriend = async (friendId: string, friendUsername?: string, friendAvatar?: string) => {
    if (!currentUser) return;
    
    // Оптимистичное обновление: сразу добавляем в исходящие заявки
    setOutgoingRequests((prev) => {
      // Проверяем, нет ли уже такой заявки
      if (prev.some((r) => r.friend_id === friendId)) {
        return prev;
      }
      return [
        ...prev,
        {
          friend_id: friendId,
          friend_name: friendUsername || '',
          avatar: friendAvatar || '👤',
          status: 'pending',
        },
      ];
    });
    
    try {
      const response = await apiFetch(`${API_BASE}/api/friends/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.userId, friendId }),
      });
      
      if (!response) {
        // В случае ошибки убираем оптимистичное обновление
        setOutgoingRequests((prev) => prev.filter((r) => r.friend_id !== friendId));
        return;
      }
      
      // Обновление произойдет через событие friend_request_created от сервера
    } catch (err) {
      // В случае ошибки убираем оптимистичное обновление
      setOutgoingRequests((prev) => prev.filter((r) => r.friend_id !== friendId));
    }
  };

  const acceptFriend = async (friendId: string) => {
    if (!currentUser) return;
    await apiFetch(`${API_BASE}/api/friends/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.userId, friendId }),
    });
    loadFriendsData();
  };

  const deleteFriendRelation = async (friendId: string) => {
    if (!currentUser) return;
    await apiFetch(`${API_BASE}/api/friends`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.userId, friendId }),
    });
    loadFriendsData();
  };

  const removeFriend = deleteFriendRelation;
  const declineFriendRequest = deleteFriendRelation;
  const cancelFriendRequest = deleteFriendRelation;

  // === 🚫 БЛОКИРОВКА ===
  const blockUser = async (userId: string) => {
    if (!currentUser) return;
    await apiFetch(`${API_BASE}/api/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockerId: currentUser.userId, blockedId: userId }),
    });
    // Обновляем состояние после блокировки
    const res = await safeFetch(`${API_BASE}/api/blocks/${currentUser.userId}`);
    if (res) {
      const data = await res.json();
      const list = (data.blocked || []).map(
        (b: { blockedId?: string; blocked_id?: string }) => b.blockedId ?? b.blocked_id
      );
      setBlockedUsers(list);
      const blockedByList = (data.blockedBy || []).map(
        (b: { blockerId?: string; blocker_id?: string }) => b.blockerId ?? b.blocker_id
      );
      setBlockedByUsers(blockedByList);
    } else {
      // Fallback: просто добавляем в список
      setBlockedUsers([...blockedUsers, userId]);
    }
  };

  const unblockUser = async (userId: string) => {
    if (!currentUser) return;
    
    // Оптимистичное обновление: сразу убираем из списка
    setBlockedUsers((prev: string[]) => prev.filter((id: string) => id !== userId));
    
    try {
      await apiFetch(`${API_BASE}/api/block`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockerId: currentUser.userId, blockedId: userId }),
      });
      
      // Обновляем оба состояния после разблокировки
      const res = await safeFetch(`${API_BASE}/api/blocks/${currentUser.userId}`);
      if (res) {
        const data = await res.json();
        const list = (data.blocked || []).map(
          (b: { blockedId?: string; blocked_id?: string }) => b.blockedId ?? b.blocked_id
        );
        setBlockedUsers(list);
        const blockedByList = (data.blockedBy || []).map(
          (b: { blockerId?: string; blocker_id?: string }) => b.blockerId ?? b.blocker_id
        );
        setBlockedByUsers(blockedByList);
      }
    } catch (err) {
      // В случае ошибки возвращаем обратно
      setBlockedUsers((prev: string[]) => [...prev, userId]);
    }
  };

  // === 🎮 ПРИГЛАШЕНИЯ В ИГРУ ===
  const sendGameInvite = (user: User) => {
    if (!currentUser || !socket) return;
    socket.emit("game_invite", {
      inviterId: currentUser.userId,
      inviteeId: user.userId,
    });
    fetch(`${API_BASE}/api/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviterId: currentUser.userId,
        inviteeId: user.userId,
      }),
    });
    setIsInviteCooldown(true);
    setTimeout(() => setIsInviteCooldown(false), 5000);
    setOutgoingInvites((prev: any[]) => [
      ...prev,
      { userId: user.userId, username: user.username, avatar: user.avatar },
    ]);
  };

  const cancelGameInvite = (userId: string) => {
    if (!currentUser || !socket) return;
    socket.emit("game_invite_cancel", {
      inviterId: currentUser.userId,
      inviteeId: userId,
    });
    fetch(`${API_BASE}/api/invite/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviterId: currentUser.userId,
        inviteeId: userId,
        accepted: false,
      }),
    });
    setOutgoingInvites((prev: any[]) => prev.filter((i) => i.userId !== userId));
  };

  // === ✉️ НЕПРОЧИТАННЫЕ ===
  const clearUnreadMessages = (userId: string) => {
    setUnreadMessages((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  return {
    handleLogin,
    handleLogout,
    sendMessage,
    loadFriendsData,
    addFriend,
    acceptFriend,
    removeFriend,
    declineFriendRequest,
    cancelFriendRequest,
    blockUser,
    unblockUser,
    sendGameInvite,
    cancelGameInvite,
    clearUnreadMessages,
  };
}
