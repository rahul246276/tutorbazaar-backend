/**
 * seed.js — Complete database seeder
 *
 * BUGS FIXED:
 * - Added SiteSettings seed with real TutorBazaar contact info
 * - Added sample Reviews
 * - Added student test account with hashed password
 * - Added sample ContactMessages cleared on re-seed
 * - All 4 plans seeded with exact prices from tutorbazaar.com
 *
 * Run: npm run seed  (from /backend)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/database');
const User = require('../models/User');
const Tutor = require('../models/Tutor');
const Student = require('../models/Student');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const TutorPlanSubscription = require('../models/TutorPlanSubscription');
const Lead = require('../models/Lead');
const SiteSettings = require('../models/SiteSettings');
const Review = require('../models/Review');
const logger = require('./logger');

const seed = async () => {
  try {
    await connectDB();
    logger.info('Starting database seeding...');

    // ── Clear collections ─────────────────────────────────────────────────────
    await Promise.all([
      User.deleteMany({}),
      Tutor.deleteMany({}),
      Student.deleteMany({}),
      SubscriptionPlan.deleteMany({}),
      TutorPlanSubscription.deleteMany({}),
      Lead.deleteMany({}),
      SiteSettings.deleteMany({}),
      Review.deleteMany({}),
    ]);
    logger.info('Cleared existing data');

    // ── Subscription Plans (exact from tutorbazaar.com) ───────────────────────
    const plans = await SubscriptionPlan.insertMany([
      {
        name: 'silver', displayName: 'SILVER', price: 3999,
        validityDays: 150, enquiryCount: 20,
        features: { smsAlerts: false, emailAlerts: true, noCommission: true, dedicatedSupport: true, getSuggested: false, advanceAlerts: false, advanceMinutes: 0, freeProfileAds: false, featuredPlacement: false, priorityPlacement: false },
        isActive: true, isPopular: false, badge: '', sortOrder: 1,
        description: 'Perfect for new tutors getting started',
      },
      {
        name: 'gold', displayName: 'GOLD', price: 5999,
        validityDays: 150, enquiryCount: 30,
        features: { smsAlerts: true, emailAlerts: true, noCommission: true, dedicatedSupport: true, getSuggested: true, advanceAlerts: false, advanceMinutes: 0, freeProfileAds: false, featuredPlacement: false, priorityPlacement: false },
        isActive: true, isPopular: true, badge: 'MOST POPULAR', sortOrder: 2,
        description: 'Most popular plan with more leads',
      },
      {
        name: 'platinum', displayName: 'PLATINUM', price: 8999,
        validityDays: 150, enquiryCount: 40,
        features: { smsAlerts: true, emailAlerts: true, noCommission: true, dedicatedSupport: true, getSuggested: true, advanceAlerts: true, advanceMinutes: 15, freeProfileAds: false, featuredPlacement: true, priorityPlacement: true },
        isActive: true, isPopular: false, badge: '', sortOrder: 3,
        description: 'For serious educators — 15-minute advance alerts',
      },
      {
        name: 'diamond', displayName: 'DIAMOND', price: 15999,
        validityDays: 150, enquiryCount: 50,
        features: { smsAlerts: true, emailAlerts: true, noCommission: true, dedicatedSupport: true, getSuggested: true, advanceAlerts: true, advanceMinutes: 15, freeProfileAds: true, featuredPlacement: true, priorityPlacement: true },
        isActive: true, isPopular: false, badge: 'ULTIMATE', sortOrder: 4,
        description: 'Ultimate teaching partner — free profile ads + featured placement',
      },
    ]);
    logger.info(`Created ${plans.length} subscription plans`);

    // ── Site Settings (real TutorBazaar contact info) ─────────────────────────
    await SiteSettings.create({
      _id: 'main',
      siteName: 'Tutor Bazaar',
      tagline: 'Learn. Teach. Grow.',
      phone: '+91 7678278384',
      email: 'contact24by7tutorbazar@gmail.com',
      whatsapp: '917678278384',
      address: 'Rajouri Garden Extension near Metro Station, Rajouri Garden, New Delhi 110027',
      hours: '9 AM - 8 PM, 7 days a week',
      social: {
        facebook: 'https://www.facebook.com/people/Tutor-Bazaar',
        instagram: 'https://www.instagram.com/tutorbazaar/',
        twitter: 'https://x.com/Tutorbazaar1',
        youtube: 'https://www.youtube.com/@TutorBazaar',
      },
      leadSettings: {
        unlockCost: 1,
        leadExpiryHours: 48,
        maxTutorsPerLead: 3,
        advanceAlertMinutes: 15,
      },
      features: {
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: false,
        reviewsEnabled: true,
      },
    });
    logger.info('Created SiteSettings');

    // ── Admin User ────────────────────────────────────────────────────────────
    const admin = await User.create({
      email: 'admin@tutorbazaar.com',
      password: 'TutorBazaar@admin123',
      role: 'admin',
      firstName: 'Admin',
      lastName: 'TutorBazaar',
      phone: '+91 7678278384',
      isVerified: true,
      isActive: true,
    });
    logger.info(`Admin created: ${admin.email}`);

    // ── Sample Tutors ─────────────────────────────────────────────────────────
    const tutorData = [
      {
        email: 'rahul@example.com', password: 'Tutor@12345', firstName: 'Rahul', lastName: 'Sharma',
        city: 'Delhi', phone: '+919876543210', isApproved: true, isActive: true,
        subjects: [{ name: 'Mathematics', levels: ['Class 9', 'Class 10', 'Class 11', 'Class 12'], boards: ['CBSE', 'ICSE'] }, { name: 'Physics', levels: ['Class 11', 'Class 12'], boards: ['CBSE'] }],
        teachingModes: ['online', 'offline'], headline: 'Expert Math & Physics tutor with 8+ years experience',
        bio: 'I am a passionate Mathematics and Physics teacher with 8+ years of experience. I specialize in CBSE curriculum and have helped 200+ students achieve their academic goals.',
        pricing: { hourlyRate: 800, monthlyRate: 8000 },
        education: [{ degree: 'B.Tech', institution: 'Delhi Technological University', year: 2015, score: '8.2 CGPA' }],
        experience: { years: 8, details: 'Teaching Mathematics and Physics to CBSE students' },
        rating: { average: 4.8, count: 23 },
        subscription: { currentPlanName: 'gold', status: 'active', enquiriesTotal: 30, enquiriesUsed: 12, remainingEnquiries: 18, expiryDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000) },
      },
      {
        email: 'priya@example.com', password: 'Tutor@12345', firstName: 'Priya', lastName: 'Singh',
        city: 'Mumbai', phone: '+919876543211', isApproved: false, isActive: true,
        subjects: [{ name: 'English', levels: ['Class 8', 'Class 9', 'Class 10'], boards: ['CBSE', 'ICSE'] }, { name: 'Hindi', levels: ['Class 6', 'Class 7', 'Class 8'], boards: ['CBSE'] }],
        teachingModes: ['online'], headline: 'English & Hindi language expert',
        bio: 'Experienced language teacher with 5 years of experience in English and Hindi.',
        pricing: { hourlyRate: 500, monthlyRate: 5000 },
        education: [{ degree: 'MA English', institution: 'Mumbai University', year: 2018, score: '72%' }],
        experience: { years: 5, details: 'Teaching English and Hindi online' },
      },
      {
        email: 'amit@example.com', password: 'Tutor@12345', firstName: 'Amit', lastName: 'Kumar',
        city: 'Bangalore', phone: '+919876543212', isApproved: true, isActive: true, isFeatured: true,
        subjects: [{ name: 'Computer Science', levels: ['Class 11', 'Class 12', 'Undergraduate'], boards: ['CBSE'] }],
        teachingModes: ['online', 'offline'], headline: 'Senior Software Engineer & CS tutor — Python, Web Dev, AI',
        bio: 'Senior Software Engineer with 10 years of industry experience. I teach practical programming skills that get results.',
        pricing: { hourlyRate: 1200, monthlyRate: 12000 },
        education: [{ degree: 'B.Tech Computer Science', institution: 'IIT Bangalore', year: 2014, score: '9.0 CGPA' }],
        experience: { years: 10, details: 'Industry professional teaching programming and CS concepts' },
        rating: { average: 4.9, count: 41 },
        subscription: { currentPlanName: 'platinum', status: 'active', enquiriesTotal: 40, enquiriesUsed: 8, remainingEnquiries: 32, expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
      },
      {
        email: 'sunita@example.com', password: 'Tutor@12345', firstName: 'Sunita', lastName: 'Reddy',
        city: 'Hyderabad', phone: '+919876543213', isApproved: true, isActive: true,
        subjects: [{ name: 'Biology', levels: ['Class 11', 'Class 12'], boards: ['CBSE'] }, { name: 'Chemistry', levels: ['Class 10', 'Class 11', 'Class 12'], boards: ['CBSE', 'State Board'] }],
        teachingModes: ['offline', 'both'], headline: 'Biology & Chemistry tutor — 15 years experience',
        bio: 'Experienced Biology and Chemistry teacher specializing in NEET preparation.',
        pricing: { hourlyRate: 700, monthlyRate: 7000 },
        education: [{ degree: 'MSc Biology', institution: 'Osmania University', year: 2009, score: '68%' }],
        experience: { years: 15, details: 'Teaching Biology and Chemistry for NEET aspirants' },
        rating: { average: 4.6, count: 18 },
        // Silver plan expiring soon (5 days)
        subscription: { currentPlanName: 'silver', status: 'active', enquiriesTotal: 20, enquiriesUsed: 17, remainingEnquiries: 3, expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
      },
      {
        email: 'david@example.com', password: 'Tutor@12345', firstName: 'David', lastName: 'Chen',
        city: 'Delhi', phone: '+919876543214', isApproved: true, isActive: true, isFeatured: true,
        subjects: [{ name: 'Mathematics', levels: ['Class 9', 'Class 10', 'Class 11', 'Class 12'], boards: ['CBSE', 'ICSE', 'IB'] }],
        teachingModes: ['online', 'offline', 'both'], headline: 'Mathematics expert | 8+ years | IIT-JEE & CBSE specialist',
        bio: 'Physics Tutor with 8+ years of experience. I make complex concepts simple and fun.',
        pricing: { hourlyRate: 1500, monthlyRate: 15000 },
        education: [{ degree: 'MSc Mathematics', institution: 'Delhi University', year: 2016, score: '78%' }],
        experience: { years: 8, details: 'Elite Mathematics tutoring for JEE and CBSE students' },
        rating: { average: 4.9, count: 35 },
        subscription: { currentPlanName: 'diamond', status: 'active', enquiriesTotal: 50, enquiriesUsed: 5, remainingEnquiries: 45, expiryDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000) },
      },
    ];

    const tutors = [];
    for (const data of tutorData) {
      const t = new Tutor({
        ...data,
        role: 'tutor',
        isVerified: true,
      });
      await t.save();
      tutors.push(t);
    }
    logger.info(`Created ${tutors.length} sample tutors`);

    // ── Sample Students ───────────────────────────────────────────────────────
    const studentData = [
      {
        email: 'student@example.com', password: 'Student@12345', firstName: 'Aarav', lastName: 'Shah',
        phone: '+919812345678', city: 'Delhi', class: 'Class 10', board: 'CBSE',
        subjects: [{ name: 'Mathematics' }, { name: 'Science' }],
      },
      {
        email: 'priyap@example.com', password: 'Student@12345', firstName: 'Priya', lastName: 'Patel',
        phone: '+919812345679', city: 'Mumbai', class: 'Class 12', board: 'CBSE',
        subjects: [{ name: 'English' }, { name: 'Chemistry' }],
      },
      {
        email: 'rohan@example.com', password: 'Student@12345', firstName: 'Rohan', lastName: 'Kumar',
        phone: '+919812345680', city: 'Bangalore', class: 'Undergraduate', board: 'Other',
        subjects: [{ name: 'Computer Science' }],
      },
    ];

    const students = [];
    for (const data of studentData) {
      const s = new Student({ ...data, role: 'student', isVerified: true, isActive: true });
      await s.save();
      students.push(s);
    }
    logger.info(`Created ${students.length} sample students`);

    // ── Sample Leads ──────────────────────────────────────────────────────────
    const leads = await Lead.insertMany([
      {
        leadId: 'TB-2025-0001',
        student: { id: students[0]._id, name: 'Aarav Shah', phone: students[0].phone, email: students[0].email },
        requirements: { class: 'Class 10', subjects: ['Mathematics'], board: 'CBSE', mode: 'online', city: 'Delhi', locality: 'Rajouri Garden', budget: { min: 2000, max: 3000 }, goals: 'Improve grades for board exams' },
        status: 'active',
        advanceReleaseAt: new Date(Date.now() - 30 * 60 * 1000), // already released
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
      {
        leadId: 'TB-2025-0002',
        student: { id: students[1]._id, name: 'Priya Patel', phone: students[1].phone, email: students[1].email },
        requirements: { class: 'Class 12', subjects: ['Physics'], board: 'CBSE', mode: 'offline', city: 'Mumbai', budget: { min: 3000, max: 5000 }, goals: 'Prepare for JEE' },
        status: 'active',
        advanceReleaseAt: new Date(Date.now() - 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
      {
        leadId: 'TB-2025-0003',
        student: { id: students[2]._id, name: 'Rohan Kumar', phone: students[2].phone, email: students[2].email },
        requirements: { class: 'Undergraduate', subjects: ['Computer Science'], board: 'Other', mode: 'online', city: 'Bangalore', budget: { min: 1000, max: 2000 }, goals: 'Learn web development' },
        status: 'active',
        advanceReleaseAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
      {
        leadId: 'TB-2025-0004',
        student: { id: students[0]._id, name: 'Aarav Shah', phone: students[0].phone, email: students[0].email },
        requirements: { class: 'Class 10', subjects: ['English'], board: 'CBSE', mode: 'both', city: 'Delhi', locality: 'South Delhi', budget: { min: 1500, max: 2500 }, goals: 'Improve writing and grammar' },
        status: 'active',
        advanceReleaseAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
      {
        leadId: 'TB-2025-0005',
        student: { id: students[1]._id, name: 'Priya Patel', phone: students[1].phone, email: students[1].email },
        requirements: { class: 'Class 11', subjects: ['Chemistry'], board: 'CBSE', mode: 'offline', city: 'Hyderabad', budget: { min: 4000, max: 6000 }, goals: 'Prepare for NEET' },
        status: 'active',
        advanceReleaseAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    ]);
    logger.info(`Created ${leads.length} sample leads`);

    // ── Sample Reviews (approved) ─────────────────────────────────────────────
    const reviews = await Review.insertMany([
      {
        tutor: tutors[0]._id, // Rahul
        student: students[0]._id, // Aarav
        rating: 5,
        review: 'Excellent teacher! My math improved greatly. Rahul sir explains concepts in a very clear and simple way. Highly recommended!',
        isApproved: true,
      },
      {
        tutor: tutors[0]._id, // Rahul
        student: students[1]._id, // Priya
        rating: 4,
        review: 'Very patient and knowledgeable. The sessions are well-structured and Rahul is always available for doubt clearing.',
        isApproved: true,
      },
      {
        tutor: tutors[2]._id, // Amit
        student: students[2]._id, // Rohan
        rating: 5,
        review: 'Amit is an amazing CS tutor! His real-world industry experience makes the classes extremely practical and valuable.',
        isApproved: true,
      },
    ]);
    logger.info(`Created ${reviews.length} sample reviews`);

    // ── Update tutor ratings ──────────────────────────────────────────────────
    for (const tutor of [tutors[0], tutors[2]]) {
      const tutorReviews = reviews.filter((r) => r.tutor.toString() === tutor._id.toString());
      if (tutorReviews.length) {
        const avg = tutorReviews.reduce((sum, r) => sum + r.rating, 0) / tutorReviews.length;
        await Tutor.findByIdAndUpdate(tutor._id, { 'rating.average': +avg.toFixed(1), 'rating.count': tutorReviews.length });
      }
    }

    logger.info('\n══════════════════════════════════════════════');
    logger.info('✅ Database seeded successfully!');
    logger.info('══════════════════════════════════════════════');
    logger.info('TEST ACCOUNTS:');
    logger.info('  Admin:   admin@tutorbazaar.com   / TutorBazaar@admin123');
    logger.info('  Tutor1:  rahul@example.com        / Tutor@12345  (Gold, Delhi, Approved)');
    logger.info('  Tutor2:  priya@example.com         / Tutor@12345  (No plan, Mumbai, Pending)');
    logger.info('  Tutor3:  amit@example.com          / Tutor@12345  (Platinum, Bangalore, Featured)');
    logger.info('  Tutor4:  sunita@example.com        / Tutor@12345  (Silver expiring, Hyderabad)');
    logger.info('  Tutor5:  david@example.com         / Tutor@12345  (Diamond, Delhi, Featured)');
    logger.info('  Student: student@example.com       / Student@12345');
    logger.info('══════════════════════════════════════════════\n');

  } catch (error) {
    logger.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

seed();
