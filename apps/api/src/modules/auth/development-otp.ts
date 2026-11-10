import type { Role } from '@imbc/contracts';
import type { Env } from '../../config/env.js';

export const DEVELOPMENT_OTP_CODE = '000000';
/** Marks persisted test codes so disabling the feature also invalidates outstanding codes. */
export const DEVELOPMENT_OTP_HASH_PREFIX = 'dev-otp-v1:';

export function otpDeliveryFor(
  env: Pick<Env, 'DEPLOYMENT_ENV' | 'DEV_FIXED_OTP_ENABLED' | 'DEV_FIXED_OTP_USER_ID' | 'DEV_FIXED_OTP_ACCOUNTS'>,
  account: { id: string; role: Role },
): 'email' | 'development_code' {
  if (env.DEPLOYMENT_ENV !== 'development' || env.DEV_FIXED_OTP_ENABLED !== true) return 'email';
  const legacyAdministrator =
    Boolean(env.DEV_FIXED_OTP_USER_ID) && account.id === env.DEV_FIXED_OTP_USER_ID && account.role === 'administrator';
  const listedAccount = (env.DEV_FIXED_OTP_ACCOUNTS ?? []).some(
    (target) => target.id === account.id && target.role === account.role,
  );
  return legacyAdministrator || listedAccount ? 'development_code' : 'email';
}
