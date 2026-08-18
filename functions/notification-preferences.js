const PREF_KEY_BY_NOTIFICATION_TYPE = {
  dm_message: 'dmMessages',
  session_joined: 'sessionActivity',
  session_updated: 'sessionActivity',
  session_cancelled: 'sessionActivity',
  session_reminder: 'sessionReminders',
  group_message: 'groupMessages',
  friend_request: 'friendRequests',
  friend_accepted: 'friendRequests',
};

function preferenceAllowsPush(settings, notificationType) {
  const prefKey = PREF_KEY_BY_NOTIFICATION_TYPE[notificationType];
  return settings?.notificationPrefs?.[prefKey] !== false;
}

async function loadPushPreference({ notificationType, readSettings, onReadError }) {
  try {
    return preferenceAllowsPush(await readSettings(), notificationType);
  } catch (error) {
    onReadError?.(error);
    return false;
  }
}

module.exports = {
  PREF_KEY_BY_NOTIFICATION_TYPE,
  loadPushPreference,
  preferenceAllowsPush,
};
