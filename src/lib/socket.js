import { Server } from "socket.io";

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.join("logs");
    socket.emit("socket:ready", { ok: true, rooms: ["logs"] });

    socket.on("logs:subscribe", () => {
      socket.join("logs");
    });

    socket.on("section:subscribe", (section) => {
      const key = String(section || "")
        .trim()
        .toLowerCase();
      if (key) socket.join(`section:${key}`);
    });

    socket.on("student:subscribe", (payload) => {
      const email = String(payload?.email || "")
        .toLowerCase()
        .trim();
      const userId = String(payload?.userId || "").trim();
      if (email) socket.join(`student:${email}`);
      if (userId) socket.join(`student:${userId}`);
    });
  });

  return io;
}

export function getIO() {
  return io;
}

export function emitActivityLog(log) {
  if (!io || !log) return;
  io.to("logs").emit("activity:log", log);
  io.emit("activity:log", log);
}

export function emitSectionUpdate(payload) {
  if (!io || !payload?.section) return;
  const section = String(payload.section).toLowerCase();
  io.to(`section:${section}`).emit("section:updated", payload);
  io.emit("section:updated", payload);
}
