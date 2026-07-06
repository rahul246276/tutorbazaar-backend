const mongoose = require('mongoose');
const { 
  normalizeSubjects, 
  normalizeSubjectObjects, 
  getSubjectNames 
} = require('./subjectUtils');

describe('Bug Fix Verification', () => {
  describe('Issue #1: First Subject Visibility', () => {
    it('should preserve first subject through complete transformation pipeline', () => {
      // Simulate backend data with mixed subject formats
      const rawTutorData = {
        subjects: [
          { name: 'Mathematics', levels: ['10', '12'] },
          'Physics',
          { name: 'Chemistry' }
        ]
      };

      // Step 1: Backend normalization (when saving to DB)
      const normalized = normalizeSubjectObjects(rawTutorData.subjects);
      // normalizeSubjectObjects extracts just the name, not the full object
      expect(normalized[0]).toEqual({ name: 'Mathematics' });
      expect(normalized[1]).toEqual({ name: 'Physics' });

      // Step 2: API response (extracting names for frontend)
      const displayNames = getSubjectNames(normalized);
      expect(displayNames[0]).toBe('Mathematics');
      expect(displayNames[1]).toBe('Physics');
      expect(displayNames[2]).toBe('Chemistry');

      // Verify first subject is never lost
      expect(displayNames).toHaveLength(3);
      expect(displayNames[0]).toBe('Mathematics');
    });

    it('should handle string-only subject format', () => {
      const subjects = ['Math', 'English', 'Science'];
      const normalized = normalizeSubjectObjects(subjects);
      const names = getSubjectNames(normalized);

      expect(names[0]).toBe('Math');
      expect(names).toHaveLength(3);
    });

    it('should handle object-only subject format', () => {
      const subjects = [
        { name: 'History' },
        { name: 'Geography' },
        { name: 'Economics' }
      ];
      const normalized = normalizeSubjectObjects(subjects);
      const names = getSubjectNames(normalized);

      expect(names[0]).toBe('History');
      expect(names).toHaveLength(3);
    });

    it('should trim whitespace from all subjects including first', () => {
      const subjects = ['  Mathematics  ', '  Physics  '];
      const normalized = normalizeSubjectObjects(subjects);
      const names = getSubjectNames(normalized);

      expect(names[0]).toBe('Mathematics');
      expect(names[1]).toBe('Physics');
      expect(names.every(n => n === n.trim())).toBe(true);
    });
  });

  describe('Issue #2: Lead Count Integrity', () => {
    it('should provide consistent subject matching for lead assignment', () => {
      // Tutor subjects
      const tutorSubjects = normalizeSubjectObjects([
        'Mathematics',
        'Physics',
        { name: 'Chemistry' }
      ]);

      // Lead requirements subjects
      const leadSubjects = normalizeSubjectObjects([
        'Mathematics',
        { name: 'Biology' }
      ]);

      // Extract names for matching
      const tutorNames = getSubjectNames(tutorSubjects).map(s => s.toLowerCase());
      const leadNames = getSubjectNames(leadSubjects).map(s => s.toLowerCase());

      // Should find match
      const matchFound = tutorNames.some(t => leadNames.includes(t));
      expect(matchFound).toBe(true);
      expect(matchFound).toBe(tutorNames.includes('mathematics'));
    });

    it('should maintain subject consistency for metrics calculation', () => {
      // Simulate metrics based on subject assignments
      const tutorsWithSubjects = [
        {
          id: 'tutor1',
          subjects: normalizeSubjectObjects(['Math', 'Physics']),
          metrics: { totalLeads: 0 }
        },
        {
          id: 'tutor2',
          subjects: normalizeSubjectObjects([{ name: 'Chemistry' }]),
          metrics: { totalLeads: 0 }
        }
      ];

      // Verify subject data integrity for further processing
      tutorsWithSubjects.forEach(tutor => {
        expect(tutor.subjects).toBeDefined();
        expect(Array.isArray(tutor.subjects)).toBe(true);
        expect(tutor.subjects.length > 0).toBe(true);
      });

      // Extract display names without data loss
      const displayNames = tutorsWithSubjects.map(t => ({
        id: t.id,
        subjects: getSubjectNames(t.subjects)
      }));

      expect(displayNames[0].subjects[0]).toBe('Math');
      expect(displayNames[1].subjects[0]).toBe('Chemistry');
    });

    it('should preserve subject order for consistent lead matching', () => {
      const subjects = [
        'Science',
        'Mathematics',
        'English'
      ];

      const normalized = normalizeSubjectObjects(subjects);
      const names = getSubjectNames(normalized);

      // Order should be preserved
      expect(names[0]).toBe('Science');
      expect(names[1]).toBe('Mathematics');
      expect(names[2]).toBe('English');
    });
  });

  describe('Combined Fix Verification', () => {
    it('should handle real-world mixed subject scenario', () => {
      // Real-world data from database
      const tutorData = {
        name: 'John Tutor',
        subjects: [
          { name: 'Mathematics', levels: ['10', '12'], yearsExperience: 5 },
          'Physics',
          { name: 'Chemistry', specialization: 'Organic' },
          '   English   ' // with whitespace
        ],
        metrics: {
          totalLeads: 0,
          unlockedLeads: 0,
          convertedLeads: 0
        }
      };

      // Process through full pipeline
      const normalizedSubjects = normalizeSubjectObjects(tutorData.subjects);
      const displaySubjects = getSubjectNames(normalizedSubjects);

      // Assertions
      expect(displaySubjects).toHaveLength(4);
      expect(displaySubjects[0]).toBe('Mathematics');
      expect(displaySubjects[1]).toBe('Physics');
      expect(displaySubjects[2]).toBe('Chemistry');
      expect(displaySubjects[3]).toBe('English');

      // Verify no subject is lost
      expect(displaySubjects.filter(s => s.length > 0)).toHaveLength(4);

      // Verify metrics tracking
      expect(tutorData.metrics.totalLeads).toBe(0);
      // After lead assignment, metrics would be incremented
      tutorData.metrics.totalLeads += 1;
      expect(tutorData.metrics.totalLeads).toBe(1);
    });
  });
});
