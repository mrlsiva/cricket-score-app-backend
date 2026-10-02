import { Global, Module } from '@nestjs/common';
import { LiveGateway } from './live.gateway';
import { LiveService } from './live.service';

@Global()
@Module({
  providers: [LiveGateway, LiveService],
  exports: [LiveService],
})
export class LiveModule {}
