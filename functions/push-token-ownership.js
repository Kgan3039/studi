const LEGACY_TOKEN_QUERY_LIMIT = 20;
const SAFE_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SERVER_GENERATION_AUTHORITY = "server-v1";

class PushTokenOwnershipConflictError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "PushTokenOwnershipConflictError";
    this.code = code;
    this.details = details;
  }
}

function tokenOwnerUid(ownerData) {
  return typeof ownerData?.userId === "string" ? ownerData.userId : null;
}

function isValidOptionalClientGeneration(value) {
  return value === undefined || (Number.isSafeInteger(value) && value > 0);
}

function tokenDocUid(ref, tokenHash) {
  const parts = typeof ref?.path === "string" ? ref.path.split("/") : [];
  if (
    parts.length !== 6 ||
    parts[0] !== "users" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(parts[1] ?? "") ||
    parts[2] !== "private" ||
    parts[3] !== "pushTokens" ||
    parts[4] !== "tokens" ||
    parts[5] !== tokenHash
  ) {
    return null;
  }
  return parts[1];
}

function isMatchingTokenDoc(snapshot, expoPushToken, tokenHash) {
  return (
    snapshot?.exists === true &&
    snapshot.data()?.expoPushToken === expoPushToken &&
    tokenDocUid(snapshot.ref, tokenHash) !== null
  );
}

function inspectLegacyOwners(snapshot, expoPushToken, tokenHash) {
  const owners = new Map();
  const malformedPaths = [];
  for (const doc of snapshot?.docs ?? []) {
    const data = doc.data?.();
    if (data?.expoPushToken !== expoPushToken || data?.enabled !== true) continue;
    const uid = tokenDocUid(doc.ref, tokenHash);
    if (!uid) {
      malformedPaths.push(doc.ref?.path ?? "unknown");
      continue;
    }
    owners.set(uid, doc.ref);
  }
  return { owners, malformedPaths };
}

function isCurrentRegistration(data, { uid, installationId, registrationId, generation, tokenHash }) {
  return (
    data?.userId === uid &&
    data?.installationId === installationId &&
    data?.registrationId === registrationId &&
    data?.generation === generation &&
    data?.tokenHash === tokenHash
  );
}

function isOwnerRegistration(data, { uid, installationId, registrationId, generation }) {
  return data?.userId === uid && data?.installationId === installationId &&
    data?.registrationId === registrationId && data?.generation === generation;
}

async function claimPushTokenOwnership({
  db,
  uid,
  expoPushToken,
  previousExpoPushToken,
  platform,
  projectId,
  installationId,
  registrationId,
  tokenHash,
  previousTokenHash,
  tokenRef,
  ownerRef,
  installationRef,
  installationRefFor,
  previousTokenRef,
  previousOwnerRef,
  deletionJobRef,
  now,
}) {
  const legacyQuery = db
    .collectionGroup("tokens")
    .where("expoPushToken", "==", expoPushToken)
    .limit(LEGACY_TOKEN_QUERY_LIMIT + 1);

  return db.runTransaction(async (tx) => {
    const [ownerSnap, destinationSnap, installationSnap, deletionJobSnap] = await Promise.all([
      tx.get(ownerRef),
      tx.get(tokenRef),
      tx.get(installationRef),
      tx.get(deletionJobRef),
    ]);

    if (deletionJobSnap.exists) {
      throw new PushTokenOwnershipConflictError("account-deletion-exists");
    }

    const ownerData = ownerSnap.exists ? ownerSnap.data() : null;
    let priorOwnerUid = tokenOwnerUid(ownerData);
    if (ownerSnap.exists && priorOwnerUid === null) {
      throw new PushTokenOwnershipConflictError("malformed-ownership-registry");
    }
    let priorOwnerRef = priorOwnerUid
      ? db.doc(`users/${priorOwnerUid}/private/pushTokens/tokens/${tokenHash}`)
      : null;

    if (!ownerSnap.exists) {
      const legacySnapshot = await tx.get(legacyQuery);
      if (legacySnapshot.docs.length > LEGACY_TOKEN_QUERY_LIMIT) {
        throw new PushTokenOwnershipConflictError("legacy-token-result-limit", {
          documentPaths: legacySnapshot.docs.map((doc) => doc.ref.path),
        });
      }
      const legacy = inspectLegacyOwners(legacySnapshot, expoPushToken, tokenHash);
      if (legacy.malformedPaths.length > 0) {
        throw new PushTokenOwnershipConflictError("malformed-legacy-ownership", {
          documentPaths: legacy.malformedPaths,
        });
      }
      if (legacy.owners.size > 1) {
        throw new PushTokenOwnershipConflictError("ambiguous-legacy-ownership", {
          documentPaths: [...legacy.owners.values()].map((ref) => ref.path),
        });
      }
      if (legacy.owners.size === 1) {
        [priorOwnerUid, priorOwnerRef] = legacy.owners.entries().next().value;
      }
    }

    const installationData = installationSnap.exists ? installationSnap.data() : null;
    const hasServerGeneration = installationData?.generationAuthority === SERVER_GENERATION_AUTHORITY;
    if (
      installationSnap.exists &&
      (
        installationData?.installationId !== installationId ||
        !SAFE_OPERATION_ID_PATTERN.test(installationData?.registrationId ?? "") ||
        (hasServerGeneration &&
          (!Number.isSafeInteger(installationData?.generation) || installationData.generation < 1)) ||
        typeof installationData?.tokenHash !== "string" ||
        tokenOwnerUid(installationData) === null
      )
    ) {
      throw new PushTokenOwnershipConflictError("malformed-installation-registry");
    }
    const destinationData = destinationSnap.exists ? destinationSnap.data() : null;
    const isExistingOperation =
      destinationData?.installationId === installationId &&
      destinationData?.registrationId === registrationId &&
      destinationData?.generationAuthority === SERVER_GENERATION_AUTHORITY &&
      Number.isSafeInteger(destinationData?.generation) &&
      destinationData.generation > 0;
    const isCurrentOperation = isExistingOperation && hasServerGeneration &&
      isCurrentRegistration(installationData, {
        uid, installationId, registrationId, generation: destinationData.generation, tokenHash,
      });

    if (isExistingOperation && !isCurrentOperation) {
      throw new PushTokenOwnershipConflictError("stale-registration-operation");
    }
    if (
      installationData?.registrationId === registrationId &&
      installationData?.tokenHash !== tokenHash
    ) {
      throw new PushTokenOwnershipConflictError("registration-id-reused");
    }

    const currentServerGeneration = hasServerGeneration ? installationData.generation : 0;
    const generation = isCurrentOperation
      ? destinationData.generation
      : currentServerGeneration + 1;
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new PushTokenOwnershipConflictError("generation-exhausted");
    }

    const oldInstallationTokenHash = installationData?.tokenHash;
    const oldInstallationUid = tokenOwnerUid(installationData);
    const oldInstallationTokenRef = oldInstallationTokenHash
      ? db.doc(`users/${oldInstallationUid}/private/pushTokens/tokens/${oldInstallationTokenHash}`)
      : null;
    const oldInstallationOwnerRef = oldInstallationTokenHash
      ? db.doc(`pushTokenOwners/${oldInstallationTokenHash}`)
      : null;

    const priorInstallationId = typeof ownerData?.installationId === "string"
      ? ownerData.installationId
      : null;
    const priorInstallationRef = priorInstallationId
      ? installationRefFor(priorInstallationId)
      : null;

    const readRefs = [
      priorOwnerUid && priorOwnerUid !== uid ? priorOwnerRef : null,
      oldInstallationTokenHash && oldInstallationTokenHash !== tokenHash
        ? oldInstallationTokenRef
        : null,
      oldInstallationTokenHash && oldInstallationTokenHash !== tokenHash
        ? oldInstallationOwnerRef
        : null,
      priorInstallationRef && priorInstallationId !== installationId
        ? priorInstallationRef
        : null,
      previousTokenRef && previousOwnerRef && previousTokenHash !== tokenHash
        ? previousTokenRef
        : null,
      previousTokenRef && previousOwnerRef && previousTokenHash !== tokenHash
        ? previousOwnerRef
        : null,
    ];
    const readSnaps = [];
    for (const ref of readRefs) {
      readSnaps.push(ref ? await tx.get(ref) : null);
    }
    const [priorOwnerTokenSnap, oldInstallationTokenSnap, oldInstallationOwnerSnap,
      priorInstallationSnap, previousTokenSnap, previousOwnerSnap] = readSnaps;

    if (priorOwnerUid && priorOwnerUid !== uid && priorOwnerRef) {
      if (isMatchingTokenDoc(priorOwnerTokenSnap, expoPushToken, tokenHash)) {
        tx.update(priorOwnerRef, { enabled: false, updatedAt: now });
      }
      if (
        priorInstallationSnap?.exists &&
        isCurrentRegistration(priorInstallationSnap.data(), {
          uid: priorOwnerUid,
          installationId: priorInstallationId,
          registrationId: ownerData?.registrationId,
          generation: ownerData?.generation,
          tokenHash,
        })
      ) {
        tx.delete(priorInstallationRef);
      }
    }

    if (oldInstallationTokenHash && oldInstallationTokenHash !== tokenHash) {
      if (oldInstallationTokenSnap?.exists) {
        tx.update(oldInstallationTokenRef, { enabled: false, updatedAt: now });
      }
      if (
        oldInstallationOwnerSnap?.exists &&
        isOwnerRegistration(oldInstallationOwnerSnap.data(), {
          uid: oldInstallationUid,
          installationId,
          registrationId: installationData.registrationId,
          generation: installationData.generation,
        })
      ) {
        tx.delete(oldInstallationOwnerRef);
      }
    }

    if (previousTokenSnap?.exists && previousTokenHash !== oldInstallationTokenHash) {
      const previousRegistryData = previousOwnerSnap?.exists ? previousOwnerSnap.data() : null;
      if (
        isMatchingTokenDoc(previousTokenSnap, previousExpoPushToken, previousTokenHash) &&
        previousTokenSnap.data()?.installationId === installationId &&
        tokenOwnerUid(previousRegistryData) === uid &&
        previousRegistryData?.installationId === installationId
      ) {
        tx.update(previousTokenRef, { enabled: false, updatedAt: now });
        if (tokenOwnerUid(previousRegistryData) === uid) tx.delete(previousOwnerRef);
      }
    }

    tx.set(tokenRef, {
      expoPushToken,
      platform,
      projectId,
      installationId,
      registrationId,
      generation,
      generationAuthority: SERVER_GENERATION_AUTHORITY,
      enabled: true,
      createdAt: destinationSnap.exists ? destinationSnap.data()?.createdAt ?? now : now,
      updatedAt: now,
      lastSeenAt: now,
    }, { merge: true });
    tx.set(ownerRef, {
      userId: uid, installationId, registrationId, generation,
      generationAuthority: SERVER_GENERATION_AUTHORITY, updatedAt: now,
    });
    tx.set(installationRef, {
      userId: uid,
      installationId,
      registrationId,
      generation,
      generationAuthority: SERVER_GENERATION_AUTHORITY,
      tokenHash,
      updatedAt: now,
    });
    return { generation };
  });
}

async function releasePushTokenOwnership({
  db,
  uid,
  expoPushToken,
  installationId,
  registrationId,
  generation,
  tokenHash,
  tokenRef,
  ownerRef,
  installationRef,
  now,
}) {
  return db.runTransaction(async (tx) => {
    const [tokenSnap, ownerSnap, installationSnap] = await Promise.all([
      tx.get(tokenRef), tx.get(ownerRef), tx.get(installationRef),
    ]);
    const ownerData = ownerSnap.exists ? ownerSnap.data() : null;
    const current = isOwnerRegistration(ownerData, {
      uid, installationId, registrationId, generation,
    }) && isCurrentRegistration(installationSnap.exists ? installationSnap.data() : null, {
      uid, installationId, registrationId, generation, tokenHash,
    });
    const legacy = !ownerSnap.exists && !installationSnap.exists &&
      installationId === `legacy_${tokenHash}` &&
      registrationId === `legacy_${tokenHash}` &&
      isMatchingTokenDoc(tokenSnap, expoPushToken, tokenHash);

    if (!current && !legacy) return false;
    if (isMatchingTokenDoc(tokenSnap, expoPushToken, tokenHash)) {
      tx.update(tokenRef, { enabled: false, updatedAt: now });
    }
    if (current) {
      tx.delete(ownerRef);
      tx.delete(installationRef);
    }
    return true;
  });
}

module.exports = {
  LEGACY_TOKEN_QUERY_LIMIT,
  PushTokenOwnershipConflictError,
  SAFE_OPERATION_ID_PATTERN,
  SERVER_GENERATION_AUTHORITY,
  claimPushTokenOwnership,
  inspectLegacyOwners,
  isValidOptionalClientGeneration,
  releasePushTokenOwnership,
  tokenDocUid,
};
