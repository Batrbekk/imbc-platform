import { Module } from '@nestjs/common';
import { DiligenceController } from './diligence.controller.js';
import { DiligenceService } from './diligence.service.js';
@Module({ controllers: [DiligenceController], providers: [DiligenceService], exports: [DiligenceService] })
export class DiligenceModule {}
