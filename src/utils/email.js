const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;

// Only create transporter if SMTP is configured
const getTransporter = () => {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
};

const sendEmail = async (options) => {
  const t = getTransporter();
  if (!t) {
    logger.warn('Email not sent - SMTP not configured. To:', options.to, 'Subject:', options.subject);
    return null;
  }

  try {
    const mailOptions = {
      from: `TutorBazaar <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    };

    const info = await t.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Email sending failed:', error);
    throw error;
  }
};

// Email templates
const emailTemplates = {
  welcomeTutor: (name) => ({
    subject: 'Welcome to TutorBazaar - Start Getting Students!',
    html: `
      <h1>Welcome ${name}!</h1>
      <p>Thank you for joining TutorBazaar. Your profile is under review and will be approved within 24 hours.</p>
      <p>Once approved, you can purchase credits to unlock student leads and start growing your tutoring business.</p>
      <p>Best regards,<br>TutorBazaar Team</p>
    `,
  }),

  leadUnlocked: (tutorName, leadId, studentName) => ({
    subject: `New Lead Unlocked - ${studentName}`,
    html: `
      <h1>Hello ${tutorName},</h1>
      <p>You have successfully unlocked a new lead!</p>
      <p><strong>Lead ID:</strong> ${leadId}</p>
      <p><strong>Student:</strong> ${studentName}</p>
      <p>Contact the student quickly to increase your chances of conversion.</p>
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/tutor/leads" style="padding:10px 20px;background:#4F46E5;color:white;text-decoration:none;border-radius:5px;">View Lead</a>
    `,
  }),

  lowCredits: (tutorName, balance) => ({
    subject: 'Low Credit Balance Alert',
    html: `
      <h1>Hello ${tutorName},</h1>
      <p>Your credit balance is running low (${balance} credits remaining).</p>
      <p>Purchase more credits to continue unlocking leads.</p>
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/tutor/credits" style="padding:10px 20px;background:#4F46E5;color:white;text-decoration:none;border-radius:5px;">Buy Credits</a>
    `,
  }),

  paymentSuccess: (name, amount, credits) => ({
    subject: 'Payment Successful - Credits Added',
    html: `
      <h1>Payment Successful!</h1>
      <p>Hello ${name},</p>
      <p>Your payment of ₹${amount} was successful. <strong>${credits} credits</strong> have been added to your account.</p>
    `,
  }),

  passwordReset: (name, resetUrl) => ({
    subject: 'Password Reset Request',
    html: `
      <h1>Password Reset</h1>
      <p>Hello ${name},</p>
      <p>Click the link below to reset your password (expires in 1 hour):</p>
      <a href="${resetUrl}" style="padding:10px 20px;background:#4F46E5;color:white;text-decoration:none;border-radius:5px;">Reset Password</a>
      <p>If you didn't request this, please ignore this email.</p>
    `,
  }),

  tutorApproved: (name) => ({
    subject: 'Your TutorBazaar Profile is Approved!',
    html: `
      <h1>Congratulations ${name}!</h1>
      <p>Your tutor profile has been approved. You can now purchase credits and start unlocking student leads.</p>
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/tutor/dashboard" style="padding:10px 20px;background:#4F46E5;color:white;text-decoration:none;border-radius:5px;">Go to Dashboard</a>
    `,
  }),
};

module.exports = { sendEmail, emailTemplates };
