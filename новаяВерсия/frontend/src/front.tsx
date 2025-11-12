import React, { Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { Friend, Invite, Message, User } from './types';
import { safeFetch } from './functionFront';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://localhost:8443';

interface FrontProps {
  showLogin: boolean;
  handleLogin: (username: string) => Promise<void>;


  currentUser: User | null;
  allUsers: User[];
  onlineUsers: User[];

  messagesByUser: Record<string, Message[]>;
  selectedUser: User | null;
  setSelectedUser: (user: User | null) => void;

  messageInput: string;
  setMessageInput: (value: string) => void;
  unreadMessages: Set<string>;
  systemMessage: string;

  friends: Friend[];
  incomingRequests: Friend[];
  outgoingRequests: Friend[];
  blockedUsers: string[];
  blockedByUsers: string[];

  isInviteCooldown: boolean;
  isInviteModalOpen: boolean;
  setInviteModalOpen: (open: boolean) => void;
  isFriendsModalOpen: boolean;
  setFriendsModalOpen: Dispatch<SetStateAction<boolean>>;
  incomingInvites: Invite[];
  setIncomingInvites: Dispatch<SetStateAction<Invite[]>>;
  outgoingInvites: Invite[];

  sendMessage: () => void;
  addFriend: (userId: string, username?: string, avatar?: string) => void;
  acceptFriend: (userId: string) => void;
  removeFriend: (userId: string) => void;
  declineFriendRequest: (userId: string) => void;
  cancelFriendRequest: (userId: string) => void;
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  sendGameInvite: (user: User) => void;   // принимает User
  cancelGameInvite: (userId: string) => void;
  handleLogout: () => void;
  socket: Socket | null;

  // Модальные окна
  showProfile?: boolean;
  showBlacklist?: boolean;
  showMatchHistory?: boolean;
  showTournamentMatches?: boolean;
  setShowProfile?: Dispatch<SetStateAction<boolean>>;
  setShowBlacklist?: Dispatch<SetStateAction<boolean>>;
  setShowMatchHistory?: Dispatch<SetStateAction<boolean>>;
  setShowTournamentMatches?: Dispatch<SetStateAction<boolean>>;
}

// ================================
// 🎮 Страница игры
// ================================
export const GamePage: React.FC = () => {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const opponentId = params.get('with') || 'opponent';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 12,
      }}
    >
      <h2>🎮 Матч с {opponentId}</h2>
      <button onClick={() => (window.location.href = '/')}>⬅ Вернуться в чат</button>
    </div>
  );
};

// ================================
// 💬 Основной интерфейс чата
// ================================
const Front: React.FC<FrontProps> = ({
  showLogin,
  handleLogin,
  currentUser,
  allUsers,
  onlineUsers,
  messagesByUser,
  selectedUser,
  setSelectedUser,
      messageInput,
      setMessageInput,
      unreadMessages,
      systemMessage,
  friends,
  incomingRequests,
  outgoingRequests,
      blockedUsers,
      blockedByUsers,
  isInviteCooldown,
  isInviteModalOpen,
  setInviteModalOpen,
  isFriendsModalOpen,
  setFriendsModalOpen,
  incomingInvites,
  setIncomingInvites,
  outgoingInvites,
  sendMessage,
  addFriend,
  acceptFriend,
  removeFriend,
  declineFriendRequest,
  cancelFriendRequest,
  blockUser,
  unblockUser,
  sendGameInvite,
  cancelGameInvite,
  handleLogout,
  socket,
  showProfile = false,
  showBlacklist = false,
  showMatchHistory = false,
  showTournamentMatches = false,
  setShowProfile,
  setShowBlacklist,
  setShowMatchHistory,
  setShowTournamentMatches,
}) => {
  // --- экран входа ---
  if (showLogin) {
    
    // Показываем реальных пользователей из базы данных
    const availableUsers = allUsers.length > 0 
      ? allUsers 
      : []; // Если пользователи еще не загружены, показываем пустой список
    
    return (
      <div className="login-screen">
        <h2>Выберите пользователя</h2>
        {availableUsers.length === 0 ? (
          <p className="login-loading">Загрузка пользователей...</p>
        ) : (
          <div className="login-users-list">
            {availableUsers.map((user) => {
              const isOnline = onlineUsers.some((u) => u.userId === user.userId);
              return (
                <button
                  key={user.userId}
                  className="login-user-button"
                  onClick={async () => {
                    await handleLogin(user.username);
                  }}
                >
                  <span className="login-user-avatar">{user.avatar || '👤'}</span>
                  <span className="login-user-name">{user.username}</span>
                  <span
                    className={`user-status-dot login-user-status ${isOnline ? 'online' : 'offline'}`}
                    title={isOnline ? 'Онлайн' : 'Офлайн'}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }


  // --- вычисления для списка пользователей ---
  const handleFriendsClick = () => {
    setFriendsModalOpen(true);
  };

  const handleBlacklistClick = () => {
    if (setShowBlacklist) {
      setShowBlacklist(true);
    }
  };

  const handleHistoryClick = () => {
    if (setShowMatchHistory) {
      setShowMatchHistory(true);
    }
  };

  const handleTournamentClick = () => {
    if (setShowTournamentMatches) {
      setShowTournamentMatches(true);
    }
  };

  const topButtons = [
    { label: '👥 Друзья', onClick: handleFriendsClick },
    { label: '🚫 Чёрный список', onClick: handleBlacklistClick },
    { label: '🎮 Игровые приглашения', onClick: () => setInviteModalOpen(true) },
    { label: '🏆 История матчей', onClick: handleHistoryClick },
    { label: '🏆 Турнирные матчи', onClick: handleTournamentClick },
  ];

  // Вычисляем статус онлайн для каждого пользователя
  // Используем useMemo для оптимизации, но также гарантируем пересчет при изменении onlineUsers
  const usersWithStatus = React.useMemo(() => {
    return allUsers.map((user) => ({
      ...user,
      online: onlineUsers.some((u) => u.userId === user.userId),
  }));
  }, [allUsers, onlineUsers]);

  const activeMessages = selectedUser ? messagesByUser[selectedUser.userId] || [] : [];

  const acceptedFriends = friends.filter((friend) => friend.status === 'accepted');
  const pendingIncoming = incomingRequests.filter((friend) => friend.status === 'pending');
  const pendingOutgoing = outgoingRequests.filter((friend) => friend.status === 'pending');

  // =============================
  // Рендер
  // =============================
  return (
    <div className="chat-wrapper">
      <div className="chat-grid">
      {/* ======= Сайдбар ======= */}
      <aside className="chat-sidebar">
        {/* Кнопки навигации */}
        <div className="sidebar-nav-buttons">
          {topButtons.map((button) => (
            <button 
              type="button" 
              key={button.label} 
              onClick={button.onClick}
              className="sidebar-nav-button"
            >
              {button.label}
            </button>
          ))}
        </div>

        <h3>Пользователи</h3>

        {usersWithStatus
          .filter((user) => user.userId !== currentUser?.userId)
          .map((user) => {
            const isFriend = friends.some(
              (f) => f.friend_id === user.userId && f.status === 'accepted'
            );
            const hasRequest = incomingRequests.some(
              (r) => r.friend_id === user.userId && r.status === 'pending'
            );
            const outgoingPending = outgoingRequests.some(
              (r) => r.friend_id === user.userId && r.status === 'pending'
            );
            const isBlocked = blockedUsers.includes(user.userId);

            const friendButton = (() => {
              if (hasRequest) {
                return null;
              }
              if (isFriend) {
                return {
                  label: '✖',
                  title: 'Удалить из друзей',
                  className: 'icon-button friend remove',
                  handler: (e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    removeFriend(user.userId);
                  },
                };
              }
              if (outgoingPending) {
                return {
                  label: '⏳',
                  title: 'Отменить заявку',
                  className: 'icon-button friend pending',
                  handler: (e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    cancelFriendRequest(user.userId);
                  },
                };
              }
              return {
                label: '👥',
                title: 'Добавить в друзья',
                className: 'icon-button friend add',
                handler: (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  addFriend(user.userId, user.username, user.avatar);
                },
              };
            })();

            return (
              <div
                key={user.userId}
                className={`user-card ${selectedUser?.userId === user.userId ? 'selected' : ''}`}
                onClick={() => setSelectedUser(user)}
              >
                <div className="user-info">
                  <span className="user-avatar">{user.avatar}</span>
                  <span className="user-name">{user.username}</span>
                  <span 
                    className={`user-status-dot ${user.online ? 'online' : 'offline'}`}
                    title={user.online ? 'Онлайн' : 'Офлайн'}
                  />
                  {unreadMessages.has(user.userId) && (
                    <span className="user-unread-dot">•</span>
                  )}
                </div>

                <div className="user-actions">
                  {friendButton && (
                    <button
                      type="button"
                      className={friendButton.className}
                      title={friendButton.title}
                      onClick={friendButton.handler}
                    >
                      {friendButton.label}
                    </button>
                  )}

                  {hasRequest && (
                    <>
                      <button
                        type="button"
                        className="icon-button friend accept"
                        title="Принять заявку"
                        onClick={(e) => {
                          e.stopPropagation();
                          acceptFriend(user.userId);
                        }}
                      >
                        ✅
                      </button>
                      <button
                        type="button"
                        className="icon-button friend decline"
                        title="Отклонить заявку"
                        onClick={(e) => {
                          e.stopPropagation();
                          declineFriendRequest(user.userId);
                        }}
                      >
                        ✖
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className={`icon-button block ${isBlocked ? 'active' : ''}`}
                    title={isBlocked ? 'Разблокировать' : 'Заблокировать'}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isBlocked) {
                        unblockUser(user.userId);
                      } else {
                        blockUser(user.userId);
                      }
                    }}
                  >
                    {isBlocked ? '🔓' : '🚫'}
                  </button>

                  <button
                    type="button"
                    className={`icon-button game ${isInviteCooldown ? 'disabled' : ''}`}
                    title="Игровое приглашение"
                    disabled={isInviteCooldown}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isInviteCooldown) {
                        sendGameInvite(user);
                      }
                    }}
                  >
                    🎮
                  </button>
            </div>
          </div>
            );
          })}

        <hr className="chat-sidebar-divider" />
        <div className="chat-sidebar-button">
          <button
            onClick={() => {
              setInviteModalOpen(false);
              setFriendsModalOpen(false);
              handleLogout();
            }}
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* ======= Основная часть ======= */}
      <section className="chat-main">
        <div className="chat-header-row">
          <div className="chat-header-left">
            {selectedUser && (
              <>
                <span className="chat-header-avatar">{selectedUser.avatar}</span>
                <span className="chat-title">{selectedUser.username}</span>
              </>
            )}
            {!selectedUser && (
              <span className="chat-title">Выберите пользователя</span>
            )}
          </div>
          {selectedUser && currentUser && (
            <div className="chat-header-right">
              <span className="chat-header-avatar">{currentUser.avatar}</span>
              <span className="chat-header-username">{currentUser.username}</span>
              <button
                type="button"
                className="chat-header-close"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLogout();
                }}
                title="Выйти"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="messages-area">
          {activeMessages.map((message, i) => {
            const isOwn = message.senderId === currentUser?.userId;
            return (
              <div
                key={`${message.timestamp}-${i}`}
                className={`message-wrapper ${isOwn ? 'own' : 'other'}`}
              >
                <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
                  <div style={{ wordWrap: 'break-word', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    {message.content}
                  </div>
                  <small className="message-time">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </small>
                </div>
              </div>
            );
          })}
          {systemMessage && (
            <div className="system-message">
              {systemMessage}
            </div>
          )}
        </div>

        {selectedUser && (() => {
          const isBlockedByMe = blockedUsers.includes(selectedUser.userId);
          const isBlockedByThem = blockedByUsers.includes(selectedUser.userId);
          
          if (isBlockedByMe) {
            return (
              <div className="message-form-blocked">
                <input
                  disabled
                  value=""
                  placeholder="Вы заблокировали пользователя"
                  className="message-input-disabled"
                />
                <button type="button" disabled>Отправить</button>
              </div>
            );
          }
          
          if (isBlockedByThem) {
            return (
              <div className="message-form-blocked">
                <input
                  disabled
                  value=""
                  placeholder="Вы заблокированы"
                  className="message-input-disabled"
                />
                <button type="button" disabled>Отправить</button>
              </div>
            );
          }
          
          return (
            <form
              className="message-form"
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
            >
              <input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Введите сообщение..."
              />
              <button type="submit">Отправить</button>
            </form>
          );
        })()}
      </section>

      {/* ======= Модальное окно друзей ======= */}
      {isFriendsModalOpen && (
        <div
          className="modal-overlay-base"
          onClick={() => setFriendsModalOpen(false)}
        >
          <div
            className="modal-content-base modal-friends"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>👥 Список друзей</h3>

            <div className="modal-section">
              <h4>Мои друзья</h4>
              {acceptedFriends.length === 0 ? (
                <p className="modal-section-empty">Пока нет добавленных друзей.</p>
              ) : (
                <ul className="modal-list">
                  {acceptedFriends.map((friend) => (
                    <li
                      key={friend.friend_id}
                      className="modal-list-item friend"
                    >
                      <span>
                        {friend.avatar || '👤'} <strong>{friend.friend_name}</strong>
                      </span>
                      <button onClick={() => removeFriend(friend.friend_id)}>Удалить</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="modal-section">
              <h4>Входящие заявки</h4>
              {pendingIncoming.length === 0 ? (
                <p className="modal-section-empty">Новых заявок нет.</p>
              ) : (
                <ul className="modal-list">
                  {pendingIncoming.map((request) => (
                    <li
                      key={`incoming-${request.friend_id}`}
                      className="modal-list-item incoming"
                    >
                      <span>
                        {request.avatar || '👤'} <strong>{request.friend_name}</strong>
                      </span>
                      <span className="modal-actions-group">
                        <button onClick={() => acceptFriend(request.friend_id)}>Принять</button>
                        <button onClick={() => declineFriendRequest(request.friend_id)}>Отклонить</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="modal-section">
              <h4>Исходящие заявки</h4>
              {pendingOutgoing.length === 0 ? (
                <p className="modal-section-empty">Вы не отправляли заявки.</p>
              ) : (
                <ul className="modal-list">
                  {pendingOutgoing.map((request) => (
                    <li
                      key={`outgoing-${request.friend_id}`}
                      className="modal-list-item outgoing"
                    >
                      <span>
                        {request.avatar || '👤'} <strong>{request.friend_name}</strong>
                      </span>
                      <button onClick={() => cancelFriendRequest(request.friend_id)}>Отменить</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={() => setFriendsModalOpen(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {/* ======= Модальное окно приглашений ======= */}
      {isInviteModalOpen && (
        <div
          className="modal-overlay-base"
          onClick={() => setInviteModalOpen(false)}
        >
          <div
            className="modal-content-base modal-invites"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Игровые приглашения</h3>

            <h4>Входящие</h4>
            <ul className="modal-list">
              {incomingInvites.map((invite) => (
                <li
                  key={invite.userId}
                  className="modal-list-item invite"
                >
                  <span>{invite.username || invite.userId}</span>
                  <span className="modal-actions-group">
                    <button
                      onClick={async () => {
                        if (socket && currentUser) {
                          socket.emit('game_invite_response', {
                            inviterId: invite.userId,
                            inviteeId: currentUser.userId,
                            accepted: true,
                          });
                        }
                        await safeFetch(`${API_BASE}/api/invite/response`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            inviterId: invite.userId,
                            inviteeId: currentUser?.userId,
                            accepted: true,
                          }),
                        });
                        setIncomingInvites((prev) =>
                          prev.filter((i) => i.userId !== invite.userId)
                        );
                        window.location.href = `/game?with=${invite.userId}`;
                      }}
                    >
                      ✅
                    </button>
                    <button
                      onClick={async () => {
                        if (socket && currentUser) {
                          socket.emit('game_invite_response', {
                            inviterId: invite.userId,
                            inviteeId: currentUser.userId,
                            accepted: false,
                          });
                        }
                        await safeFetch(`${API_BASE}/api/invite/response`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            inviterId: invite.userId,
                            inviteeId: currentUser?.userId,
                            accepted: false,
                          }),
                        });
                        setIncomingInvites((prev) =>
                          prev.filter((i) => i.userId !== invite.userId)
                        );
                      }}
                    >
                      ❌
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            <h4>Исходящие</h4>
            <ul className="modal-list">
              {outgoingInvites.map((invite) => (
                <li
                  key={invite.userId}
                  className="modal-list-item invite"
                >
                  <span>{invite.username || invite.userId}</span>
                  <button onClick={() => cancelGameInvite(invite.userId)}>
                    Отменить
                  </button>
                </li>
              ))}
            </ul>

            <button onClick={() => setInviteModalOpen(false)}>Закрыть</button>
          </div>
        </div>
      )}

      {/* ======= Модальное окно профиля ======= */}
      {showProfile && (
        <div
          className="modal-overlay-base"
          style={{ zIndex: 30 }}
          onClick={() => setShowProfile && setShowProfile(false)}
        >
          <div
            className="modal-content-base modal-profile"
            onClick={(e) => e.stopPropagation()}
          >
      <h3>👤 Профиль пользователя</h3>
      {currentUser ? (
        <>
          <p>
            <strong>Имя:</strong> {currentUser.username}
          </p>
          <p>
            <strong>ID:</strong> {currentUser.userId}
          </p>
          <p>
            <strong>Аватар:</strong> {currentUser.avatar || '👤'}
          </p>
        </>
      ) : (
        <p>Нет данных о пользователе</p>
      )}
      <button onClick={() => setShowProfile && setShowProfile(false)}>Закрыть</button>
    </div>
  </div>
)}

      {/* ======= Модальное окно чёрного списка ======= */}
      {showBlacklist && (
        <div
          className="modal-overlay-base"
          style={{ zIndex: 30 }}
          onClick={() => setShowBlacklist && setShowBlacklist(false)}
        >
          <div
            className="modal-content-base modal-blacklist"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>🚫 Чёрный список</h3>
            {blockedUsers.length === 0 ? (
              <p className="modal-section-empty">Пока нет заблокированных пользователей.</p>
            ) : (
              <ul className="modal-list">
                {blockedUsers.map((blockedId) => {
                  const blockedUser = allUsers.find((u) => u.userId === blockedId);
                  return (
                    <li
                      key={blockedId}
                      className="modal-list-item"
                    >
                      <span>
                        {blockedUser?.avatar || '👤'} <strong>{blockedUser?.username || blockedId}</strong>
                      </span>
                      <button onClick={() => unblockUser(blockedId)}>Разблокировать</button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="modal-footer">
              <button onClick={() => setShowBlacklist && setShowBlacklist(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {/* ======= Модальное окно истории матчей ======= */}
      {showMatchHistory && (
        <div
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.35)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 30,
    }}
    onClick={() => setShowMatchHistory && setShowMatchHistory(false)}
  >
    <div
      style={{
        background: '#fff',
        padding: 24,
        borderRadius: 12,
        width: 500,
        maxHeight: '80vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3>🏆 История матчей</h3>
      <p>Раздел в разработке — здесь будет список сыгранных матчей.</p>
      <button onClick={() => setShowMatchHistory && setShowMatchHistory(false)}>Закрыть</button>
    </div>
  </div>
)}

      {/* ======= Модальное окно турнирных матчей ======= */}
      {showTournamentMatches && (
        <div
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.35)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 30,
    }}
    onClick={() => setShowTournamentMatches && setShowTournamentMatches(false)}
  >
    <div
      style={{
        background: '#fff',
        padding: 24,
        borderRadius: 12,
        width: 500,
        maxHeight: '80vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3>🥇 Турнирные матчи</h3>
      <p>Раздел в разработке — здесь будут отображаться турнирные таблицы и результаты.</p>
      <button onClick={() => setShowTournamentMatches && setShowTournamentMatches(false)}>Закрыть</button>
    </div>
  </div>
)}
      </div>
    </div>
  );
};


export default Front;
