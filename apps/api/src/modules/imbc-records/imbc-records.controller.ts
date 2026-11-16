import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ImbcRecordsService } from './imbc-records.service.js';

@ApiTags('imbc-records')
@Controller('v1/profiles/:profileId/imbc-notes')
export class ImbcNotesController {
  constructor(private readonly records: ImbcRecordsService) {}
  @Get() @Can('imbc_records.read') list(@Auth() a: AuthContext,@Param('profileId') p: string,@Query() q: unknown,@Req() r: Request) { return this.records.listNotes(a.user,p,q,auditIp(r)); }
  @Post() @Can('imbc_records.edit') create(@Auth() a: AuthContext,@Param('profileId') p: string,@Body() b: unknown,@Headers('idempotency-key') k: unknown,@Req() r: Request) { return this.records.createNote(a.user,p,b,k,auditIp(r)); }
  @Get(':recordId') @Can('imbc_records.read') read(@Auth() a: AuthContext,@Param('profileId') p: string,@Param('recordId') id: string,@Req() r: Request) { return this.records.read(a.user,p,'note',id,auditIp(r)); }
  @Put(':recordId') @Can('imbc_records.edit') update(@Auth() a: AuthContext,@Param('profileId') p: string,@Param('recordId') id: string,@Body() b: unknown,@Headers('idempotency-key') k: unknown,@Req() r: Request) { return this.records.updateNote(a.user,p,id,b,k,auditIp(r)); }
  @Get(':recordId/history') @Can('imbc_records.read') history(@Auth() a: AuthContext,@Param('profileId') p: string,@Param('recordId') id: string,@Query() q: unknown,@Req() r: Request) { return this.records.history(a.user,p,'note',id,q,auditIp(r)); }
}
@ApiTags('imbc-records')
@Controller('v1/profiles/:profileId/imbc-engagement')
export class ImbcEngagementController {
  constructor(private readonly records: ImbcRecordsService) {}
  @Get() @Can('imbc_records.read') read(@Auth() a: AuthContext,@Param('profileId') p: string,@Req() r: Request) { return this.records.read(a.user,p,'engagement',p,auditIp(r)); }
  @Put() @Can('imbc_records.edit') put(@Auth() a: AuthContext,@Param('profileId') p: string,@Body() b: unknown,@Headers('idempotency-key') k: unknown,@Req() r: Request) { return this.records.putEngagement(a.user,p,b,k,auditIp(r)); }
  @Get('history') @Can('imbc_records.read') history(@Auth() a: AuthContext,@Param('profileId') p: string,@Query() q: unknown,@Req() r: Request) { return this.records.history(a.user,p,'engagement',p,q,auditIp(r)); }
}
@ApiTags('imbc-records')
@Controller('v1/profiles/:profileId/products/:productIdentityId/imbc-context')
export class ImbcProductContextController {
  constructor(private readonly records: ImbcRecordsService) {}
  @Get() @Can('imbc_records.read') read(@Auth() a: AuthContext,@Param('profileId') p: string,@Param('productIdentityId') id: string,@Req() r: Request) { return this.records.read(a.user,p,'product_context',id,auditIp(r)); }
  @Put() @Can('imbc_records.edit') put(@Auth() a: AuthContext,@Param('profileId') p: string,@Param('productIdentityId') id: string,@Body() b: unknown,@Headers('idempotency-key') k: unknown,@Req() r: Request) { return this.records.putProductContext(a.user,p,id,b,k,auditIp(r)); }
  @Get('history') @Can('imbc_records.read') history(@Auth() a: AuthContext,@Param('profileId') p: string,@Param('productIdentityId') id: string,@Query() q: unknown,@Req() r: Request) { return this.records.history(a.user,p,'product_context',id,q,auditIp(r)); }
}
@ApiTags('imbc-records')
@Controller('v1/profiles/:profileId/imbc-records')
export class ImbcRecordsOptionsController {
  constructor(private readonly records: ImbcRecordsService) {}
  @Get('product-options') @Can('imbc_records.read') products(@Auth() a: AuthContext,@Param('profileId') p: string,@Query() q: unknown,@Req() r: Request) { return this.records.productOptions(a.user,p,q,auditIp(r)); }
  @Get('context-products') @Can('imbc_records.read') contexts(@Auth() a: AuthContext,@Param('profileId') p: string,@Query() q: unknown,@Req() r: Request) { return this.records.contextProducts(a.user,p,q,auditIp(r)); }
  @Get('reference-options/:dictionaryCode') @Can('imbc_records.read') references(@Auth() a: AuthContext,@Param('profileId') p: string,@Param('dictionaryCode') c: string,@Query() q: unknown,@Req() r: Request) { return this.records.referenceOptions(a.user,p,c,q,auditIp(r)); }
}
