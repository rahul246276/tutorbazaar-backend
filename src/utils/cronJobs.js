const cron = require('node-cron');
const Lead = require('../models/Lead');
const Tutor = require('../models/Tutor');
const TutorPlanSubscription = require('../models/TutorPlanSubscription');
const { expirePlans } = require('../services/planService');
const { sendToTutor } = require('../services/notificationService');

const notifyExpiringPlans = () =>
  cron.schedule('0 9 * * *', async () => {
    const subscriptions = await TutorPlanSubscription.find({
      status: 'active',
      warningNotificationSent: false,
      expiryDate: {
        $gte: new Date(),
        $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    }).populate('tutor', 'email');

    for (const subscription of subscriptions) {
      await sendToTutor(subscription.tutor._id, {
        type: 'plan_expiry',
        title: 'Plan expiring in 7 days',
        message: `Your ${subscription.planSnapshot.displayName || subscription.plan} plan expires in ${subscription.daysRemaining} days.`,
        channels: { inApp: true, email: Boolean(subscription.tutor.email), sms: false },
        emailTo: subscription.tutor.email,
      });
      subscription.warningNotificationSent = true;
      await subscription.save();
    }
  });

const expireSubscriptions = () =>
  cron.schedule('0 0 * * *', async () => {
    await expirePlans();
  });

const notifyStandardTutorsOnReleasedLeads = () =>
  cron.schedule('*/15 * * * *', async () => {
    const leads = await Lead.find({
      status: 'active',
      advanceReleaseAt: { $lte: new Date() },
    }).lean();

    for (const lead of leads) {
      const tutors = await Tutor.find({
        isApproved: true,
        isActive: true,
        city: new RegExp(`^${lead.requirements.city}$`, 'i'),
        'subscription.currentPlanName': { $in: ['silver', 'gold'] },
      }).select('email subjects');

      for (const tutor of tutors) {
        const alreadyNotified = (lead.matchedTutors || []).some((entry) => entry.tutor?.toString() === tutor._id.toString());
        const matchesSubject = tutor.subjects.some((subject) => lead.requirements.subjects.includes(subject.name));
        if (!alreadyNotified && matchesSubject) {
          await sendToTutor(tutor._id, {
            type: 'new_lead',
            title: 'New lead available',
            message: `${lead.requirements.subjects[0]} lead available in ${lead.requirements.city}`,
            data: { leadId: lead._id, subject: lead.requirements.subjects[0], city: lead.requirements.city },
            channels: { inApp: true, email: false, sms: false },
          });
          await Lead.updateOne(
            { _id: lead._id },
            {
              $push: {
                matchedTutors: {
                  tutor: tutor._id,
                  notifiedAt: new Date(),
                },
              },
            }
          );
        }
      }
    }
  });

const notifyLowEnquiries = () =>
  cron.schedule('0 10 * * *', async () => {
    const tutors = await Tutor.find({
      'subscription.status': 'active',
      'subscription.remainingEnquiries': { $lte: 5, $gte: 0 },
    }).select('firstName email subscription lastLowEnquiryAlertAt');

    for (const tutor of tutors) {
      const alreadyAlertedToday =
        tutor.lastLowEnquiryAlertAt &&
        tutor.lastLowEnquiryAlertAt.toDateString() === new Date().toDateString();
      if (alreadyAlertedToday) continue;

      await sendToTutor(tutor._id, {
        type: 'enquiry_low',
        title: 'Low enquiry balance',
        message: `Only ${tutor.subscription.remainingEnquiries} enquiries are left on your plan.`,
        channels: { inApp: true, email: Boolean(tutor.email), sms: false },
        emailTo: tutor.email,
      });
      tutor.lastLowEnquiryAlertAt = new Date();
      await tutor.save();
    }
  });

const initCronJobs = () => {
  notifyExpiringPlans();
  expireSubscriptions();
  notifyStandardTutorsOnReleasedLeads();
  notifyLowEnquiries();
};

module.exports = initCronJobs;
