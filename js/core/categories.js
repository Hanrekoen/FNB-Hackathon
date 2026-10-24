// Category ids; display labels live in the language files as "cat.<id>".

export const IN_CATS = ['wages', 'allowance', 'gig', 'business', 'grant', 'familyIn', 'otherIn'];

// 'food' is groceries and 'transport' is essential travel to work or class; eating out and
// extra trips have their own categories so they can be cut without touching the essentials.
export const OUT_CATS = [
  'food', 'transport', 'airtime', 'rent', 'electricity', 'bills', 'school',
  'health', 'family', 'stokvel', 'debt', 'takeaway', 'outings', 'clothing', 'fun', 'other',
];

// Never suggested as a cut-back. Airtime and data are essential for this audience.
export const ESSENTIAL = ['rent', 'electricity', 'bills', 'school', 'health', 'food', 'transport', 'debt', 'family', 'stokvel', 'airtime'];

// Everyday extras, with the most it's realistic to cut each in a month (%).
export const CUTTABLE = { takeaway: 50, fun: 50, outings: 50, clothing: 40, other: 30 };

// Icon names (see js/icons.js) for each transaction type.
export const ICONS = { in: 'plus', out: 'minus', save: 'piggy', withdraw: 'undo', needs: 'shield', release: 'arrowRight' };
