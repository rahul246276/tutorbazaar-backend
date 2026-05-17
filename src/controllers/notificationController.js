const Notification = require('../models/Notification');

const ownedNotificationQuery = (req, id) => ({
  _id: id,
  recipient: req.user._id,
  recipientRole: req.user.role,
});

const getNotifications = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const query = {
      recipient: req.user._id,
      recipientRole: req.user.role,
    };

    if (req.query.type) query.type = req.query.type;
    if (req.query.unreadOnly === 'true') query.isRead = false;

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOne(ownedNotificationQuery(req, req.params.id));
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();
    }

    res.json({ success: true, data: { notification } });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      ownedNotificationQuery(req, req.params.id),
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({ success: true, data: { notification } });
  } catch (error) {
    next(error);
  }
};

const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      {
        recipient: req.user._id,
        recipientRole: req.user.role,
        isRead: false,
      },
      {
        isRead: true,
        readAt: new Date(),
      }
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
};

const deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete(ownedNotificationQuery(req, req.params.id));
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
};

const getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      recipientRole: req.user.role,
      isRead: false,
    });

    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  deleteNotification,
  getNotification,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
};
