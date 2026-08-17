import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  areMessageSourcesLoaded,
  dedupeMessageRows,
  isMessageRowVisible,
} = require("../lib/message-history.js");
const {
  REMOVE_CHAT_FAILURE_MESSAGE,
  REMOVE_CHAT_FAILURE_TITLE,
  REMOVE_CHAT_MESSAGE,
  REMOVE_CHAT_TITLE,
  confirmChatRemoval,
  showChatRemovalFailure,
} = require("../lib/confirm-chat-removal.js");

describe("Messages beta history helpers", () => {
  it("deduplicates stable DM and group keys while preserving first-seen order", () => {
    const rows = dedupeMessageRows([
      { type: "group", id: "same", label: "Group first" },
      { type: "dm", id: "same", label: "DM" },
      { type: "group", id: "same", label: "Group duplicate" },
      { type: "group", id: "other", label: "Other group" },
    ]);

    assert.deepEqual(rows.map((row) => row.label), ["Group first", "DM", "Other group"]);
  });

  it("ignores malformed rows instead of creating unstable keys", () => {
    assert.deepEqual(
      dedupeMessageRows([null, {}, { type: "other", id: "x" }, { type: "dm", id: 3 }]),
      []
    );
  });

  it("waits for direct, group, and hidden-chat sources", () => {
    assert.equal(areMessageSourcesLoaded({ dm: true, group: true, hidden: true }), true);
    assert.equal(areMessageSourcesLoaded({ dm: true, group: false, hidden: true }), false);
    assert.equal(areMessageSourcesLoaded({ dm: false, group: true, hidden: true }), false);
    assert.equal(areMessageSourcesLoaded({ dm: true, group: true, hidden: false }), false);
  });

  it("keeps a hidden row hidden even when its message data changes", () => {
    const oldMessage = { type: "group", isHidden: true, isPendingRemoval: false, timestamp: 1 };
    const newerMessage = { ...oldMessage, timestamp: 2 };

    assert.equal(isMessageRowVisible(oldMessage), false);
    assert.equal(isMessageRowVisible(newerMessage), false);
    assert.equal(
      isMessageRowVisible({ type: "group", isHidden: false, isPendingRemoval: false }),
      true
    );
  });

  it("hides optimistic group removals without affecting direct messages", () => {
    assert.equal(
      isMessageRowVisible({ type: "group", isHidden: false, isPendingRemoval: true }),
      false
    );
    assert.equal(
      isMessageRowVisible({ type: "dm", isHidden: true, isPendingRemoval: true }),
      true
    );
  });
});

describe("Remove from my Messages confirmation", () => {
  it("uses the native alert and writes only after Remove", () => {
    let alertArgs;
    let writes = 0;
    confirmChatRemoval({
      platform: "ios",
      showNativeAlert: (...args) => { alertArgs = args; },
      showWebConfirm: () => { throw new Error("web confirm should not run"); },
      onConfirm: () => { writes += 1; },
    });

    assert.equal(alertArgs[0], REMOVE_CHAT_TITLE);
    assert.equal(alertArgs[1], REMOVE_CHAT_MESSAGE);
    assert.equal(writes, 0);
    alertArgs[2][0].onPress?.();
    assert.equal(writes, 0);
    alertArgs[2][1].onPress();
    assert.equal(writes, 1);
  });

  it("uses window confirmation on web and writes only when accepted", () => {
    const prompts = [];
    let writes = 0;
    const options = {
      platform: "web",
      showNativeAlert: () => { throw new Error("native alert should not run"); },
      showWebConfirm: (message) => {
        prompts.push(message);
        return false;
      },
      onConfirm: () => { writes += 1; },
    };

    confirmChatRemoval(options);
    assert.deepEqual(prompts, [`${REMOVE_CHAT_TITLE}\n\n${REMOVE_CHAT_MESSAGE}`]);
    assert.equal(writes, 0);

    confirmChatRemoval({ ...options, showWebConfirm: () => true });
    assert.equal(writes, 1);
  });
});

describe("Remove from my Messages failure feedback", () => {
  it("uses the native alert port with fixed safe copy", async () => {
    const alerts = [];

    await showChatRemovalFailure({
      platform: "ios",
      showNativeAlert: (...args) => { alerts.push(args); },
      showWebAlert: () => { throw new Error("web alert should not run"); },
    });

    assert.deepEqual(alerts, [[REMOVE_CHAT_FAILURE_TITLE, REMOVE_CHAT_FAILURE_MESSAGE]]);
  });

  it("uses the web alert port with the same fixed safe copy", async () => {
    const alerts = [];

    await showChatRemovalFailure({
      platform: "web",
      showNativeAlert: () => { throw new Error("native alert should not run"); },
      showWebAlert: (message) => { alerts.push(message); },
    });

    assert.deepEqual(
      alerts,
      [`${REMOVE_CHAT_FAILURE_TITLE}\n\n${REMOVE_CHAT_FAILURE_MESSAGE}`]
    );
  });

  it("never rejects when an alert adapter throws or rejects", async () => {
    await showChatRemovalFailure({
      platform: "ios",
      showNativeAlert: () => { throw new Error("native adapter failed"); },
      showWebAlert: () => {},
    });
    await showChatRemovalFailure({
      platform: "web",
      showNativeAlert: () => {},
      showWebAlert: () => Promise.reject(new Error("web adapter failed")),
    });
  });
});

describe("Messages beta production wiring", () => {
  const firestoreSource = readFileSync("lib/firestore.ts", "utf8");
  const messagesSource = readFileSync("app/(tabs)/messages.tsx", "utf8");
  const conversationSource = readFileSync("app/conversation/[conversationId].tsx", "utf8");
  const confirmationSource = readFileSync("lib/confirm-chat-removal.js", "utf8");
  const firestoreIndexes = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
  const groupQuery = firestoreSource.slice(
    firestoreSource.indexOf("export function subscribeToUserGroupChats"),
    firestoreSource.indexOf("export function subscribeToHiddenChats")
  );

  it("uses one bounded participant query and excludes zero-message sessions", () => {
    assert.match(groupQuery, /where\("participantIds", "array-contains", userId\)/);
    assert.match(groupQuery, /orderBy\("lastMessageAt", "desc"\)/);
    assert.match(groupQuery, /limit\(GROUP_CHAT_LIST_LIMIT\)/);
    assert.doesNotMatch(groupQuery, /lastMessagePreview|chatLifecycle|retention/);
    assert.match(firestoreSource, /if \(!lastMessageAt\) \{\s*return null;/);
  });

  it("declares the composite index used by the bounded session-chat query", () => {
    assert.equal(
      firestoreIndexes.indexes.some((index) =>
        index.collectionGroup === "sessions" &&
        index.queryScope === "COLLECTION" &&
        index.fields.some((field) =>
          field.fieldPath === "participantIds" && field.arrayConfig === "CONTAINS"
        ) &&
        index.fields.some((field) =>
          field.fieldPath === "lastMessageAt" && field.order === "DESCENDING"
        )
      ),
      true
    );
  });

  it("refreshes every source and reports only a fixed safe load error", () => {
    const refreshBody = messagesSource.slice(
      messagesSource.indexOf("function handleRefresh"),
      messagesSource.indexOf("const allChats")
    );
    assert.match(refreshBody, /setIsDmLoading\(true\)/);
    assert.match(refreshBody, /setIsGroupLoading\(true\)/);
    assert.match(refreshBody, /setIsHistoryLoading\(true\)/);
    assert.match(messagesSource, /We couldn't load your conversations\./);
    assert.doesNotMatch(messagesSource, /setHasLoadError\(error\.message\)/);
  });

  it("keeps failed removals visible and uses safe user-facing copy", () => {
    const removalBody = messagesSource.slice(
      messagesSource.indexOf("async function handleRemoveSessionChat"),
      messagesSource.indexOf("function confirmRemoveSessionChat")
    );
    assert.match(removalBody, /catch \{/);
    assert.match(removalBody, /next\.delete\(key\)/);
    assert.match(removalBody, /await showChatRemovalFailure/);
    assert.doesNotMatch(removalBody, /error\.message/);
    assert.equal(
      (removalBody.match(/removeSessionChatFromUserHistory/g) ?? []).length,
      1
    );
  });

  it("offers an accessible swipe removal action with confirmation", () => {
    assert.match(messagesSource, /accessibilityLabel={`Remove \$\{otherName\} from my Messages`}/);
    assert.match(confirmationSource, /Remove from my Messages\?/);
    assert.match(confirmationSource, /This hides the chat only for you\./);
    assert.match(confirmationSource, /style: "cancel"/);
    assert.match(confirmationSource, /style: "destructive"/);
    assert.doesNotMatch(messagesSource, /<IconButton/);
    assert.match(messagesSource, /platform: Platform\.OS/);
    assert.match(messagesSource, /window\.confirm\(message\)/);
  });

  it("keeps the direct-message branch free of hidden-marker and removal behavior", () => {
    const rowRendering = messagesSource.slice(messagesSource.indexOf("visibleChats.map"));
    const directMessageBranch = rowRendering.slice(
      rowRendering.indexOf('if (chat.type === "dm")'),
      rowRendering.indexOf("const removalKey = sessionChatHistoryKey")
    );
    assert.match(directMessageBranch, /conversation\/\[conversationId\]/);
    assert.doesNotMatch(directMessageBranch, /hiddenChats|confirmRemove|IconButton|Swipeable/);
    assert.doesNotMatch(firestoreSource, /chatType: "dm"/);
    assert.match(firestoreSource, /where\("chatType", "==", "group"\)/);
  });

  it("returns a blocked conversation through the existing Messages tab", () => {
    const blockBody = conversationSource.slice(
      conversationSource.indexOf("async function handleBlockUser"),
      conversationSource.indexOf("async function handleUnblockUser")
    );

    assert.match(blockBody, /router\.navigate\('\/messages'\)/);
    assert.doesNotMatch(blockBody, /router\.(dismissTo|replace)\('\/messages'\)/);
  });
});
