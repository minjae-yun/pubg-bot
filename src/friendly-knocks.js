export function countFriendlyKnocks(events, accountIds) {
  return countFriendlyKnockStats(events, accountIds).inflicted;
}

export function countFriendlyKnockStats(events, accountIds) {
  const trackedAccounts = new Set(accountIds.filter(Boolean));
  const inflicted = new Map([...trackedAccounts].map((accountId) => [accountId, 0]));
  const received = new Map([...trackedAccounts].map((accountId) => [accountId, 0]));
  const seenKnocks = new Set();

  for (const event of events ?? []) {
    if (event?._T !== "LogPlayerMakeGroggy") {
      continue;
    }

    const attacker = event.attacker;
    const victim = event.victim;

    if (
      !attacker?.accountId ||
      !victim?.accountId ||
      attacker.accountId === victim.accountId ||
      attacker.teamId === undefined ||
      attacker.teamId !== victim.teamId
    ) {
      continue;
    }

    const knockKey = [
      event.dBNOId ?? event.attackId ?? event._D,
      attacker.accountId,
      victim.accountId,
    ].join(":");

    if (seenKnocks.has(knockKey)) {
      continue;
    }

    seenKnocks.add(knockKey);

    if (trackedAccounts.has(attacker.accountId)) {
      inflicted.set(
        attacker.accountId,
        (inflicted.get(attacker.accountId) ?? 0) + 1,
      );
    }

    if (trackedAccounts.has(victim.accountId)) {
      received.set(victim.accountId, (received.get(victim.accountId) ?? 0) + 1);
    }
  }

  return { inflicted, received };
}
