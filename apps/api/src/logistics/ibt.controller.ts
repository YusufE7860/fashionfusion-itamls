import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreateIbtDto, IbtService } from './ibt.service';
import { DispatchNoteService } from './dispatch-note.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('ibt')
export class IbtController {
  constructor(private svc: IbtService, private notes: DispatchNoteService) {}

  @Get(':id/dispatch-note.pdf')
  @RequirePermissions(Permissions.IbtDispatch)
  async note(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.notes.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="dispatch-${id}.pdf"`);
    res.send(buf);
  }
  @Get() list() { return this.svc.list(); }

  @Post()
  @RequirePermissions(Permissions.IbtCreate)
  create(@Body() dto: CreateIbtDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Post(':id/approve')
  @RequirePermissions(Permissions.IbtApprove)
  approve(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.approve(id, uid);
  }

  @Post(':id/dispatch')
  @RequirePermissions(Permissions.IbtDispatch)
  dispatch(@Param('id') id: string,
           @Body() body: { courier?: string; trackingNo?: string; boxNumbers?: string },
           @CurrentUser('sub') uid: string) {
    return this.svc.dispatch(id, uid, body);
  }

  @Post(':id/receive')
  @RequirePermissions(Permissions.IbtReceive)
  receive(@Param('id') id: string,
          @Body() body: { signatureDataUrl?: string; signedBy?: string },
          @CurrentUser('sub') uid: string) {
    return this.svc.receive(id, uid, body ?? {});
  }
}
