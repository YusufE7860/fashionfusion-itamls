/**
 * Shared enums, types and constants for the ITAMLS platform.
 * Both apps/api (NestJS) and apps/web (React) import from here.
 */

// ---------- Roles ----------
export const Roles = {
  Administrator: 'ADMINISTRATOR',
  ITManager: 'IT_MANAGER',
  Technician: 'TECHNICIAN',
  StoreManager: 'STORE_MANAGER',
  Finance: 'FINANCE',
  Auditor: 'AUDITOR',
} as const;
export type Role = (typeof Roles)[keyof typeof Roles];

// ---------- Permissions ----------
export const Permissions = {
  // Users / admin
  UsersManage: 'users:manage',
  RolesManage: 'roles:manage',
  // Catalog
  CatalogRead: 'catalog:read',
  CatalogWrite: 'catalog:write',
  // Inventory / assets
  AssetsRead: 'assets:read',
  AssetsWrite: 'assets:write',
  AssetsMove: 'assets:move',
  AssetsDispose: 'assets:dispose',
  // Stock
  StockRead: 'stock:read',
  StockWrite: 'stock:write',
  // Logistics
  GrvCreate: 'grv:create',
  GrvConfirm: 'grv:confirm',
  IbtCreate: 'ibt:create',
  IbtApprove: 'ibt:approve',
  IbtDispatch: 'ibt:dispatch',
  IbtReceive: 'ibt:receive',
  // Procurement
  ProcurementCreate: 'procurement:create',
  ProcurementApproveIt: 'procurement:approve:it',
  ProcurementApproveFinance: 'procurement:approve:finance',
  SuppliersManage: 'suppliers:manage',
  // Service
  RepairsRead: 'repairs:read',
  RepairsWrite: 'repairs:write',
  WarrantiesRead: 'warranties:read',
  // Stores
  StoresRead: 'stores:read',
  StoresWrite: 'stores:write',
  StoreWizard: 'store:wizard',
  StoresAudit: 'stores:audit',
  // Reporting
  ReportsRead: 'reports:read',
  ReportsExport: 'reports:export',
  // Audit
  AuditLogRead: 'auditlog:read',
} as const;
export type Permission = (typeof Permissions)[keyof typeof Permissions];

// ---------- Asset / inventory enumerations ----------
export const AssetStatus = {
  InStock: 'IN_STOCK',
  Allocated: 'ALLOCATED',
  InStore: 'IN_STORE',
  InTransit: 'IN_TRANSIT',
  Repair: 'REPAIR',
  Damaged: 'DAMAGED',
  Lost: 'LOST',
  WrittenOff: 'WRITTEN_OFF',
  Disposed: 'DISPOSED',
} as const;
export type AssetStatusT = (typeof AssetStatus)[keyof typeof AssetStatus];

export const LocationType = {
  HeadOffice: 'HEAD_OFFICE',
  StockRoom: 'STOCK_ROOM',
  Store: 'STORE',
  RepairBay: 'REPAIR_BAY',
  InTransit: 'IN_TRANSIT',
} as const;
export type LocationTypeT = (typeof LocationType)[keyof typeof LocationType];

export const IbtStatus = {
  Requested: 'REQUESTED',
  Approved: 'APPROVED',
  Dispatched: 'DISPATCHED',
  InTransit: 'IN_TRANSIT',
  Received: 'RECEIVED',
  Cancelled: 'CANCELLED',
} as const;
export type IbtStatusT = (typeof IbtStatus)[keyof typeof IbtStatus];

export const RepairStatus = {
  Logged: 'LOGGED',
  Sent: 'SENT',
  AtSupplier: 'AT_SUPPLIER',
  Returned: 'RETURNED',
  Replaced: 'REPLACED',
  WrittenOff: 'WRITTEN_OFF',
} as const;
export type RepairStatusT = (typeof RepairStatus)[keyof typeof RepairStatus];

export const PurchaseRequestStatus = {
  Draft: 'DRAFT',
  Submitted: 'SUBMITTED',
  ItApproved: 'IT_APPROVED',
  FinanceApproved: 'FINANCE_APPROVED',
  Ordered: 'ORDERED',
  Closed: 'CLOSED',
  Rejected: 'REJECTED',
} as const;
export type PurchaseRequestStatusT = (typeof PurchaseRequestStatus)[keyof typeof PurchaseRequestStatus];

export const StoreStatus = {
  Planned: 'PLANNED',
  Opening: 'OPENING',
  Open: 'OPEN',
  Remodel: 'REMODEL',
  Closed: 'CLOSED',
} as const;
export type StoreStatusT = (typeof StoreStatus)[keyof typeof StoreStatus];

export const ComplianceState = {
  Installed: 'INSTALLED',
  Partial: 'PARTIAL',
  Missing: 'MISSING',
} as const;
export type ComplianceStateT = (typeof ComplianceState)[keyof typeof ComplianceState];

// ---------- DTO shapes ----------
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  storeId?: string | null;
  isActive: boolean;
}

export interface AssetDto {
  id: string;
  assetTag: string;
  serialNo: string | null;
  status: AssetStatusT;
  condition: string | null;
  purchaseDateIso: string | null;
  purchaseCostCents: number;
  currentValueCents: number;
  warrantyExpiryIso: string | null;
  location: { id: string; code: string; name: string; type: LocationTypeT } | null;
  sku: { id: string; code: string; name: string; manufacturer: string; model: string; categoryName: string };
  supplier: { id: string; name: string } | null;
  assignedUserId: string | null;
  assignedStoreId: string | null;
  installedAtIso: string | null;
}

export interface StockRowDto {
  locationId: string;
  locationCode: string;
  locationName: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qtyOnHand: number;
  reorderLevel: number;
}

export interface ComplianceLineDto {
  templateItemId: string;
  categoryId: string;
  categoryName: string;
  requiredQty: number;
  installedQty: number;
  state: ComplianceStateT;
}

// ---------- Toner ----------
export const StoreEntity = {
  FashionFusion: 'FASHION_FUSION',
  EVLV: 'EVLV',
} as const;
export type StoreEntityT = (typeof StoreEntity)[keyof typeof StoreEntity];

export const TonerOrderStatus = {
  Draft: 'DRAFT',
  Dispatched: 'DISPATCHED',
  Received: 'RECEIVED',
  Closed: 'CLOSED',
  Cancelled: 'CANCELLED',
} as const;
export type TonerOrderStatusT = (typeof TonerOrderStatus)[keyof typeof TonerOrderStatus];

export const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const;
export type MonthKey = (typeof MONTHS)[number];

// ---------- Money helpers ----------
export const cents = (whole: number) => Math.round(whole * 100);
export const fromCents = (c: number) => c / 100;
export const formatZAR = (cents: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents / 100);
