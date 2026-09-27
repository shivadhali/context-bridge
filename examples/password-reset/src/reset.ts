import { findAccount, updatePassword } from './store';

/** Validate the demo reset token. Expiry checking is deliberately pending. */
export function validateToken(token: string) {
  const account = findAccount(token);
  if (!account) throw new Error('Invalid token');
  return account;
}

/** Update the demo account password after validating its reset token. */
export function resetPassword(token: string, password: string) {
  const account = validateToken(token);
  return updatePassword(account.id, password);
}
