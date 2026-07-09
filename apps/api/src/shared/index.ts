/**
 * Local copy of the shared enums/types for the API.
 * Kept in sync with packages/shared/src/index.ts.
 * (Nest CLI's default tsc build can't reach across the workspace cleanly.)
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
  UsersManage: 'users:manage',
  RolesManage: 'roles:manage',
  CatalogRead: 'catalog:read',
  CatalogWrite: 'catalog:write',
  AssetsRead: 'assets:read',
  AssetsWrite: 'assets:write',
  AssetsMove: 'assets:move',
  AssetsDispose: 'assets:dispose',
  StockRead: 'stock:read',
  StockWrite: 'stock:write',
  GrvCreate: 'grv:create',
  GrvConfirm: 'grv:confirm',
  IbtCreate: 'ibt:create',
  IbtApprove: 'ibt:approve',
  IbtDispatch: 'ibt:dispatch',
  IbtReceive: 'ibt:receive',
  ProcurementCreate: 'procurement:create',
  ProcurementApproveIt: 'procurement:approve:it',
  ProcurementApproveFinance: 'procurement:approve:finance',
  SuppliersManage: 'suppliers:manage',
  RepairsRead: 'repairs:read',
  RepairsWrite: 'repairs:write',
  WarrantiesRead: 'warranties:read',
  StoresRead: 'stores:read',
  StoresWrite: 'stores:write',
  StoreWizard: 'store:wizard',
  StoresAudit: 'stores:audit',
  ReportsRead: 'reports:read',
  ReportsExport: 'reports:export',
  AuditLogRead: 'auditlog:read',
  TonerManage: 'toner:manage',
  TonerOrderCreate: 'toner:order:create',
  TonerOrderDispatch: 'toner:order:dispatch',
  TonerOrderReceive: 'toner:order:receive',
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

export interface ComplianceLineDto {
  templateItemId: string;
  categoryId: string;
  categoryName: string;
  requiredQty: number;
  installedQty: number;
  state: ComplianceStateT;
}
