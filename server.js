const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  maxHttpBufferSize: 1e7
});

// Worldwide active users: socketId -> { id, name, avatar, status, lastSeen, inChat }
let activeUsers = {};

io.on('connection', (socket) => {
  // 1. User registers to global network
  socket.on('register_user', (userData) => {
    activeUsers[socket.id] = {
      id: socket.id,
      name: userData.name || `User_${socket.id.substring(0, 4)}`,
      avatar: userData.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`,
      status: 'online',
      lastSeen: null,
      inChat: false
    };
    // Send updated user list to everyone online
    io.emit('online_strangers_list', Object.values(activeUsers));
  });

  // 2. Profile Sync (Name or Avatar change)
  socket.on('update_profile', (data) => {
    if (activeUsers[socket.id]) {
      activeUsers[socket.id].name = data.name;
      activeUsers[socket.id].avatar = data.avatar;
      io.emit('online_strangers_list', Object.values(activeUsers));
      io.emit('peer_profile_updated', {
        id: socket.id,
        name: data.name,
        avatar: data.avatar
      });
    }
  });

  // 3. Send 1-to-1 Chat Request
  socket.on('send_chat_request', ({ targetId }) => {
    const sender = activeUsers[socket.id];
    const target = activeUsers[targetId];

    if (!sender || !target) return;

    if (target.inChat) {
      socket.emit('request_failed', { reason: `${target.name} is currently in another chat!` });
      return;
    }

    // Deliver request strictly to that single target user
    io.to(targetId).emit('chat_request_received', {
      requesterId: socket.id,
      requesterName: sender.name,
      requesterAvatar: sender.avatar
    });
  });

  // 4. Accept Chat Request -> Creates Isolated Private Room
  socket.on('accept_request', ({ requesterId }) => {
    const userA = activeUsers[socket.id];
    const userB = activeUsers[requesterId];

    if (userA && userB) {
      userA.inChat = true;
      userB.inChat = true;

      // Unique private room strictly for these two users
      const roomId = `room_${[socket.id, requesterId].sort().join('_')}`;

      socket.join(roomId);
      const requesterSocket = io.sockets.sockets.get(requesterId);
      if (requesterSocket) requesterSocket.join(roomId);

      // Notify requester
      io.to(requesterId).emit('chat_started', {
        roomId,
        partner: userA
      });

      // Notify accepter
      socket.emit('chat_started', {
        roomId,
        partner: userB
      });

      io.emit('online_strangers_list', Object.values(activeUsers));
    }
  });

  // 5. Decline Chat Request
  socket.on('decline_request', ({ requesterId }) => {
    io.to(requesterId).emit('chat_request_rejected');
  });

  // 6. Strict 1-to-1 Private Messaging inside Room
  socket.on('send_private_message', ({ roomId, type, content }) => {
    const sender = activeUsers[socket.id];
    if (sender && roomId) {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Deliver ONLY to this specific room (No other user can see it)
      socket.to(roomId).emit('receive_private_message', {
        senderId: socket.id,
        type: type || 'text',
        content,
        timestamp: timeStr
      });
    }
  });

  // 7. Typing status inside Room
  socket.on('typing_status', ({ roomId, isTyping }) => {
    if (roomId) {
      socket.to(roomId).emit('peer_typing', { isTyping });
    }
  });

  // 8. End / Leave Chat Session
  socket.on('leave_chat', ({ roomId }) => {
    if (roomId) {
      socket.to(roomId).emit('chat_terminated', { message: 'Stranger left the conversation.' });
      socket.leave(roomId);
      if (activeUsers[socket.id]) activeUsers[socket.id].inChat = false;
      io.emit('online_strangers_list', Object.values(activeUsers));
    }
  });

  // 9. Disconnect & Last Seen
  socket.on('disconnect', () => {
    const user = activeUsers[socket.id];
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (user) {
      io.emit('user_went_offline', { id: socket.id, lastSeen: timeStr });
      delete activeUsers[socket.id];
      io.emit('online_strangers_list', Object.values(activeUsers));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Global 1-to-1 Stranger Server live at http://localhost:${PORT}`);
});

