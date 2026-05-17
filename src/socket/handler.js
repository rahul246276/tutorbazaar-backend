const logger = require('../utils/logger');

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    logger.info('Socket connected: %s', socket.id);

    socket.on('join_tutor_room', (tutorId) => {
      socket.join(`tutor_${tutorId}`);
    });

    socket.on('join_admin_room', () => {
      socket.join('admin_room');
    });

    socket.on('mark_notifications_read', ({ userId, role }) => {
      if (role === 'tutor') {
        io.to(`tutor_${userId}`).emit('notifications_marked_read', { userId });
      }
    });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected: %s', socket.id);
    });
  });

  global.io = io;
};

module.exports = socketHandler;
