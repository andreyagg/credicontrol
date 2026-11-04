# CrediControl

CrediControl is a static web application hosted on Vercel. Client and loan records use Cloud Firestore, account access and password recovery use Firebase Authentication, and private receipts/documents are stored in Cloudflare R2 through an authenticated Cloudflare Worker.

## Deploy the site to Vercel

1. Import this GitHub repository into Vercel.
2. Select **Other** as the framework preset and leave the build, install, and output-directory settings empty.
3. Deploy the site. Vercel serves `index.html` from the repository root.
4. Copy the production origin, such as `https://credicontrol.vercel.app`, for the Cloudflare Worker configuration below.

## Install on iPhone

After Vercel has deployed the latest commit, open the HTTPS site directly in **Safari** on the iPhone. Tap **Share** → **Add to Home Screen** → **Add**. If iOS shows an **Open as Web App** option, leave it enabled. CrediControl then opens from its home-screen icon in a standalone app window.

The app still needs an internet connection to sign in and use Firebase/Cloudflare. The service worker caches only the static app shell and icons; it does not cache customer records or uploaded documents for offline use.

## Configure Firebase Authentication and Firestore

1. In the Firebase console for `micarteradeprestamos`, enable **Authentication → Sign-in method → Email/Password**.
2. Under **Authentication → Settings → Authorized domains**, add the Vercel production domain and any custom domain.
3. Ensure Cloud Firestore is enabled.
4. From the project root in Cloud Shell, deploy only Firestore rules:

   ```bash
   git clone https://github.com/andreyagg/credicontrol.git
   cd credicontrol
   firebase login
   firebase deploy --only firestore:rules
   ```

Password reset stays with Firebase Authentication. On the login screen, choose **Olvidé mi contraseña**, enter the account email, and follow the reset link Firebase sends. Configure the reset email template in **Firebase Authentication → Templates** if you want to customize its wording and sender.

## Configure Cloudflare R2 private file storage

The app does not use Firebase Storage. The R2 bucket is private and is accessed only through the Worker, which verifies Firebase ID tokens and restricts every object path to the authenticated user's UID. Do not make the bucket public or put Cloudflare API tokens in browser code.

The R2 S3 API endpoint shown in Cloudflare (for example, `https://<account-id>.r2.cloudflarestorage.com/<bucket>`) is not the app's API URL. Do not put that endpoint or S3 credentials in `storage-config.js`; the Worker accesses the bucket through its `FILES_BUCKET` binding.

1. In Cloudflare, open **R2 Object Storage** and create a private bucket. The current bucket in this account is named `credicontrol`; use that exact name in the Worker binding. The `pays` entry shown inside the bucket is only a folder/prefix, not the bucket name.
2. Edit `cloudflare/wrangler.toml`:
   - Set `ALLOWED_ORIGINS` to the exact Vercel production origin, without a trailing slash. You may comma-separate explicitly trusted custom domains. Do not use `*`.
   - Confirm `FIREBASE_PROJECT_ID` is `micarteradeprestamos`.
3. From the repository root, authenticate Wrangler and deploy the Worker:

   ```bash
   npx wrangler login
   npx wrangler deploy --config cloudflare/wrangler.toml
   ```

   The config binds the private bucket to the Worker. Copy the HTTPS `workers.dev` URL reported after deployment.
4. Put that URL in `storage-config.js` as the base URL:

   ```js
   window.CREDICONTROL_STORAGE_API_URL = 'https://credicontrol-storage.YOUR-SUBDOMAIN.workers.dev';
   ```

   Use the URL Wrangler actually reports; do not include a path, query string, or secret.
5. Commit and push the updated `cloudflare/wrangler.toml` and `storage-config.js` to GitHub. Vercel will redeploy the site. If you change Vercel domains, update `ALLOWED_ORIGINS` and redeploy the Worker.

Cloudflare R2 and Vercel usage may incur charges if included quotas are exceeded. Review the current [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [Vercel pricing](https://vercel.com/pricing), and set billing alerts where available.

## Existing files and data

Firestore records remain in Firebase. Files that existed only in a browser's IndexedDB can be migrated when that same browser signs in and synchronizes; older Firebase Storage files are not copied automatically to R2 and must be reattached or migrated separately. Browser-local data does not automatically transfer between a `file://` copy and the Vercel domain. The in-app JSON backup is an export only; store it securely and do not commit it to GitHub.
