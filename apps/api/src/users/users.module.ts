import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { NavPrefsController } from './nav-prefs.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, NavPrefsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
