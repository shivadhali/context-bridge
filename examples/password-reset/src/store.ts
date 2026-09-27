/** Find an account by its reset token. */
export function findAccount(token: string) {
  return token === 'demo-token' ? { id: 'demo-account', expiresAt: 0 } : null;
}

/** Illustrative persistence stub; a real application must hash passwords before storage. */
export function updatePassword(accountId: string, password: string) {
  return { accountId, updated: password.length > 0 };
}
