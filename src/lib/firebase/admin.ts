import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as auth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getConfig } from "../config";
import { AppError } from "../errors";
function app() {
  const c = getConfig();
  if (!c.FIREBASE_PROJECT_ID) throw new AppError("AUTH_NOT_READY", 503);
  const emulator =
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (
    emulator &&
    (!c.local ||
      !c.FIREBASE_PROJECT_ID.startsWith("demo-") ||
      process.env.NODE_ENV === "production")
  )
    throw new AppError("AUTH_NOT_READY", 503);
  if (!emulator && (!c.FIREBASE_CLIENT_EMAIL || !c.FIREBASE_PRIVATE_KEY))
    throw new AppError("AUTH_NOT_READY", 503);
  return (
    getApps()[0] ??
    initializeApp(
      emulator
        ? { projectId: c.FIREBASE_PROJECT_ID }
        : {
            projectId: c.FIREBASE_PROJECT_ID,
            credential: cert({
              projectId: c.FIREBASE_PROJECT_ID,
              clientEmail: c.FIREBASE_CLIENT_EMAIL,
              privateKey: c.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            }),
          },
    )
  );
}
export const getDb = () => getFirestore(app());
export const getAuth = () => auth(app());
