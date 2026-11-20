import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { TwofaService } from './twofa.service';
import { UsersService } from '../users/users.service';
import { Public } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ForgotPasswordService } from './forgot-password.service';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
  @IsOptional() @IsString() totpToken?: string;
}
class VerifyTotpDto {
  @IsString() token!: string;
}
class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}
class ForgotPasswordDto {
  @IsEmail() email!: string;
}
class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private twofa: TwofaService,
    private users: UsersService,
    private forgot: ForgotPasswordService,
  ) {}

  /** Start the forgot-password flow. Always returns 200 - never leaks
   *  whether the email exists. Email is sent out-of-band if match + active. */
  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.forgot.requestReset(dto.email, ip);
  }

  /** Consume the reset token from the email link and set a new password. */
  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.forgot.consumeReset(dto.token, dto.newPassword);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, dto.totpToken);
  }

  @Get('me')
  me(@CurrentUser('sub') sub: string) {
    return this.auth.me(sub);
  }

  @Post('2fa/setup')
  setup(@CurrentUser('sub') sub: string) {
    return this.twofa.setup(sub);
  }

  @Post('2fa/verify-and-enable')
  verifyAndEnable(@CurrentUser('sub') sub: string, @Body() dto: VerifyTotpDto) {
    return this.twofa.verifyAndEnable(sub, dto.token);
  }

  @Post('2fa/disable')
  disable(@CurrentUser('sub') sub: string) {
    return this.twofa.disable(sub);
  }

  /**
   * Self-service password change — used to satisfy the mustChangePassword
   * flag after an admin creates the user or resets their password. Also
   * available for a user changing their own password proactively.
   */
  @Post('change-password')
  changePassword(@CurrentUser('sub') sub: string, @Body() dto: ChangePasswordDto) {
    return this.users.changeOwnPassword(sub, dto.currentPassword, dto.newPassword);
  }
}
