import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: "AIzaSyBRZxuRmYbcX9YrPZgCs9GPND9QV-sMUTc",
  authDomain: "studi-b02c3.firebaseapp.com",
  projectId: "studi-b02c3",
  storageBucket: "studi-b02c3.firebasestorage.app",
  messagingSenderId: "569084936595",
  appId: "1:569084936595:web:e068e42ad8b15f8b576866"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createAuth() {
  if (Platform.OS === "web") {
    return getAuth(app);
  }

  try {
    // Prefer persisted auth on native when AsyncStorage is installed.
    const { getReactNativePersistence } = require("firebase/auth");
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Fallback keeps the app working until native persistence is added.
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export default app;
