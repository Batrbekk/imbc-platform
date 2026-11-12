import { Module } from '@nestjs/common';
import { PrototypeController } from './prototype.controller.js';
import { PrototypeService } from './prototype.service.js';

/** Общее состояние прототипа кабинетов (`prototype.controller.ts`); маршруты есть только при флаге. */
@Module({ controllers: [PrototypeController], providers: [PrototypeService] })
export class PrototypeModule {}
