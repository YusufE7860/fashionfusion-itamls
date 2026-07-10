/**
 * Seed: roles, permissions, default users, categories, SKUs, suppliers,
 * locations (HO + stock room + sample stores), templates and template items.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Roles, Permissions, LocationType, StoreStatus } from '../src/shared';

const prisma = new PrismaClient();

const ROLE_PERMS: Record<string, string[]> = {
  [Roles.Administrator]: Object.values(Permissions),
  [Roles.ITManager]: [
    Permissions.CatalogRead, Permissions.CatalogWrite,
    Permissions.AssetsRead, Permissions.AssetsWrite, Permissions.AssetsMove, Permissions.AssetsDispose,
    Permissions.AuditLogRead,
    Permissions.StockRead, Permissions.StockWrite,
    Permissions.GrvCreate, Permissions.GrvConfirm,
    Permissions.IbtCreate, Permissions.IbtApprove, Permissions.IbtDispatch, Permissions.IbtReceive,
    Permissions.ProcurementCreate, Permissions.ProcurementApproveIt, Permissions.SuppliersManage,
    Permissions.RepairsRead, Permissions.RepairsWrite, Permissions.WarrantiesRead,
    Permissions.StoresRead, Permissions.StoresWrite, Permissions.StoreWizard, Permissions.StoresAudit,
    Permissions.ReportsRead, Permissions.ReportsExport, Permissions.AuditLogRead,
    Permissions.TonerManage, Permissions.TonerOrderCreate, Permissions.TonerOrderDispatch, Permissions.TonerOrderReceive,
    Permissions.BackupsManage, Permissions.BackupsRead,
  ],
  [Roles.Technician]: [
    Permissions.CatalogRead,
    Permissions.AssetsRead, Permissions.AssetsWrite, Permissions.AssetsMove,
    Permissions.StockRead,
    Permissions.GrvCreate, Permissions.GrvConfirm,
    Permissions.IbtCreate, Permissions.IbtDispatch, Permissions.IbtReceive,
    Permissions.ProcurementCreate,
    Permissions.RepairsRead, Permissions.RepairsWrite,
    Permissions.WarrantiesRead, Permissions.StoresRead, Permissions.StoresAudit,
    Permissions.ReportsRead,
    Permissions.TonerOrderDispatch,
    Permissions.BackupsRead,
  ],
  [Roles.StoreManager]: [
    Permissions.AssetsRead, Permissions.StockRead, Permissions.StoresRead,
    Permissions.ProcurementCreate, Permissions.WarrantiesRead, Permissions.IbtReceive,
    Permissions.TonerOrderReceive,
  ],
  [Roles.Finance]: [
    Permissions.CatalogRead, Permissions.AssetsRead, Permissions.StockRead,
    Permissions.ProcurementApproveFinance, Permissions.SuppliersManage,
    Permissions.RepairsRead, Permissions.WarrantiesRead,
    Permissions.StoresRead, Permissions.ReportsRead, Permissions.ReportsExport,
  ],
  [Roles.Auditor]: [
    Permissions.AssetsRead, Permissions.StockRead, Permissions.StoresRead, Permissions.StoresAudit,
    Permissions.RepairsRead, Permissions.WarrantiesRead, Permissions.ReportsRead,
    Permissions.ReportsExport, Permissions.AuditLogRead,
  ],
};

async function ensurePermissions() {
  for (const code of Object.values(Permissions)) {
    await prisma.permission.upsert({
      where: { code }, update: {}, create: { code, description: code },
    });
  }
}

async function ensureRoles() {
  for (const [code, perms] of Object.entries(ROLE_PERMS)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: code },
      create: { code, name: code },
    });
    // Wire permissions
    const dbPerms = await prisma.permission.findMany({ where: { code: { in: perms } } });
    for (const p of dbPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        create: { roleId: role.id, permissionId: p.id },
        update: {},
      });
    }
  }
}

async function ensureUser(email: string, fullName: string, roleCode: string, password: string, storeId?: string) {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`Role ${roleCode} missing`);
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { fullName, roleId: role.id, storeId: storeId ?? null, isActive: true },
    create: { email, fullName, roleId: role.id, storeId: storeId ?? null, passwordHash, isActive: true },
  });
}

async function ensureCategory(name: string, parent?: string) {
  const parentRec = parent ? await prisma.category.findFirst({ where: { name: parent } }) : null;
  const existing = await prisma.category.findFirst({ where: { name, parentId: parentRec?.id ?? null } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, parentId: parentRec?.id } });
}

async function ensureSku(code: string, name: string, categoryName: string, manufacturer: string, model: string,
                          unitCostCents: number, isSerialised = true, warrantyMonths = 24, depreciationYears = 4) {
  const category = await prisma.category.findFirst({ where: { name: categoryName } });
  if (!category) throw new Error(`Missing category ${categoryName}`);
  return prisma.sku.upsert({
    where: { code },
    update: {},
    create: {
      code, name, categoryId: category.id, manufacturer, model,
      isSerialised, warrantyMonths, depreciationYears, unitCostCents,
    },
  });
}

async function ensureLocation(code: string, name: string, type: string, region?: string) {
  return prisma.location.upsert({
    where: { code },
    update: {},
    create: { code, name, type, region },
  });
}

async function ensureSupplier(name: string) {
  const existing = await prisma.supplier.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.supplier.create({ data: { name } });
}

async function main() {
  await ensurePermissions();
  await ensureRoles();

  // Categories
  await ensureCategory('Hardware');
  await ensureCategory('Accessories');
  await ensureCategory('Consumables');
  const hardware = ['Desktop PCs','Laptops','POS PCs','Servers','Routers','Switches','Access Points',
    'Slip Printers','Label Printers','Barcode Scanners','Monitors','UPS Units','CCTV Equipment','Tablets','Mobile Phones'];
  for (const c of hardware) await ensureCategory(c, 'Hardware');
  for (const c of ['Keyboards','Mice','HDMI Cables','Network Cables','Power Adaptors']) await ensureCategory(c, 'Accessories');
  for (const c of ['Printer Toners','Receipt Rolls','Labels']) await ensureCategory(c, 'Consumables');

  // Suppliers
  const dell = await ensureSupplier('Dell South Africa');
  const epson = await ensureSupplier('Epson');
  const mikrotik = await ensureSupplier('MikroTik / Network Distributor');
  const apc = await ensureSupplier('Schneider/APC');

  // SKUs
  await ensureSku('POS-DELL-3000', 'Dell OptiPlex 3000 SFF (POS)', 'POS PCs', 'Dell', 'OptiPlex 3000', 12500_00);
  await ensureSku('MON-DELL-24', 'Dell 24" Monitor E2422H', 'Monitors', 'Dell', 'E2422H', 3500_00);
  await ensureSku('PR-EPSON-TMM30', 'Epson TM-m30 Slip Printer', 'Slip Printers', 'Epson', 'TM-m30', 5200_00);
  await ensureSku('SCAN-ZEBRA-DS2208', 'Zebra DS2208 Barcode Scanner', 'Barcode Scanners', 'Zebra', 'DS2208', 1400_00);
  await ensureSku('RTR-MK-RB4011', 'MikroTik RB4011 Router', 'Routers', 'MikroTik', 'RB4011', 4200_00);
  await ensureSku('SW-MK-CRS112', 'MikroTik CRS112 Switch', 'Switches', 'MikroTik', 'CRS112', 3100_00);
  await ensureSku('UPS-APC-1500', 'APC Back-UPS Pro 1500VA', 'UPS Units', 'APC', 'BR1500G', 4500_00);
  await ensureSku('OFFICE-PC-DELL', 'Dell OptiPlex Office PC', 'Desktop PCs', 'Dell', 'OptiPlex 5000', 14500_00);
  await ensureSku('LBL-ZEBRA-ZD420', 'Zebra ZD420 Label Printer', 'Label Printers', 'Zebra', 'ZD420', 6800_00);
  await ensureSku('AP-MK-CAP-AC', 'MikroTik cAP ac Access Point', 'Access Points', 'MikroTik', 'cAP ac', 1900_00);

  // Locations
  const ho = await ensureLocation('HO', 'Head Office', LocationType.HeadOffice, 'KZN');
  const sr = await ensureLocation('SR-DBN', 'Central Stock Room - Durban', LocationType.StockRoom, 'KZN');

  // Store templates
  const templates: Record<string, { name: string; items: Record<string, number> }> = {
    SMALL:    { name: 'Small Store',    items: { 'POS PCs':2,'Monitors':3,'Slip Printers':2,'Barcode Scanners':2,'Desktop PCs':1,'Label Printers':1,'Routers':1,'Switches':1,'Access Points':1,'UPS Units':1 } },
    MEDIUM:   { name: 'Medium Store',   items: { 'POS PCs':4,'Monitors':5,'Slip Printers':4,'Barcode Scanners':4,'Desktop PCs':1,'Label Printers':1,'Routers':1,'Switches':1,'Access Points':2,'UPS Units':1 } },
    LARGE:    { name: 'Large Store',    items: { 'POS PCs':6,'Monitors':8,'Slip Printers':6,'Barcode Scanners':6,'Desktop PCs':2,'Label Printers':2,'Routers':1,'Switches':2,'Access Points':3,'UPS Units':2 } },
    FLAGSHIP: { name: 'Flagship Store', items: { 'POS PCs':8,'Monitors':11,'Slip Printers':8,'Barcode Scanners':8,'Desktop PCs':3,'Label Printers':2,'Routers':1,'Switches':2,'Access Points':4,'UPS Units':2 } },
  };
  for (const [code, t] of Object.entries(templates)) {
    const tpl = await prisma.storeTemplate.upsert({
      where: { code }, update: { name: t.name }, create: { code, name: t.name },
    });
    for (const [catName, qty] of Object.entries(t.items)) {
      const cat = await prisma.category.findFirst({ where: { name: catName } });
      if (!cat) continue;
      await prisma.storeTemplateItem.upsert({
        where: { templateId_categoryId: { templateId: tpl.id, categoryId: cat.id } },
        update: { requiredQty: qty },
        create: { templateId: tpl.id, categoryId: cat.id, requiredQty: qty },
      });
    }
  }

  // Sample stores
  const mediumTpl = await prisma.storeTemplate.findUnique({ where: { code: 'MEDIUM' } });
  const largeTpl = await prisma.storeTemplate.findUnique({ where: { code: 'LARGE' } });
  const sampleStores = [
    { code: '001', name: 'Gateway',       region: 'KZN',          entity: 'FASHION_FUSION', tpl: largeTpl?.id  },
    { code: '002', name: 'Pavilion',      region: 'KZN',          entity: 'FASHION_FUSION', tpl: mediumTpl?.id },
    { code: '003', name: 'Chatsworth',    region: 'KZN',          entity: 'FASHION_FUSION', tpl: mediumTpl?.id },
    { code: '004', name: 'Sandton',       region: 'Gauteng',      entity: 'FASHION_FUSION', tpl: largeTpl?.id  },
    { code: '005', name: 'Canal Walk',    region: 'Western Cape', entity: 'FASHION_FUSION', tpl: mediumTpl?.id },
    { code: 'E01', name: 'EVLV Galleria', region: 'KZN',          entity: 'EVLV',           tpl: mediumTpl?.id },
    { code: 'E02', name: 'EVLV Boardwalk',region: 'Eastern Cape', entity: 'EVLV',           tpl: mediumTpl?.id },
  ];
  for (const s of sampleStores) {
    const loc = await ensureLocation(`STR-${s.code}`, `Store ${s.code} - ${s.name}`, LocationType.Store, s.region);
    const existing = await prisma.store.findUnique({ where: { code: s.code } });
    if (!existing) {
      await prisma.store.create({
        data: {
          code: s.code, name: s.name, region: s.region, entity: s.entity,
          locationId: loc.id, templateId: s.tpl ?? null, status: StoreStatus.Open,
          openedAt: new Date(),
        },
      });
    } else if (existing.entity !== s.entity) {
      await prisma.store.update({ where: { id: existing.id }, data: { entity: s.entity } });
    }
  }

  // Toner types — from the user's Monthly Toner Order spreadsheet
  const toners = [
    { code: '111L', name: 'HP 111L Original Toner Cartridge', manufacturer: 'HP',    unitCostCents: 174_00, hqStock: 8,  reorderLevel: 4 },
    { code: '154A', name: 'HP 154A Original Toner Cartridge', manufacturer: 'HP',    unitCostCents: 205_00, hqStock: 12, reorderLevel: 6 },
    { code: '737',  name: 'Canon 737 Black Toner',            manufacturer: 'Canon', unitCostCents: 145_00, hqStock: 6,  reorderLevel: 3 },
    { code: '285A', name: 'HP 85A Original Toner Cartridge',  manufacturer: 'HP',    unitCostCents: 145_00, hqStock: 4,  reorderLevel: 2 },
  ];
  for (const t of toners) {
    await prisma.tonerType.upsert({
      where: { code: t.code },
      update: {},
      create: t,
    });
  }

  // Demo users (password = password)
  await ensureUser('admin@fashionfusion.local', 'Group IT Admin', Roles.Administrator, 'password');
  await ensureUser('itmanager@fashionfusion.local', 'Priya Naidoo', Roles.ITManager, 'password');
  await ensureUser('tech@fashionfusion.local', 'Thabo Nkosi', Roles.Technician, 'password');
  const store001 = await prisma.store.findUnique({ where: { code: '001' } });
  await ensureUser('store001@fashionfusion.local', 'Lerato Khumalo (Gateway)', Roles.StoreManager, 'password', store001?.id);
  await ensureUser('finance@fashionfusion.local', 'Anil Patel', Roles.Finance, 'password');
  await ensureUser('auditor@fashionfusion.local', 'Internal Audit', Roles.Auditor, 'password');

  // Seed some example assets in stock room and at Gateway
  const posSku = await prisma.sku.findUnique({ where: { code: 'POS-DELL-3000' } });
  const monSku = await prisma.sku.findUnique({ where: { code: 'MON-DELL-24' } });
  const slipSku = await prisma.sku.findUnique({ where: { code: 'PR-EPSON-TMM30' } });

  async function ensureAsset(tag: string, sku: { id: string; unitCostCents: number; warrantyMonths: number }, locId: string, store?: { id: string }, status='IN_STORE') {
    const exists = await prisma.asset.findUnique({ where: { assetTag: tag } });
    if (exists) return exists;
    const purchase = new Date(); purchase.setMonth(purchase.getMonth() - 6);
    const warranty = new Date(); warranty.setMonth(warranty.getMonth() + (sku.warrantyMonths - 6));
    return prisma.asset.create({
      data: {
        assetTag: tag, serialNo: `${tag}-SN`, skuId: sku.id,
        purchaseDate: purchase, purchaseCostCents: sku.unitCostCents,
        currentValueCents: Math.round(sku.unitCostCents * 0.85),
        warrantyExpiry: warranty,
        condition: 'GOOD',
        locationId: locId,
        assignedStoreId: store?.id,
        status,
      },
    });
  }

  if (posSku && monSku && slipSku && store001) {
    // 4 POS PCs in Gateway
    await ensureAsset('FF-POS-G-001', posSku, store001.locationId, store001);
    await ensureAsset('FF-POS-G-002', posSku, store001.locationId, store001);
    await ensureAsset('FF-POS-G-003', posSku, store001.locationId, store001);
    await ensureAsset('FF-POS-G-004', posSku, store001.locationId, store001);
    // 4 monitors
    for (let i=1;i<=4;i++) await ensureAsset(`FF-MON-G-00${i}`, monSku, store001.locationId, store001);
    // 4 slip printers
    for (let i=1;i<=4;i++) await ensureAsset(`FF-SLIP-G-00${i}`, slipSku, store001.locationId, store001);
    // A few in stock room
    await ensureAsset('FF-POS-SR-001', posSku, sr.id, undefined, 'IN_STOCK');
    await ensureAsset('FF-MON-SR-001', monSku, sr.id, undefined, 'IN_STOCK');
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
