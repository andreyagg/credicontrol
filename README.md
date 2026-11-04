# CrediControl

CrediControl is a static web application. The site is served from `index.html`; it does not need a build step or a Node.js server to run on Vercel.

## Deploy to Vercel

1. Push the project files to a GitHub repository. Include `index.html`, `firebase.json`, `firestore.rules`, `storage.rules`, and `.firebaserc`.
2. In Vercel, choose **Add New → Project** and import the GitHub repository.
3. Use these project settings:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** leave empty
   - **Output Directory:** leave empty
   - **Install Command:** leave empty
4. Deploy. Vercel will serve `index.html` from the project root.

No Vercel environment variables are required: Firebase is initialized in the browser. The Firebase web configuration in `index.html` identifies the project; it is not a service-account credential. Do not put service-account keys, private keys, passwords, customer exports, or other private data in this repository.

## Firebase setup

The app uses Firebase Authentication, Cloud Firestore, and Cloud Storage.

1. In the Firebase console for the project selected in `.firebaserc`, enable **Email/Password** under Authentication providers.
2. Create or enable the Firestore database and Firebase Storage bucket.
3. From this project directory, authenticate the Firebase CLI and deploy the repository's rules:

   ```powershell
   firebase login
   firebase deploy --only firestore:rules,storage
   ```

   Check `.firebaserc` before deploying: it selects the Firebase project that will receive the rules.
4. After the first Vercel deployment, add its domain (for example, `your-project.vercel.app`) to **Firebase Authentication → Settings → Authorized domains**. Add any custom domain there as well.
5. Test account creation, sign-in, client/loan synchronization, and file upload with the deployed site before entering real customer information.

The Firestore and Storage rules authorize only signed-in users using the Email/Password provider and scope records/files to that user's UID. Keep these rules deployed; the Firebase web configuration alone does not protect customer data.

## Existing data

Data already synced to Firebase remains associated with the same Firebase account. Browser-only data is isolated by browser origin, so it does not automatically move from a local `file://` copy to the Vercel domain. Before switching, sign in to the local app while online and confirm it reports that Firebase is connected and has finished syncing. The app's JSON backup is an export, not an import tool; keep it in a safe location and do not commit it to GitHub.
