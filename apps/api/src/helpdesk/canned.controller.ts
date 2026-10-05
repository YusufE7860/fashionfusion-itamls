import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CannedResponseDto, CannedResponsesService } from './canned.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('helpdesk/canned')
export class CannedResponsesController {
  constructor(private svc: CannedResponsesService) {}

  // Picker list (any ticket writer sees active snippets for their category + global)
  @Get()
  @RequirePermissions(Permissions.TicketsWrite)
  list(@Query('categoryId') categoryId?: string) { return this.svc.list(categoryId); }

  // Admin: list all including inactive
  @Get('all')
  @RequirePermissions(Permissions.TicketsManageCategories)
  listAll() { return this.svc.listAll(); }

  @Post()
  @RequirePermissions(Permissions.TicketsManageCategories)
  create(@Body() dto: CannedResponseDto, @Req() req: any) {
    return this.svc.create(dto, req.user?.sub);
  }

  @Patch(':id')
  @RequirePermissions(Permissions.TicketsManageCategories)
  update(@Param('id') id: string, @Body() dto: CannedResponseDto) { return this.svc.update(id, dto); }

  @Delete(':id')
  @RequirePermissions(Permissions.TicketsManageCategories)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  // Resolve placeholders for a specific ticket; returns the rendered body
  @Get(':id/apply')
  @RequirePermissions(Permissions.TicketsWrite)
  apply(@Param('id') id: string, @Query('ticketId') ticketId: string) {
    return this.svc.apply(id, ticketId);
  }
}
