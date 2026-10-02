import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { NotificationQueryDto, RegisterDeviceDto, TopicDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications (meta.unread = unread count)' })
  list(@CurrentUser('id') userId: string, @Query() q: NotificationQueryDto) {
    return this.notifications.list(userId, q);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  read(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  readAll(@CurrentUser('id') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Post('devices')
  @ApiOperation({ summary: 'Register an FCM device token for push notifications' })
  register(@CurrentUser('id') userId: string, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(userId, dto.token, dto.platform);
  }

  @Delete('devices/:token')
  @ApiOperation({ summary: 'Unregister a device token (on logout)' })
  unregister(@CurrentUser('id') userId: string, @Param('token') token: string) {
    return this.notifications.removeDevice(userId, token);
  }

  @Post('topics/subscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Follow a match/tournament/team: subscribe my devices to its push topic' })
  subscribe(@CurrentUser('id') userId: string, @Body() dto: TopicDto) {
    return this.notifications.subscribeTopic(userId, dto.topic, true);
  }

  @Post('topics/unsubscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unfollow a push topic' })
  unsubscribe(@CurrentUser('id') userId: string, @Body() dto: TopicDto) {
    return this.notifications.subscribeTopic(userId, dto.topic, false);
  }
}
