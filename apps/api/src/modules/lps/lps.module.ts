import { Module } from '@nestjs/common';
import { LpsController } from './lps.controller.js';
import { LpsService } from './lps.service.js';
@Module({ controllers: [LpsController], providers: [LpsService], exports: [LpsService] })
export class LpsModule {}
