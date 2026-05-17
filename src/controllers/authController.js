const { validationResult, body } = require('express-validator');
const User = require('../models/User');
const Tutor = require('../models/Tutor');
const Student = require('../models/Student');
const { generateToken, generateRefreshToken } = require('../utils/jwt');
const { sendEmail, emailTemplates } = require('../utils/email');
const logger = require('../utils/logger');
const { createLeadFromRegisteredStudent } = require('../services/leadService');

const authController = {
  // Validation rules
  validateRegister: [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['tutor', 'student']).withMessage('Role must be tutor or student'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
  ],

  validateLogin: [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],

  // Register
  register: async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { email, password, role, firstName, lastName, phone, ...additionalData } = req.body;

      // Check if user exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered',
        });
      }

      let user;

      if (role === 'tutor') {
        user = new Tutor({
          email,
          password,
          role,
          firstName,
          lastName,
          phone,
          city: additionalData.city,
          subjects: additionalData.subjects || [],
          teachingModes: additionalData.teachingModes || ['both'],
          bio: additionalData.bio,
          education: additionalData.education || [],
          experience: additionalData.experience || {},
        });
      } else {
        user = new Student({
          email,
          password,
          role,
          firstName,
          lastName,
          phone,
          city: additionalData.city,
          class: additionalData.class,
          board: additionalData.board,
        });
      }

      await user.save();

      let registrationLead = null;
      if (role === 'student') {
        const { lead } = await createLeadFromRegisteredStudent(user, {
          ...additionalData,
          subject: additionalData.subject,
          subjects: additionalData.subjects || (additionalData.subject ? [additionalData.subject] : []),
          source: 'student_registration',
          ipAddress: req.ip,
        }, req.io);
        registrationLead = lead;
      }

      // Generate tokens
      const token = generateToken({
        id: user._id,
        email: user.email,
        role: user.role,
      });

      const refreshToken = generateRefreshToken({
        id: user._id,
        email: user.email,
        role: user.role,
      });

      // Send welcome email
      try {
        if (role === 'tutor') {
          await sendEmail({
            to: user.email,
            ...emailTemplates.welcomeTutor(user.firstName),
          });
        }
      } catch (emailError) {
        logger.error('Welcome email failed:', emailError);
      }

      logger.info(`New user registered: ${email} (${role})`);

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
            firstName: user.firstName,
            lastName: user.lastName,
            isVerified: user.isVerified,
            ...(role === 'tutor' && {
              isApproved: user.isApproved,
              credits: { balance: user.remainingEnquiries || 0 },
              subscription: user.subscription,
            }),
            ...(role === 'student' && registrationLead && {
              enquiryLeadId: registrationLead.leadId,
            }),
          },
          ...(registrationLead && {
            lead: {
              id: registrationLead._id,
              leadId: registrationLead.leadId,
              status: registrationLead.status,
            },
          }),
          token,
          refreshToken,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Login
  login: async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { email, password } = req.body;

      // Find user
      const user = await User.findOne({ email }).select('+password');
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
        });
      }

      // Check password
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
        });
      }

      // Check if active
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated. Please contact support.',
        });
      }

      // Update last login
      await user.updateLastLogin();

      // Generate tokens
      const token = generateToken({
        id: user._id,
        email: user.email,
        role: user.role,
      });

      const refreshToken = generateRefreshToken({
        id: user._id,
        email: user.email,
        role: user.role,
      });

      // Get role-specific data
      let userData;
      if (user.role === 'tutor') {
        const tutor = await Tutor.findById(user._id);
        userData = {
          id: tutor._id,
          email: tutor.email,
          role: tutor.role,
          firstName: tutor.firstName,
          lastName: tutor.lastName,
          isVerified: tutor.isVerified,
          isApproved: tutor.isApproved,
          credits: { balance: tutor.remainingEnquiries || 0 },
          subscription: tutor.subscription,
          profileCompletion: tutor.profileCompletion,
        };
      } else if (user.role === 'student') {
        const student = await Student.findById(user._id);
        userData = {
          id: student._id,
          email: student.email,
          role: student.role,
          firstName: student.firstName,
          lastName: student.lastName,
          isVerified: student.isVerified,
        };
      } else {
        userData = {
          id: user._id,
          email: user.email,
          role: user.role,
        };
      }

      logger.info(`User logged in: ${email}`);

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: userData,
          token,
          refreshToken,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Refresh token
  refresh: async (req, res, next) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token required',
        });
      }

      const decoded = require('../utils/jwt').verifyRefreshToken(refreshToken);

      const user = await User.findById(decoded.id);
      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token',
        });
      }

      const newToken = generateToken({
        id: user._id,
        email: user.email,
        role: user.role,
      });

      res.json({
        success: true,
        data: {
          token: newToken,
        },
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Refresh token expired',
        });
      }
      next(error);
    }
  },

  // Get current user
  me: async (req, res, next) => {
    try {
      let user;
      if (req.userRole === 'tutor') {
        user = await Tutor.findById(req.userId);
      } else if (req.userRole === 'student') {
        user = await Student.findById(req.userId);
      } else {
        user = await User.findById(req.userId);
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  },

  // Forgot password
  forgotPassword: async (req, res, next) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        // Don't reveal if email exists
        return res.json({
          success: true,
          message: 'If an account exists, a reset link has been sent',
        });
      }

      // Generate reset token (valid for 1 hour)
      const resetToken = generateToken({
        id: user._id,
        type: 'password_reset',
      });

      const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

      // Send email
      const name = user.firstName || user.email;
      await sendEmail({
        to: user.email,
        ...emailTemplates.passwordReset(name, resetUrl),
      });

      res.json({
        success: true,
        message: 'If an account exists, a reset link has been sent',
      });
    } catch (error) {
      next(error);
    }
  },

  // Reset password
  resetPassword: async (req, res, next) => {
    try {
      const { token, newPassword } = req.body;

      const decoded = require('../utils/jwt').verifyToken(token);

      if (decoded.type !== 'password_reset') {
        return res.status(400).json({
          success: false,
          message: 'Invalid reset token',
        });
      }

      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reset token',
        });
      }

      user.password = newPassword;
      await user.save();

      logger.info(`Password reset for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Password reset successful',
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(400).json({
          success: false,
          message: 'Reset token expired',
        });
      }
      next(error);
    }
  },
};

module.exports = authController;
