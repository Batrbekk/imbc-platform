import type { Role } from '@imbc/contracts';
import type { Env } from '../../config/env.js';

export const DEVELOPMENT_OTP_CODE = '000000';
/** Marks persisted test codes so disabling the feature also invalidates outstanding codes. */
export const DEVELOPMENT_OTP_HASH_PREFIX = 'dev-otp-v1:';

export function otpDeliveryFor(
  env: Pick<Env, 'DEPLOYMENT_ENV' | 'DEV_FIXED_OTP_ENABLED' | 'DEV_FIXED_OTP_USER_ID'>,
  account: { id: string; role: Role },
): 'email' | 'development_code' {
  return env.DEPLOYMENT_ENV === 'development' &&
    env.DEV_FIXED_OTP_ENABLED === true &&
    Boolean(env.DEV_FIXED_OTP_USER_ID) &&
    account.id === env.DEV_FIXED_OTP_USER_ID &&
    account.role === 'administrator'
    ? 'development_code'
    : 'email';
}
