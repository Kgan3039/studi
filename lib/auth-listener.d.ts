export declare function subscribeToIdTokenState<TAuth, TUser>(
  auth: TAuth,
  onIdTokenChanged: (
    auth: TAuth,
    listener: (user: TUser | null) => void
  ) => () => void,
  listener: (user: TUser | null) => void
): () => void;
