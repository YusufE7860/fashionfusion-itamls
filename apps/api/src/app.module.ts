import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LocationsModule } from './locations/locations.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { LogisticsModule } from './logistics/logistics.module';
import { StoresModule } from './stores/stores.module';
import { ProcurementModule } from './procurement/procurement.module';
import { ServiceModule } from './service/service.module';
import { LabelsModule } from './labels/labels.module';
import { ReportsModule } from './reports/reports.module';
import { InvoicesModule } from './invoices/invoices.module';
import { AuditsModule } from './audits/audits.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { DepreciationModule } from './depreciation/depreciation.module';
import { AlertsModule } from './alerts/alerts.module';
import { HelpdeskModule } from './helpdesk/helpdesk.module';
import { TonerModule } from './toner/toner.module';
import { PriceLookupModule } from './price-lookup/price-lookup.module';
import { ToolsModule } from './tools/tools.module';
import { MailerModule } from './mailer/mailer.module';
import { ActivityModule } from './activity/activity.module';
import { SoftwareModule } from './software/software.module';
import { UpdatesModule } from './updates/updates.module';
import { JwtAuthGuard } from './common/guards/jwt.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    MailerModule,
    AuthModule,
    UsersModule,
    LocationsModule,
    CatalogModule,
    InventoryModule,
    LogisticsModule,
    StoresModule,
    ProcurementModule,
    ServiceModule,
    LabelsModule,
    ReportsModule,
    InvoicesModule,
    AuditsModule,
    DiscoveryModule,
    DepreciationModule,
    AlertsModule,
    HelpdeskModule,
    TonerModule,
    PriceLookupModule,
    ToolsModule,
    ActivityModule,
    SoftwareModule,
    UpdatesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
