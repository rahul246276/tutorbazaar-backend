const mongoose = require('mongoose');
const { normalizeSubjects, getSubjectNames } = require('./subjectUtils');
const { normalizeSubjectObjects } = require('./subjectUtils');

describe('subject and lead integration', () => {
  it('preserves first subject when normalizing tutor profile', () => {
    const inputSubjects = [
      { name: 'Mathematics' },
      { name: 'Physics' },
      { name: 'Chemistry' },
    ];
    
    const normalized = normalizeSubjectObjects(inputSubjects);
    const names = normalized.map(s => s.name);
    
    expect(names[0]).toBe('Mathematics');
    expect(names).toContain('Physics');
    expect(names).toContain('Chemistry');
  });

  it('extracts first subject name from mixed formats for display', () => {
    const inputSubjects = [
      { name: 'Science' },
      'Mathematics',
      { name: 'English' },
    ];
    
    const names = getSubjectNames(inputSubjects);
    
    expect(names[0]).toBe('Science');
    expect(names).toHaveLength(3);
    expect(names).toContain('Mathematics');
  });

  it('handles subject trimming to ensure display consistency', () => {
    const inputSubjects = ['  Computer Science  ', { name: ' Physics ' }];
    const names = getSubjectNames(inputSubjects);
    
    expect(names[0]).toBe('Computer Science');
    expect(names[1]).toBe('Physics');
    expect(names.every(n => n === n.trim())).toBe(true);
  });
});
