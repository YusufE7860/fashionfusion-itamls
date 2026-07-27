import { Module } from '@nestjs/common';
import { RemoteController } from './remote.controller';

@Module({ controllers: [RemoteController] })
export class RemoteModule {}
