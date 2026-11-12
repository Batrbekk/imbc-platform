import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('profiles')
@Controller('v1/profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  /**
   * Свой профиль производителя, только для чтения (MAN-46, IMBC-22). Id из запроса не принимается:
   * профиль ищется только по организации сеанса (GEN-11).
   */
  @Get('own')
  @Can('profile.read')
  own(@Auth() auth: AuthContext) {
    return this.profiles.own(auth.user.organizationId);
  }

  /**
   * Чтение Adata своего профиля: состояние и предзаполненные значения с источником (MAN-06, MAN-07).
   * Только для чтения: Adata не вызывается, попытка не создаётся. Id из запроса не принимается — в ответе
   * ФИО руководителя и учредители, их видит только производитель (GEN-11, ADM-06).
   */
  @Get('own/adata')
  @Can('profile.read')
  ownAdata(@Auth() auth: AuthContext) {
    return this.profiles.ownAdata(auth.user.organizationId);
  }
}
