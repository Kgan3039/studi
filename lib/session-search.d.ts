export type SearchableSession = {
  classId: string;
  hostName: string;
  locationName: string;
  sessionId: string;
  title: string;
};

export function searchSessionsInList<T extends SearchableSession>(sessions: T[], query: string): T[];