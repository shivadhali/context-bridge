import { resetPassword } from './reset';

/** Handle a demo password-reset request; error mapping is pending. */
export function postReset(token: string, password: string) {
  return resetPassword(token, password);
}
