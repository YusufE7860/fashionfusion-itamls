import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { TwofaService } from './twofa.service';
import { UsersModule } from '../users/users.module';
import { ForgotPasswordService } from './forgot-password.service';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '1d' },
    }),
    UsersModule,
    MailerModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TwofaService, ForgotPasswordService],
  exports: [AuthService, TwofaService],
})
export class AuthModule {}
