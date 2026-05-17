const Notification = require('../models/Notification');
const NotificationLog = require('../models/NotificationLog');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

const emitNotification = (recipientId, payload) => {
  if (!global.io) return;
  global.io.to(`tutor_${recipientId}`).emit('notification', payload);
};

const sendToTutor = async (
  tutorId,
  {
    type = 'system',
    title,
    message,
    data = {},
    actionUrl = '',
    channels = { inApp: true, email: false, sms: false },
    emailTo = '',
    emailHtml = '',
    sentBy = null,
  }
) => {
  // Replace template variables in message
  const processedMessage = message.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // For now, just return the original message (template variables will be handled later)
    return match;
  });

  const notification = await Notification.create({
    recipient: tutorId,
    recipientRole: 'tutor',
    type,
    title,
    message: processedMessage,
    data,
    actionUrl,
    channels,
    sentBy,
  });

  if (channels.inApp) {
    emitNotification(tutorId, {
      id: notification._id,
      type,
      title,
      message: processedMessage,
      data,
      actionUrl,
      createdAt: notification.createdAt,
    });
  }

  if (channels.email && emailTo) {
    sendEmail({
      to: emailTo,
      subject: title,
      html: emailHtml || `<p>${message}</p>`,
      text: message,
    }).catch((error) => {
      logger.warn('Notification email failed: %s', error.message);
    });
  }

  return notification;
};

const sendBulk = async (
  tutorRecipients,
  {
    type = 'custom',
    title,
    message,
    channels = { inApp: true, email: false, sms: false },
    sentBy = null,
    target = 'custom',
  }
) => {
  const docs = tutorRecipients.map((recipient) => ({
    recipient: recipient._id,
    recipientRole: 'tutor',
    type,
    title,
    message,
    channels,
    sentBy,
  }));

  if (docs.length) {
    await Notification.insertMany(docs);
  }

  if (channels.inApp) {
    tutorRecipients.forEach((recipient) => {
      emitNotification(recipient._id, {
        type,
        title,
        message,
        createdAt: new Date(),
      });
    });
  }

  let failedRecipients = [];
  if (channels.email) {
    const emailableRecipients = tutorRecipients.filter((recipient) => recipient.email);
    const results = await Promise.allSettled(
      emailableRecipients.map((recipient) =>
        sendEmail({
          to: recipient.email,
          subject: title,
          html: `<p>${message}</p>`,
          text: message,
        })
      )
    );

    failedRecipients = results
      .map((result, index) => ({ result, recipient: emailableRecipients[index] }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, recipient }) => ({
        tutorId: recipient._id,
        tutorEmail: recipient.email,
        reason: result.reason?.message || 'Unknown email failure',
      }));
  }

  const log = await NotificationLog.create({
    sentBy,
    target,
    title,
    message,
    channels,
    recipientCount: tutorRecipients.length,
    successCount: tutorRecipients.length - failedRecipients.length,
    failedCount: failedRecipients.length,
    failedRecipients,
  });

  return { sent: tutorRecipients.length, failed: failedRecipients.length, log };
};

module.exports = {
  sendToTutor,
  sendBulk,
};
