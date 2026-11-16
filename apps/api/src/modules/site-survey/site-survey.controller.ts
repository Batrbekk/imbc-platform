import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { auditIp } from "../../common/audit-ip.js";
import type { AuthContext } from "../auth/auth.types.js";
import { Auth, Can } from "../auth/guards.js";
import { SiteSurveyService } from "./site-survey.service.js";
import { SiteSurveyRequestsService } from "./site-survey-requests.service.js";

@ApiTags("site-surveys")
@Controller("v1/profiles/:profileId/site-surveys")
export class SiteSurveyController {
  constructor(private readonly surveys: SiteSurveyService) {}
  @Get()
  @Can("imbc_records.read")
  list(
    @Auth() auth: AuthContext,
    @Param("profileId") id: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.surveys.list(auth.user, id, query, auditIp(req));
  }
  @Post()
  @Can("imbc_records.edit")
  create(
    @Auth() auth: AuthContext,
    @Param("profileId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Req() req: Request,
  ) {
    return this.surveys.create(auth.user, id, body, key, auditIp(req));
  }
  @Get(":recordId")
  @Can("imbc_records.read")
  read(
    @Auth() auth: AuthContext,
    @Param("profileId") id: string,
    @Param("recordId") record: string,
    @Req() req: Request,
  ) {
    return this.surveys.read(auth.user, id, record, auditIp(req));
  }
  @Put(":recordId")
  @Can("imbc_records.edit")
  update(
    @Auth() auth: AuthContext,
    @Param("profileId") id: string,
    @Param("recordId") record: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.surveys.update(auth.user, id, record, body, auditIp(req));
  }
  @Get(":recordId/history")
  @Can("imbc_records.read")
  history(
    @Auth() auth: AuthContext,
    @Param("profileId") id: string,
    @Param("recordId") record: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.surveys.history(auth.user, id, record, query, auditIp(req));
  }
}
@ApiTags("site-surveys")
@Controller("v1/profiles/:profileId/site-survey-requests")
export class OwnSiteSurveyRequestsController {
  constructor(private readonly requests: SiteSurveyRequestsService) {}
  @Get()
  @Can("tier.request")
  list(
    @Auth() auth: AuthContext,
    @Param("profileId") id: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.requests.ownList(auth.user, id, query, auditIp(req));
  }
  @Post()
  @Can("tier.request")
  request(
    @Auth() auth: AuthContext,
    @Param("profileId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Req() req: Request,
  ) {
    return this.requests.request(auth.user, id, body, key, auditIp(req));
  }
}
@ApiTags("site-surveys")
@Controller("v1/site-survey-requests")
export class SiteSurveyRequestsController {
  constructor(private readonly requests: SiteSurveyRequestsService) {}
  @Get()
  @Can("imbc_records.read")
  list(
    @Auth() auth: AuthContext,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.requests.queue(auth.user, query, auditIp(req));
  }
}
