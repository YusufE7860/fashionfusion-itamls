import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RmmController } from './rmm.controller';
import { RmmService } from './rmm.service';
import { RmmGateway } from './rmm.gateway';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [
    DiscoveryModule,            // exports ApiKeysService used by the WS gateway
    JwtModule.register({        // same signing key as AuthModule so viewer tokens verify
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '1d' },
    }),
  ],
  controllers: [RmmController],
  providers: [RmmService, RmmGateway],
  exports: [RmmGateway],
})
export class RmmModule {}
