const SubscriptionPlan = require('../models/SubscriptionPlan');
const Tutor = require('../models/Tutor');
const TutorPlanSubscription = require('../models/TutorPlanSubscription');
const EnquiryTransaction = require('../models/EnquiryTransaction');
const { sendToTutor } = require('./notificationService');

const getActiveSubscription = async (tutorId, session = null) =>
  TutorPlanSubscription.findOne({
    tutor: tutorId,
    status: 'active',
    expiryDate: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .session(session);

const syncTutorSubscription = async (tutorId, subscription, session = null) => {
  const tutor = await Tutor.findById(tutorId).session(session);
  if (!tutor) {
    throw new Error('Tutor not found');
  }

  tutor.applySubscriptionSnapshot(subscription);
  await tutor.save({ session });
  return tutor;
};

const activatePlan = async (tutorId, planName, options = {}, session = null) => {
  const {
    payment = null,
    paymentMethod = 'razorpay',
    notes = '',
    durationDays,
    enquiryCount,
    activatedBy = 'razorpay',
  } = options;

  const plan = await SubscriptionPlan.findOne({ name: planName.toLowerCase(), isActive: true }).session(session);
  if (!plan) {
    throw new Error('Plan not found');
  }

  await TutorPlanSubscription.updateMany(
    { tutor: tutorId, status: 'active' },
    { status: 'expired' },
    { session }
  );

  const startDate = new Date();
  const expiryDate = new Date(startDate);
  expiryDate.setDate(expiryDate.getDate() + (durationDays || plan.validityDays));

  const subscriptionDocs = await TutorPlanSubscription.create(
    [
      {
        tutor: tutorId,
        plan: plan.name,
        planSnapshot: {
          displayName: plan.displayName,
          price: plan.price,
          validityDays: durationDays || plan.validityDays,
          enquiryCount: enquiryCount || plan.enquiryCount,
          features: plan.features,
        },
        status: 'active',
        startDate,
        expiryDate,
        totalEnquiries: enquiryCount || plan.enquiryCount,
        usedEnquiries: 0,
        payment: payment?._id || null,
        activatedBy,
        notes,
      },
    ],
    { session }
  );

  const subscription = subscriptionDocs[0];
  await syncTutorSubscription(tutorId, subscription, session);

  await EnquiryTransaction.create(
    [
      {
        tutor: tutorId,
        subscription: subscription._id,
        type: 'purchase',
        amount: subscription.totalEnquiries,
        balanceAfter: subscription.remainingEnquiries,
        description: `${plan.displayName} plan activated via ${paymentMethod}`,
        relatedPayment: payment?._id || undefined,
      },
    ],
    { session }
  );

  return {
    plan,
    subscription,
    expiryDate,
    enquiriesGranted: subscription.totalEnquiries,
  };
};

const addEnquiries = async (tutorId, count, reason = '', session = null) => {
  const subscription = await getActiveSubscription(tutorId, session);
  if (!subscription) {
    throw new Error('No active subscription');
  }

  subscription.extraEnquiries += count;
  await subscription.save({ session });
  await syncTutorSubscription(tutorId, subscription, session);

  await EnquiryTransaction.create(
    [
      {
        tutor: tutorId,
        subscription: subscription._id,
        type: 'bonus',
        amount: count,
        balanceAfter: subscription.remainingEnquiries,
        description: reason || 'Admin added enquiry credits',
      },
    ],
    { session }
  );

  return subscription;
};

const extendExpiry = async (tutorId, days, reason = '', session = null) => {
  const subscription = await getActiveSubscription(tutorId, session);
  if (!subscription) {
    throw new Error('No active subscription');
  }

  subscription.expiryDate = new Date(subscription.expiryDate.getTime() + days * 24 * 60 * 60 * 1000);
  subscription.notes = [subscription.notes, reason].filter(Boolean).join('\n');
  subscription.warningNotificationSent = false;
  await subscription.save({ session });
  await syncTutorSubscription(tutorId, subscription, session);

  return subscription;
};

const useEnquiry = async (tutorId, leadId, session = null) => {
  const subscription = await getActiveSubscription(tutorId, session);
  if (!subscription) {
    throw new Error('No active subscription');
  }

  if (subscription.remainingEnquiries <= 0) {
    throw new Error('No enquiries remaining');
  }

  subscription.usedEnquiries += 1;
  await subscription.save({ session });
  await syncTutorSubscription(tutorId, subscription, session);

  await EnquiryTransaction.create(
    [
      {
        tutor: tutorId,
        subscription: subscription._id,
        type: 'unlock',
        amount: 1,
        balanceAfter: subscription.remainingEnquiries,
        description: `Unlocked lead ${leadId}`,
        relatedLead: leadId,
      },
    ],
    { session }
  );

  return subscription;
};

const expirePlans = async () => {
  const expired = await TutorPlanSubscription.find({
    status: 'active',
    expiryDate: { $lte: new Date() },
  }).populate('tutor', 'email firstName');

  for (const subscription of expired) {
    subscription.status = 'expired';
    await subscription.save();
    await syncTutorSubscription(subscription.tutor._id, subscription);
    await sendToTutor(subscription.tutor._id, {
      type: 'plan_expiry',
      title: 'Plan expired',
      message: `Your ${subscription.planSnapshot.displayName || subscription.plan} plan has expired.`,
      channels: { inApp: true, email: Boolean(subscription.tutor.email), sms: false },
      emailTo: subscription.tutor.email,
    });
  }

  return expired.length;
};

module.exports = {
  activatePlan,
  addEnquiries,
  extendExpiry,
  expirePlans,
  getActiveSubscription,
  syncTutorSubscription,
  useEnquiry,
};
