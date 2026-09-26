/** Word lists for torikloud's Debate: one letter per projectile, so longer words hit harder. */
export type DictionaryId = 'legal' | 'social-work';

export const DICTIONARIES: Record<DictionaryId, readonly string[]> = {
  legal: [
    'tort', 'bail', 'writ', 'plea', 'lien', 'oath', 'jury', 'suit', 'deed', 'moot',
    'brief', 'libel', 'bench', 'proxy', 'quash', 'trust', 'waiver',
    'appeal', 'caveat', 'clause', 'motion', 'quorum', 'remand', 'ruling', 'strike',
    'counsel', 'statute', 'verdict', 'custody', 'hearsay', 'lawsuit', 'probate', 'summons',
    'estoppel', 'subpoena', 'tribunal', 'mandamus', 'covenant', 'contract', 'judgment',
    'affidavit', 'defendant', 'plaintiff', 'precedent', 'indemnity', 'arbitrate', 'mediation',
    'certiorari', 'injunction', 'litigation', 'negligence', 'deposition', 'settlement',
    'arbitration', 'adjournment', 'prosecution', 'defamation',
    'jurisdiction', 'jurisprudence',
  ],
  'social-work': [
    'care', 'need', 'plan', 'goal', 'team', 'home',
    'trust', 'needs', 'model', 'voice', 'rights',
    'agency', 'trauma', 'kinship', 'respite', 'support', 'consent', 'empathy', 'rapport',
    'welfare', 'ecomap', 'caseload', 'advocacy', 'casework', 'genogram', 'outreach', 'referral',
    'capacity', 'holistic', 'wellbeing', 'inclusion', 'strengths', 'resilience', 'boundaries',
    'assessment', 'supervision', 'reflexivity', 'empowerment', 'intervention', 'safeguarding',
    'antioppressive', 'multiagency',
  ],
};
