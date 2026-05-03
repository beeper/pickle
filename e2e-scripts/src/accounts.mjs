import { readFile } from "node:fs/promises";
import { ACCOUNTS_PATH, HOMESERVER_URL } from "./config.mjs";

export async function loadAccounts(count) {
  const data = JSON.parse(await readFile(ACCOUNTS_PATH, "utf8"));
  const accounts = Array.isArray(data) ? data : data.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error(`Expected ${ACCOUNTS_PATH} to contain an accounts array`);
  }
  if (accounts.length < count) {
    throw new Error(`Expected at least ${count} E2E accounts in ${ACCOUNTS_PATH}, found ${accounts.length}`);
  }
  return accounts.slice(0, count).map(normalizeAccount);
}

function normalizeAccount(account) {
  const homeserverUrl = account.homeserverUrl ?? account.homeserver ?? HOMESERVER_URL;
  return {
    ...account,
    homeserverUrl,
  };
}
