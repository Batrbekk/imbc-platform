import { ProblemException } from '../../common/problem.js';

/** MAN-02 existing-BIN refusal belongs to the registration path, not generic administration invitations. */
export const registrationBinExists = () =>
  new ProblemException(409, 'bin_exists', 'Компания с этим БИН уже зарегистрирована', 'Обратитесь в IMBC');
