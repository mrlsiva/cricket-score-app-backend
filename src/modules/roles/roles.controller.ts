import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum, IsString } from 'class-validator';
import { Roles } from '../../common/decorators';
import { RolesService } from './roles.service';

class UpdatePermissionsDto {
  @ApiProperty({ example: ['match:view', 'stats:read'] })
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

class AssignRolesDto {
  @ApiProperty({ enum: RoleName, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(RoleName, { each: true })
  roles!: RoleName[];
}

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List roles with their permissions' })
  list() {
    return this.roles.list();
  }

  @Get('permissions')
  @ApiOperation({ summary: 'List all known permission keys' })
  permissions() {
    return this.roles.listPermissions();
  }

  @Patch(':name/permissions')
  @Roles(RoleName.SUPER_ADMIN)
  @ApiOperation({ summary: 'Replace the permission set of a role (Super Admin)' })
  update(@Param('name', new ParseEnumPipe(RoleName)) name: RoleName, @Body() dto: UpdatePermissionsDto) {
    return this.roles.updatePermissions(name, dto.permissions);
  }

  @Post('users/:userId')
  @Roles(RoleName.SUPER_ADMIN)
  @ApiOperation({ summary: 'Grant roles to a user (Super Admin)' })
  async assign(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: AssignRolesDto) {
    await this.roles.assign(userId, dto.roles);
    return { userId, roles: await this.roles.rolesOf(userId) };
  }

  @Delete('users/:userId')
  @Roles(RoleName.SUPER_ADMIN)
  @ApiOperation({ summary: 'Revoke roles from a user (Super Admin)' })
  async revoke(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: AssignRolesDto) {
    await this.roles.revoke(userId, dto.roles);
    return { userId, roles: await this.roles.rolesOf(userId) };
  }
}
