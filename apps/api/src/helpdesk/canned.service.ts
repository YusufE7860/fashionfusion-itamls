import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CannedResponseDto {
  name: string;
  body: string;
  categoryId?: string | null;
  isActive?: boolean;
}

/**
 * Reusable comment snippets. Technicians pick one, server resolves placeholders
 * against the ticket context and returns the final body for them to paste or
 * send straight away.
 */
@Injectable()
export class CannedResponsesService {
  constructor(private prisma: PrismaService) {}

  list(categoryId?: string) {
    return this.prisma.cannedResponse.findMany({
      where: {
        isActive: true,
        OR: categoryId ? [{ categoryId: null }, { categoryId }] : undefined,
      },
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
      include: { category: { select: { id: true, code: true, name: true } } },
    });
  }

  listAll() {
    return this.prisma.cannedResponse.findMany({
      orderBy: [{ isActive: 'desc' }, { usageCount: 'desc' }, { name: 'asc' }],
      include: { category: { select: { id: true, code: true, name: true } } },
    });
  }

  async create(dto: CannedResponseDto, createdById: string) {
    if (!dto.name?.trim() || !dto.body?.trim()) throw new BadRequestException('name and body required');
    return this.prisma.cannedResponse.create({
      data: {
        name: dto.name.trim(),
        body: dto.body,
        categoryId: dto.categoryId || null,
        isActive: dto.isActive ?? true,
        createdById,
      },
    });
  }

  async update(id: string, dto: CannedResponseDto) {
    const exists = await this.prisma.cannedResponse.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException();
    return this.prisma.cannedResponse.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? exists.name,
        body: dto.body ?? exists.body,
        categoryId: dto.categoryId === undefined ? exists.categoryId : (dto.categoryId || null),
        isActive: dto.isActive ?? exists.isActive,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.cannedResponse.delete({ where: { id } }).catch(() => {});
    return { ok: true };
  }

  /**
   * Resolve `{{placeholder}}` tokens against ticket context. Unknown
   * placeholders are left as-is so the technician sees what wasn't substituted.
   */
  async apply(id: string, ticketId: string) {
    const [canned, ticket] = await Promise.all([
      this.prisma.cannedResponse.findUnique({ where: { id } }),
      this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          reporter: { select: { fullName: true, email: true } },
          assignedTo: { select: { fullName: true } },
          store: { select: { code: true, name: true } },
          category: { select: { code: true, name: true } },
          asset: { select: { assetTag: true } },
        },
      }),
    ]);
    if (!canned) throw new NotFoundException('Response not found');
    if (!ticket) throw new NotFoundException('Ticket not found');

    const firstName = (s?: string | null) => (s ?? '').split(' ')[0] ?? '';
    const vars: Record<string, string> = {
      'reporter.firstName': firstName(ticket.reporter?.fullName),
      'reporter.fullName':  ticket.reporter?.fullName ?? '',
      'reporter.email':     ticket.reporter?.email ?? '',
      'ticket.code':        ticket.code,
      'ticket.subject':     ticket.subject,
      'ticket.priority':    ticket.priority,
      'ticket.status':      ticket.status,
      'store.code':         ticket.store?.code ?? '',
      'store.name':         ticket.store?.name ?? '',
      'category.name':      ticket.category?.name ?? '',
      'asset.tag':          ticket.asset?.assetTag ?? '',
      'tech.firstName':     firstName(ticket.assignedTo?.fullName),
      'tech.fullName':      ticket.assignedTo?.fullName ?? '',
    };

    const resolved = canned.body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
      return key in vars ? vars[key] : match;
    });

    // Bump usage counter (fire-and-forget)
    this.prisma.cannedResponse.update({ where: { id }, data: { usageCount: { increment: 1 } } }).catch(() => {});

    return { body: resolved, name: canned.name };
  }
}
