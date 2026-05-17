const Lead = require('../models/Lead');
const Tutor = require('../models/Tutor');
const { logActivity } = require('../utils/activityLogger');
const { assignLeadToTutors } = require('./leadService');

/**
 * Smart lead matching service for admin distribution
 * Finds tutors that match a lead based on location, subjects, and other criteria
 */

const PLAN_SCORES = {
  silver: 5,
  gold: 10,
  platinum: 15,
  diamond: 20,
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findMatchingTutors = async (leadId, options = {}) => {
  try {
    const { limit = 20, planFilter, minScore = 0, scope = 'matching', search = '' } = options;
    
    // Fetch the lead
    const lead = await Lead.findById(leadId).lean();
    if (!lead) {
      throw new Error('Lead not found');
    }

    // Build tutor query
    const query = scope === 'all'
      ? { isActive: true }
      : {
          isApproved: true,
          isActive: true,
          'subscription.status': 'active',
          'subscription.remainingEnquiries': { $gt: 0 },
        };

    // City matching (case-insensitive)
    if (scope !== 'all' && lead.requirements?.city) {
      query.city = new RegExp(escapeRegex(lead.requirements.city), 'i');
    }

    // Subject matching
    if (scope !== 'all' && lead.requirements?.subjects && lead.requirements.subjects.length > 0) {
      query['subjects.name'] = { $in: lead.requirements.subjects };
    }

    // Plan filter
    if (planFilter && planFilter !== 'all') {
      query['subscription.currentPlanName'] = planFilter;
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { city: searchRegex },
        { 'subjects.name': searchRegex },
      ];
    }

    // Fetch matching tutors
    const tutors = await Tutor.find(query)
      .select('firstName lastName email phone city subjects subscription rating isFeatured metrics')
      .limit(scope === 'all' ? limit : limit * 2) // Get more to filter and score for smart matching
      .lean();

    // Score each tutor
    const scoredTutors = tutors.map(tutor => {
      let matchScore = 0;
      const matchReasons = [];

      // City match (+50)
      if (lead.requirements?.city && 
          tutor.city && 
          tutor.city.toLowerCase() === lead.requirements.city.toLowerCase()) {
        matchScore += 50;
        matchReasons.push('Same City');
      }

      // Subject matches (+30 per subject)
      const tutorSubjects = (tutor.subjects || []).map(s => 
        typeof s === 'object' ? s.name : s
      );
      const matchingSubjects = (lead.requirements?.subjects || []).filter(subject =>
        tutorSubjects.some(ts => ts.toLowerCase() === subject.toLowerCase())
      );
      if (matchingSubjects.length > 0) {
        matchScore += 30 * matchingSubjects.length;
        matchReasons.push(`${matchingSubjects.length} Subject Match${matchingSubjects.length > 1 ? 'es' : ''}`);
      }

      // Plan score
      const planName = tutor.subscription?.currentPlanName;
      if (planName && PLAN_SCORES[planName]) {
        matchScore += PLAN_SCORES[planName];
        matchReasons.push(`${planName.charAt(0).toUpperCase() + planName.slice(1)} Plan`);
      }

      // Featured bonus (+10)
      if (tutor.isFeatured) {
        matchScore += 10;
        matchReasons.push('Featured Profile');
      }

      // Rating bonus (+5)
      const avgRating = tutor.rating?.average || 0;
      if (avgRating >= 4.5) {
        matchScore += 5;
        matchReasons.push('High Rating (≥4.5)');
      }

      // Enquiries quota bonus (+5)
      const remainingEnquiries = tutor.subscription?.remainingEnquiries || 0;
      if (remainingEnquiries > 10) {
        matchScore += 5;
        matchReasons.push('Good Enquiry Balance');
      }

      // Check if already assigned
      const alreadyAssigned = lead.lockedBy?.some(locked => 
        locked.tutor && locked.tutor.toString() === tutor._id.toString()
      );

      return {
        tutor: {
          _id: tutor._id,
          firstName: tutor.firstName,
          lastName: tutor.lastName,
          email: tutor.email,
          phone: tutor.phone,
          city: tutor.city,
          subjects: tutor.subjects,
          planName: planName || 'No Plan',
          remainingEnquiries: remainingEnquiries,
          rating: tutor.rating,
          isFeatured: tutor.isFeatured,
        },
        matchScore,
        matchReasons,
        alreadyAssigned,
      };
    });

    // Filter by minimum score and already assigned status
    const filteredTutors = scoredTutors.filter(item =>
      scope === 'all' || item.matchScore >= minScore
    );

    // Sort by match score (highest first)
    filteredTutors.sort((a, b) => b.matchScore - a.matchScore);

    // Limit results
    const finalTutors = filteredTutors.slice(0, limit);

    return {
      lead: {
        _id: lead._id,
        requirements: lead.requirements,
        status: lead.status,
        lockedBy: lead.lockedBy || [],
      },
      tutors: finalTutors,
      stats: getLeadDistributionStats(lead, finalTutors, scope),
    };

  } catch (error) {
    console.error('Error in findMatchingTutors:', error);
    throw error;
  }
};

const getLeadDistributionStats = (lead, matchingTutors, scope = 'matching') => {
  const totalMatchingTutors = matchingTutors.length;
  const alreadyAssigned = matchingTutors.filter(t => t.alreadyAssigned).length;
  const availableForAssignment = totalMatchingTutors - alreadyAssigned;

  // City breakdown
  const cityBreakdown = {};
  matchingTutors.forEach(item => {
    const city = item.tutor.city || 'Unknown';
    cityBreakdown[city] = (cityBreakdown[city] || 0) + 1;
  });

  // Plan breakdown
  const planBreakdown = { silver: 0, gold: 0, platinum: 0, diamond: 0 };
  matchingTutors.forEach(item => {
    const plan = item.tutor.planName?.toLowerCase();
    if (planBreakdown.hasOwnProperty(plan)) {
      planBreakdown[plan]++;
    }
  });

  return {
    totalMatchingTutors,
    scope,
    alreadyAssigned,
    availableForAssignment,
    cityBreakdown: Object.entries(cityBreakdown).map(([city, count]) => ({ city, count })),
    planBreakdown,
  };
};

const distributeLeadToTutors = async (leadId, tutorIds, options = {}) => {
  try {
    const { message, bypassQuota = true, adminId } = options;
    const result = await assignLeadToTutors(leadId, tutorIds, {
      adminId,
      reason: message || 'Smart distributed by admin',
      message,
      notify: true,
    });

    await Promise.all(result.tutors.map((tutor) =>
      logActivity(
        adminId,
        'smart_distribute',
        'lead',
        result.lead._id,
        `Lead ${String(result.lead._id).slice(-8)}`,
        {
          tutorId: tutor.tutorId,
          tutorName: tutor.tutorName,
          bypassQuota,
        }
      )
    ));

    return result;

  } catch (error) {
    console.error('Error in distributeLeadToTutors:', error);
    throw error;
  }
};

const autoDistributeLead = async (leadId, options = {}) => {
  try {
    const { count = 3, planPriority = 'platinum_first', adminId } = options;
    
    // Find matching tutors
    const { tutors } = await findMatchingTutors(leadId, { limit: 50 });
    
    // Filter out already assigned tutors
    const availableTutors = tutors.filter(t => !t.alreadyAssigned);
    
    // Sort by plan priority
    const planOrder = {
      platinum_first: ['diamond', 'platinum', 'gold', 'silver'],
      gold_first: ['diamond', 'gold', 'platinum', 'silver'],
      any: ['diamond', 'platinum', 'gold', 'silver'],
    };

    const priorityOrder = planOrder[planPriority] || planOrder.any;
    
    // Sort by plan priority and match score
    availableTutors.sort((a, b) => {
      const aPlanIndex = priorityOrder.indexOf(a.tutor.planName?.toLowerCase());
      const bPlanIndex = priorityOrder.indexOf(b.tutor.planName?.toLowerCase());
      
      if (aPlanIndex !== bPlanIndex) {
        return aPlanIndex - bPlanIndex;
      }
      
      return b.matchScore - a.matchScore;
    });

    // Select top tutors
    const selectedTutors = availableTutors.slice(0, count);
    const tutorIds = selectedTutors.map(t => t.tutor._id);

    // Distribute to selected tutors
    const result = await distributeLeadToTutors(leadId, tutorIds, {
      bypassQuota: true,
      adminId,
      message: 'Auto-distributed based on matching algorithm',
    });

    return {
      ...result,
      tutors: result.tutors.map((assignedTutor) => {
        const match = selectedTutors.find((item) => item.tutor._id.toString() === assignedTutor.tutorId.toString());
        return {
          ...assignedTutor,
          plan: assignedTutor.planName,
          city: match?.tutor.city || '',
          matchScore: match?.matchScore || 0,
        };
      }),
    };

  } catch (error) {
    console.error('Error in autoDistributeLead:', error);
    throw error;
  }
};

const getPendingDistributionLeads = async (options = {}) => {
  try {
    const { city, subject, hours = 24, page = 1, limit = 20 } = options;
    
    // Build query for leads that need distribution
    const query = {
      status: 'active',
      $or: [
        { lockedBy: { $size: 0 } }, // No tutors assigned
        { lockedBy: { $exists: false } }, // No lockedBy array
      ],
    };

    // Time filter
    if (hours > 0) {
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      query.createdAt = { $gte: cutoffTime };
    }

    // City filter
    if (city) {
      query['requirements.city'] = new RegExp(escapeRegex(city), 'i');
    }

    // Subject filter
    if (subject) {
      query['requirements.subjects'] = subject;
    }

    // Get leads
    const leads = await Lead.find(query)
      .select('requirements status createdAt lockedBy')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // For each lead, get matching tutor count
    const leadsWithStats = await Promise.all(
      leads.map(async (lead) => {
        try {
          const { stats } = await findMatchingTutors(lead._id, { limit: 1 });
          return {
            ...lead,
            matchingTutorCount: stats.totalMatchingTutors,
            availableForAssignment: stats.availableForAssignment,
          };
        } catch (error) {
          return {
            ...lead,
            matchingTutorCount: 0,
            availableForAssignment: 0,
          };
        }
      })
    );

    const total = await Lead.countDocuments(query);

    return {
      leads: leadsWithStats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };

  } catch (error) {
    console.error('Error in getPendingDistributionLeads:', error);
    throw error;
  }
};

const bulkDistributeLeads = async (leadIds, options = {}) => {
  try {
    const { strategy = 'best_match', maxPerLead = 3, adminId } = options;
    
    const results = {
      total: leadIds.length,
      distributed: 0,
      failed: 0,
      errors: [],
    };

    for (const leadId of leadIds) {
      try {
        let result;
        
        if (strategy === 'best_match') {
          result = await autoDistributeLead(leadId, {
            count: maxPerLead,
            planPriority: 'platinum_first',
            adminId,
          });
        } else if (strategy === 'plan_order') {
          result = await autoDistributeLead(leadId, {
            count: maxPerLead,
            planPriority: 'any',
            adminId,
          });
        }

        if (result && result.distributed > 0) {
          results.distributed++;
        } else {
          results.failed++;
          results.errors.push(`Lead ${leadId}: No suitable tutors found`);
        }
        
      } catch (error) {
        results.failed++;
        results.errors.push(`Lead ${leadId}: ${error.message}`);
      }
    }

    return results;

  } catch (error) {
    console.error('Error in bulkDistributeLeads:', error);
    throw error;
  }
};

module.exports = {
  findMatchingTutors,
  getLeadDistributionStats,
  distributeLeadToTutors,
  autoDistributeLead,
  getPendingDistributionLeads,
  bulkDistributeLeads,
};
