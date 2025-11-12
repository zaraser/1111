// socketFrontend.ts
import { io, Socket } from "socket.io-client";
import type { User } from "./types";

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ?? "https://localhost:8443";

export function makeSocket() {
  return io(SOCKET_URL, {
    transports: ["websocket"],
    autoConnect: true,
  });
}

export function joinAs(socket: Socket, user: User) {
  socket.emit("user_join", user);
}
