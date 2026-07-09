"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatZAR = exports.fromCents = exports.cents = exports.ComplianceState = exports.StoreStatus = exports.PurchaseRequestStatus = exports.RepairStatus = exports.IbtStatus = exports.LocationType = exports.AssetStatus = exports.Permissions = exports.Roles = void 0;
exports.Roles = {
    Administrator: 'ADMINISTRATOR',
    ITManager: 'IT_MANAGER',
    Technician: 'TECHNICIAN',
    StoreManager: 'STORE_MANAGER',
    Finance: 'FINANCE',
    Auditor: 'AUDITOR',
};
exports.Permissions = {
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
};
exports.AssetStatus = {
    InStock: 'IN_STOCK',
    Allocated: 'ALLOCATED',
    InStore: 'IN_STORE',
    InTransit: 'IN_TRANSIT',
    Repair: 'REPAIR',
    Damaged: 'DAMAGED',
    Lost: 'LOST',
    WrittenOff: 'WRITTEN_OFF',
    Disposed: 'DISPOSED',
};
exports.LocationType = {
    HeadOffice: 'HEAD_OFFICE',
    StockRoom: 'STOCK_ROOM',
    Store: 'STORE',
    RepairBay: 'REPAIR_BAY',
    InTransit: 'IN_TRANSIT',
};
exports.IbtStatus = {
    Requested: 'REQUESTED',
    Approved: 'APPROVED',
    Dispatched: 'DISPATCHED',
    InTransit: 'IN_TRANSIT',
    Received: 'RECEIVED',
    Cancelled: 'CANCELLED',
};
exports.RepairStatus = {
    Logged: 'LOGGED',
    Sent: 'SENT',
    AtSupplier: 'AT_SUPPLIER',
    Returned: 'RETURNED',
    Replaced: 'REPLACED',
    WrittenOff: 'WRITTEN_OFF',
};
exports.PurchaseRequestStatus = {
    Draft: 'DRAFT',
    Submitted: 'SUBMITTED',
    ItApproved: 'IT_APPROVED',
    FinanceApproved: 'FINANCE_APPROVED',
    Ordered: 'ORDERED',
    Closed: 'CLOSED',
    Rejected: 'REJECTED',
};
exports.StoreStatus = {
    Planned: 'PLANNED',
    Opening: 'OPENING',
    Open: 'OPEN',
    Remodel: 'REMODEL',
    Closed: 'CLOSED',
};
exports.ComplianceState = {
    Installed: 'INSTALLED',
    Partial: 'PARTIAL',
    Missing: 'MISSING',
};
const cents = (whole) => Math.round(whole * 100);
exports.cents = cents;
const fromCents = (c) => c / 100;
exports.fromCents = fromCents;
const formatZAR = (cents) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents / 100);
exports.formatZAR = formatZAR;
//# sourceMappingURL=index.js.map