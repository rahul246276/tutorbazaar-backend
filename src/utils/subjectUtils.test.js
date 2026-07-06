const { normalizeSubjects, getSubjectNames } = require('./subjectUtils');

describe('subject utilities', () => {
  it('normalizes string subjects into trimmed names', () => {
    expect(normalizeSubjects([' Mathematics ', 'Science', ''])).toEqual(['Mathematics', 'Science']);
  });

  it('handles mixed subject objects and strings', () => {
    expect(normalizeSubjects([{ name: ' Physics ' }, 'Chemistry', { name: '' }])).toEqual(['Physics', 'Chemistry']);
  });

  it('extracts display names from mixed subject formats', () => {
    expect(getSubjectNames(['Math', { name: 'Science' }, null])).toEqual(['Math', 'Science']);
  });
});
