export interface User {
  userId: string;
  username: string;
  avatar: string;
  online?: boolean;
}

export interface Message {
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: string;
}

export interface Friend {
  friend_id: string;
  friend_name: string;
  avatar: string;
  status: string;
}

export interface Invite {
  userId: string;
  username?: string;
  avatar?: string;
  timestamp?: number;
}
