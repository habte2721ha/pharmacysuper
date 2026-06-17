export enum UserRole {
  ADMIN = 'ADMIN',
  PHARMACIST = 'PHARMACIST',
  CASHIER = 'CASHIER'
}

export enum ProductCategory {
  MEDICINE = 'MEDICINE',
  COSMETIC = 'COSMETIC'
}

export interface User {
  id: string;
  username: string;
  password?: string;
  role: UserRole;
  name: string;
  branch?: string;
  isDeleted?: boolean;
  permissions?: string[];
}

export const AVAILABLE_PERMISSIONS = [
  { id: 'add_item', label: 'Add/Edit Items' },
  { id: 'generate_report', label: 'Generate Reports' },
  { id: 'view_reports', label: 'View Reports' },
  { id: 'manage_users', label: 'Manage Users' },
  { id: 'manage_stock', label: 'Manage Stock/Adjustments' },
  { id: 'sales', label: 'Point of Sale' },
  { id: 'manage_settings', label: 'Manage Settings' }
];

export interface HardwareConfig {
  printerName?: string;
  paperWidth: '58mm' | '80mm';
  autoPrint?: boolean;
  enableDrawer?: boolean;
  drawerKickCommand?: string;
  silentPrint?: boolean;
}

export interface PharmacyInfo {
  name: string;
  address: string;
  branches?: string[]; // Array of branch names
  tin: string;
  phone: string;
  email: string;
  website?: string;
  licenseNumber?: string;
  logo?: string;
  footerNote?: string;
  notificationEmail?: string;
  notificationPhone?: string;
  enableDailyEmailReport?: boolean;
  enableDailySmsReport?: boolean;
  enableMonthlyExpiryEmail?: boolean;
  enableMonthlyExpirySms?: boolean;
  enableWeeklyBackup?: boolean;
  enableStockAlerts?: boolean;
  enableDevicePasscode?: boolean;
  reportTime?: string;
  hardware?: HardwareConfig;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  isDeleted?: boolean;
}

export type SupplierTransactionType = 'PURCHASE_CREDIT' | 'PAYMENT';

export interface SupplierTransaction {
  id: string;
  supplierId: string;
  type: SupplierTransactionType;
  amount: number;
  date: string;
  dueDate?: string; // For credit purchases
  reference?: string; // Invoice number or payment ID
  notes?: string;
  recordedBy: string;
  linkedCreditId?: string; // For PAYMENT type to link to a specific PURCHASE_CREDIT
  paidAmount?: number; // For PURCHASE_CREDIT to track how much is paid
  status?: 'UNPAID' | 'PARTIAL' | 'PAID'; // For PURCHASE_CREDIT
  discrepancyRemark?: string; // For matched transactions when amounts differ
}

export interface Product {
  id: string;
  type: ProductCategory;
  name: string;
  medCategory?: string;
  branch?: string;
  unit?: string;
  batchNumber?: string;
  quantity: number;
  storeQuantity?: number;
  minStockLevel: number;
  supplier: string;
  expiryDate: string;
  buyingPrice: number;
  sellingPrice: number;
  createdAt: string;
  isDeleted?: boolean;
}

export interface CartItem extends Product {
  cartQty: number;
  discount?: number;
}

export interface PaymentDetail {
  method: 'CASH' | 'CBE' | 'BOA' | 'AWASH' | 'DASHEN' | 'TELEBIRR' | 'CREDIT' | 'CARD' | 'OTHER';
  amount: number;
  reference?: string;
  dueDate?: string; // Specific for credit settlements
}

export interface Sale {
  id: string;
  receiptNumber: string;
  branch?: string;
  items: CartItem[];
  subTotal: number;
  vatPercent: number;
  vatAmount: number;
  grandTotal: number;
  customerId?: string; // Link to registered customer
  customerName: string;
  customerTin?: string;
  customerPhone?: string;
  soldBy: string;
  date: string;
  status: 'COMPLETED' | 'VOIDED' | 'ON_CREDIT';
  pointsEarned?: number;
  pointsRedeemed?: number;
  paymentMethods: PaymentDetail[];
  changeGiven: number;
  creditDetails?: {
    dueDate: string;
  };
}

export interface BinCardEntry {
  id: string;
  date: string;
  type: 'RECEIVED' | 'ISSUED' | 'RETURNED' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT';
  reference: string;
  batchNumber?: string;
  expiryDate?: string;
  inQty: number;
  outQty: number;
  balance: number;
  user: string;
}

export interface StockAdjustment {
  id: string;
  productName: string;
  date: string;
  userId: string;
  username: string;
  previousQuantity: number;
  newQuantity: number;
  difference: number;
}

export interface ActivityLog {
  id: string;
  userId: string;
  username: string;
  action: string;
  details: string;
  timestamp: string;
}

export interface Expense {
  id: string;
  date: string;
  amount: number;
  category: string;
  description: string;
  branch?: string;
  isDeleted?: boolean;
}

export interface Prescription {
  id: string;
  patientName: string;
  patientAge?: string;
  doctorName: string;
  hospitalName?: string;
  date: string;
  items: any[];
  notes?: string;
  imageUrl?: string;
  status: 'PENDING' | 'DISPENSED';
  registeredBy?: string;
}

export enum LoyaltyTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD'
}

export interface BulkTransferRecord {
  id: string;
  batchId: string;
  date: string;
  destination: string;
  driver: string;
  vehicleNo: string;
  reason: string;
  items: any[];
  totalValue: number;
  totalQty: number;
  userName: string;
  status?: 'ACTIVE' | 'COMPLETED' | 'VOIDED';
  voidReason?: string;
  voidDate?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  tin?: string;
  joinedDate: string;
  totalPointsEarned: number;
  currentPoints: number;
  tier: LoyaltyTier;
}
