import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Permission } from '../../common/constants/permissions';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AccessService } from '../access/access.service';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller()
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  @Get('audit-logs')
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({ summary: 'Search audit logs (Super Admin: all, Organizer: own matches only via matchId)' })
  async list(@Query() q: AuditQueryDto, @CurrentUser() user: AuthUser) {
    if (!this.access.isSuperAdmin(user)) {
      if (!q.matchId) throw new ForbiddenException('matchId filter is required');
      await this.access.assertCanManageMatch(user, q.matchId);
    }
    return this.audit.list(q);
  }

  @Get('matches/:matchId/audit-logs')
  @ApiOperation({ summary: 'Audit history of a match (organizer / match owner)' })
  async forMatch(@Param('matchId', ParseUUIDPipe) matchId: string, @Query() q: AuditQueryDto, @CurrentUser() user: AuthUser) {
    await this.access.assertCanManageMatch(user, matchId);
    return this.audit.list({ ...q, matchId } as AuditQueryDto);
  }
}
