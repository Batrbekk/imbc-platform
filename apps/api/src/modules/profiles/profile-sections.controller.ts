import { profileFileHistoryQuerySchema, unknownSectionSaveInputSchema } from '@imbc/contracts';
import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ProfileSectionsService } from './profile-sections.service.js';
import { sectionValidationError } from './section-errors.js';

/** GEN-11: the only profile selector is the current account organisation. */
@ApiTags('profiles')
@Controller('v1/profiles/own/sections')
export class ProfileSectionsController {
  constructor(private readonly sections: ProfileSectionsService) {}

  @Get()
  @Can('profile.read')
  overview(@Auth() auth: AuthContext, @Req() req: Request) {
    return this.sections.overview(auth.user, auditIp(req));
  }

  @Get(':kind')
  @Can('profile.read')
  read(@Auth() auth: AuthContext, @Param('kind') kind: string, @Req() req: Request) {
    return this.sections.read(auth.user, kind, auditIp(req));
  }

  @Put(':kind')
  @Can('profile.edit')
  save(@Auth() auth: AuthContext, @Param('kind') kind: string, @Body() body: unknown, @Req() req: Request) {
    const parsed = unknownSectionSaveInputSchema.safeParse(body);
    if (!parsed.success) throw sectionValidationError(parsed.error);
    return this.sections.save(auth.user, kind, parsed.data, auditIp(req));
  }

  @Get(':kind/files/history')
  @Can('profile.read')
  fileHistory(@Auth() auth: AuthContext, @Param('kind') kind: string, @Query() query: unknown, @Req() req: Request) {
    const parsed = profileFileHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw sectionValidationError(parsed.error);
    return this.sections.fileHistory(auth.user, kind, parsed.data, auditIp(req));
  }

  @Get(':kind/choices')
  @Can('profile.edit')
  editorChoices(@Auth() auth: AuthContext, @Param('kind') kind: string, @Req() req: Request) {
    return this.sections.editorChoices(auth.user, kind, auditIp(req));
  }
}
