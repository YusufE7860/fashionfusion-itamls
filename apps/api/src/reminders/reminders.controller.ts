import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ReminderDto, RemindersService } from './reminders.service';

const ctxFor = (req: any) => ({ userId: req.user?.sub, permissions: req.user?.permissions ?? [] });

@Controller('reminders')
export class RemindersController {
  constructor(private svc: RemindersService) {}

  @Get()
  listMine(@Req() req: any, @Query('includeCompleted') inc?: string) {
    return this.svc.listMine(ctxFor(req), inc === 'true');
  }

  @Get('all')
  listAll(@Query('includeCompleted') inc?: string) {
    return this.svc.listAll(inc === 'true');
  }

  @Post()
  create(@Body() dto: ReminderDto, @Req() req: any) { return this.svc.create(dto, ctxFor(req)); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: ReminderDto, @Req() req: any) {
    return this.svc.update(id, dto, ctxFor(req));
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Req() req: any) { return this.svc.complete(id, ctxFor(req)); }

  @Post(':id/uncomplete')
  uncomplete(@Param('id') id: string) { return this.svc.uncomplete(id); }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) { return this.svc.remove(id, ctxFor(req)); }
}
