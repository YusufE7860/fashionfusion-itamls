import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreatePrDto, PrService } from './pr.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions, PurchaseRequestStatus } from '../shared';

@Controller('purchase-requests')
export class PrController {
  constructor(private svc: PrService) {}

  @Get() list() { return this.svc.list(); }
  @Get(':id') byId(@Param('id') id: string) { return this.svc.byId(id); }

  @Post()
  @RequirePermissions(Permissions.ProcurementCreate)
  create(@Body() dto: CreatePrDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Post(':id/submit')
  @RequirePermissions(Permissions.ProcurementCreate)
  submit(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.transition(id, PurchaseRequestStatus.Submitted, uid);
  }

  @Post(':id/approve-it')
  @RequirePermissions(Permissions.ProcurementApproveIt)
  approveIt(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.transition(id, PurchaseRequestStatus.ItApproved, uid);
  }

  @Post(':id/approve-finance')
  @RequirePermissions(Permissions.ProcurementApproveFinance)
  approveFinance(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.transition(id, PurchaseRequestStatus.FinanceApproved, uid);
  }

  @Post(':id/reject')
  @RequirePermissions(Permissions.ProcurementApproveIt)
  reject(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.transition(id, PurchaseRequestStatus.Rejected, uid);
  }
}
