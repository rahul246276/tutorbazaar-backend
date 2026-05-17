const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  getNotifications,
  getNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
} = require('../controllers/notificationController');

// Get all notifications for logged-in user
router.get('/', auth, getNotifications);

// Get unread count
router.get('/count/unread', auth, getUnreadCount);

// Get single notification
router.get('/:id', auth, getNotification);

// Mark single notification as read
router.put('/:id/read', auth, markAsRead);

// Mark all notifications as read
router.put('/read-all', auth, markAllAsRead);

// Delete a notification
router.delete('/:id', auth, deleteNotification);

module.exports = router;
