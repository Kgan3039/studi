Cloud Function: deleteUserAccount

Purpose
- Callable function `deleteUserAccount` that performs admin-side cleanup of a user's Firestore data and deletes the Firebase Auth user. Use this instead of giving broad client-side delete permissions.

Deploy
1. From project root install functions deps:
```bash
cd functions
npm install
```
2. Login and select project (if not already):
```bash
npx firebase login
npx firebase use --add
```
3. Deploy the single function:
```bash
npx firebase deploy --only functions:deleteUserAccount
```

Client usage (callable function)
```js
import { getFunctions, httpsCallable } from 'firebase/functions';
const functions = getFunctions();
const fn = httpsCallable(functions, 'deleteUserAccount');
// reauthenticate the user on the client before calling (required by Firebase Auth recent-login policy)
await fn({ uid: auth.currentUser.uid });
```

Security notes
- The function allows the caller to delete their own account. Callers with `admin` custom claim can delete any account.
- Ensure only trusted callers receive admin custom claims.
- This function performs deletes and updates across multiple collections; for very large datasets you may need to paginate or add background tasks.
