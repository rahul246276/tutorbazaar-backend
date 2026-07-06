const normalizeSubjects = (subjects = [], fallback = 'General Tutoring') => {
  const rawSubjects = Array.isArray(subjects) ? subjects : [subjects].filter(Boolean);
  const normalized = rawSubjects
    .map((subject) => (typeof subject === 'string' ? subject : subject?.name))
    .map((subject) => String(subject || '').trim())
    .filter(Boolean);

  return Array.from(new Set(normalized.length ? normalized : [fallback]));
};

const normalizeSubjectObjects = (subjects = []) => {
  const normalized = normalizeSubjects(subjects, '').filter(Boolean);
  return normalized.map((name) => ({ name }));
};

const getSubjectNames = (subjects = []) => {
  const rawSubjects = Array.isArray(subjects) ? subjects : [subjects].filter(Boolean);
  return rawSubjects
    .map((subject) => (typeof subject === 'string' ? subject : subject?.name))
    .map((subject) => String(subject || '').trim())
    .filter(Boolean);
};

module.exports = {
  normalizeSubjects,
  normalizeSubjectObjects,
  getSubjectNames,
};
