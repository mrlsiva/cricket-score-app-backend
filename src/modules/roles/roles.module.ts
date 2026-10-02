import { Global, Module } from '@nestjs/common';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Global()
@Module({
  controllers: [RolesController],
  providers: [RolesService, AuthUserLoader],
  exports: [RolesService, AuthUserLoader],
})
export class RolesModule {}
