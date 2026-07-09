export declare const Roles: {
    readonly Administrator: "ADMINISTRATOR";
    readonly ITManager: "IT_MANAGER";
    readonly Technician: "TECHNICIAN";
    readonly StoreManager: "STORE_MANAGER";
    readonly Finance: "FINANCE";
    readonly Auditor: "AUDITOR";
};
export type Role = (typeof Roles)[keyof typeof Roles];
export declare const Permissions: {
    readonly UsersManage: "users:manage";
    readonly RolesManage: "roles:manage";
    readonly CatalogRead: "catalog:read";
    readonly CatalogWrite: "catalog:write";
    readonly AssetsRead: "assets:read";
    readonly AssetsWrite: "assets:write";
    readonly AssetsMove: "assets:move";
    readonly AssetsDispose: "assets:dispose";
    readonly StockRead: "stock:read";
    readonly StockWrite: "stock:write";
    readonly GrvCreate: "grv:create";
    readonly GrvConfirm: "grv:confirm";
    readonly IbtCreate: "ibt:create";
    readonly IbtApprove: "ibt:approve";
    readonly IbtDispatch: "ibt:dispatch";
    readonly IbtReceive: "ibt:receive";
    readonly ProcurementCreate: "procurement:create";
    readonly ProcurementApproveIt: "procurement:approve:it";
    readonly ProcurementApproveFinance: "procurement:approve:finance";
    readonly SuppliersManage: "suppliers:manage";
    readonly RepairsRead: "repairs:read";
    readonly RepairsWrite: "repairs:write";
    readonly WarrantiesRead: "warranties:read";
    readonly StoresRead: "stores:read";
    readonly StoresWrite: "stores:write";
    readonly StoreWizard: "store:wizard";
    readonly StoresAudit: "stores:audit";
    readonly ReportsRead: "reports:read";
    readonly ReportsExport: "reports:export";
    readonly AuditLogRead: "auditlog:read";
};
export type Permission = (typeof Permissions)[keyof typeof Permissions];
export declare const AssetStatus: {
    readonly InStock: "IN_STOCK";
    readonly Allocated: "ALLOCATED";
    readonly InStore: "IN_STORE";
    readonly InTransit: "IN_TRANSIT";
    readonly Repair: "REPAIR";
    readonly Damaged: "DAMAGED";
    readonly Lost: "LOST";
    readonly WrittenOff: "WRITTEN_OFF";
    readonly Disposed: "DISPOSED";
};
export type AssetStatusT = (typeof AssetStatus)[keyof typeof AssetStatus];
export declare const LocationType: {
    readonly HeadOffice: "HEAD_OFFICE";
    readonly StockRoom: "STOCK_ROOM";
    readonly Store: "STORE";
    readonly RepairBay: "REPAIR_BAY";
    readonly InTransit: "IN_TRANSIT";
};
export type LocationTypeT = (typeof LocationType)[keyof typeof LocationType];
export declare const IbtStatus: {
    readonly Requested: "REQUESTED";
    readonly Approved: "APPROVED";
    readonly Dispatched: "DISPATCHED";
    readonly InTransit: "IN_TRANSIT";
    readonly Received: "RECEIVED";
    readonly Cancelled: "CANCELLED";
};
export type IbtStatusT = (typeof IbtStatus)[keyof typeof IbtStatus];
export declare const RepairStatus: {
    readonly Logged: "LOGGED";
    readonly Sent: "SENT";
    readonly AtSupplier: "AT_SUPPLIER";
    readonly Returned: "RETURNED";
    readonly Replaced: "REPLACED";
    readonly WrittenOff: "WRITTEN_OFF";
};
export type RepairStatusT = (typeof RepairStatus)[keyof typeof RepairStatus];
export declare const PurchaseRequestStatus: {
    readonly Draft: "DRAFT";
    readonly Submitted: "SUBMITTED";
    readonly ItApproved: "IT_APPROVED";
    readonly FinanceApproved: "FINANCE_APPROVED";
    readonly Ordered: "ORDERED";
    readonly Closed: "CLOSED";
    readonly Rejected: "REJECTED";
};
export type PurchaseRequestStatusT = (typeof PurchaseRequestStatus)[keyof typeof PurchaseRequestStatus];
export declare const StoreStatus: {
    readonly Planned: "PLANNED";
    readonly Opening: "OPENING";
    readonly Open: "OPEN";
    readonly Remodel: "REMODEL";
    readonly Closed: "CLOSED";
};
export type StoreStatusT = (typeof StoreStatus)[keyof typeof StoreStatus];
export declare const ComplianceState: {
    readonly Installed: "INSTALLED";
    readonly Partial: "PARTIAL";
    readonly Missing: "MISSING";
};
export type ComplianceStateT = (typeof ComplianceState)[keyof typeof ComplianceState];
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
    location: {
        id: string;
        code: string;
        name: string;
        type: LocationTypeT;
    } | null;
    sku: {
        id: string;
        code: string;
        name: string;
        manufacturer: string;
        model: string;
        categoryName: string;
    };
    supplier: {
        id: string;
        name: string;
    } | null;
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
export declare const cents: (whole: number) => number;
export declare const fromCents: (c: number) => number;
export declare const formatZAR: (cents: number) => string;
