import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";

// Debug helper: used to verify Firestore connectivity during development.
// Not used in production flows; safe to remove if no longer needed.
export async function testFirestoreWrite() {
  console.log("testFirestoreWrite started");

  try {
    const docRef = await addDoc(collection(db, "testCollection"), {
      message: "Firebase is connected",
      status: "debug-write",
      createdAtClient: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });

    console.log("Document written with ID:", docRef.id);
    return {
      ok: true,
      id: docRef.id,
      collection: "testCollection",
    };
  } catch (error) {
    console.error("Error adding document:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Firestore error",
    };
  }
}
