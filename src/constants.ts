export const MED_CATEGORIES = [
  "Analgesics",
  "Antibiotics",
  "Anti-fungal",
  "CV (Cardiovascular)",
  "GIT (Gastrointestinal)",
  "Respiratory",
  "Controlled Drugs",
  "Dermatological",
  "ENT (Ear, Nose, Throat)",
  "Vitamins and Minerals",
  "Supplies",
  "Others"
];

export const UNITS = [
  "Tablet",
  "Capsule",
  "Strip",
  "Each",
  "Pkt",
  "Box",
  "Bag",
  "Bottle",
  "Tube",
  "Roll",
  "Dozen",
  "Vial",
  "Ampule",
  "Other"
];

export const LABEL_OPTIONS = {
  DOSAGE_FORMS: [
    "Tablet", "Capsule", "Syrup", "Suspension", "Dry Powder for Suspension", 
    "Cream", "Ointment", "Gel", "Eye Drops", "Ear Drops", "Nose Drops", 
    "Inhaler", "Spray", "Injection", "Vial", "Ampule"
  ],
  ROUTES: [
    "By mouth",
    "Apply to skin",
    "Instill into eye",
    "Put into ear",
    "Use in nose",
    "Inhale",
    "Inject",
    "Insert rectally",
    "Insert vaginally"
  ],
  FREQUENCIES: [
    "Once daily",
    "Twice daily",
    "Three times daily",
    "Four times daily",
    "Every 4 hours",
    "Every 6 hours",
    "Every 8 hours",
    "At bedtime",
    "As needed",
    "Immediately"
  ],
  DURATIONS: [
    "For 3 days",
    "For 5 days",
    "For 7 days",
    "For 10 days",
    "For 14 days",
    "For 1 month",
    "Until finished",
    "Until symptoms resolve"
  ],
  FOOD_INSTRUCTIONS: [
    "", // Empty option
    "Take with food",
    "Take after food",
    "Take on an empty stomach (1hr before or 2hr after food)",
    "Avoid alcohol",
    "Avoid grapefruit juice",
    "Drink with plenty of water"
  ],
  PREPARATIONS: [
    "", // Empty option
    "Shake well before use",
    "Shake well until mixed",
    "Add boiled and cooled water up to the mark",
    "Store in refrigerator",
    "Store in refrigerator after mixing",
    "Do not freeze",
    "Keep out of reach of children"
  ]
};

export const DB_KEYS = {
  PRODUCTS: 'pharma_products',
  SALES: 'pharma_sales',
  INFO: 'pharma_info',
  USER: 'pharma_user_session',
  HOLD_CARTS: 'pharma_hold_carts',
  SUPPLIERS: 'pharma_suppliers',
  SUPPLIER_TRANSACTIONS: 'pharma_supplier_transactions',
  LOGS: 'pharma_activity_logs',
  USERS: 'pharma_users_db',
  CUSTOMERS: 'pharma_customers_db',
  HARDWARE_CONFIG: 'pharma_hardware_config',
  PRESCRIPTIONS: 'pharma_prescriptions',
  BULK_TRANSFERS: 'pharma_bulk_transfers',
  STOCK_ADJUSTMENTS: 'pharma_stock_adjustments'
};

export const LOYALTY_CONFIG = {
  SPEND_PER_POINT: 10, // Spend 10 to get 1 Point
  VALUE_PER_POINT: 0.5, // 1 Point = 0.50 discount
  TIERS: {
    BRONZE: { min: 0, color: '#CD7F32' },
    SILVER: { min: 100, color: '#C0C0C0' }, // 100 Lifetime Points
    GOLD: { min: 500, color: '#FFD700' }     // 500 Lifetime Points
  }
};
