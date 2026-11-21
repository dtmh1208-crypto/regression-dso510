# Share Fieldnotes with Vercel + Supabase

This folder contains the React interface, Python API, deployment settings, and prepared metadata. The 320,546-row frozen Part 1 cohort keeps every original column. It lives as one compressed file in a private Supabase Storage bucket; browsers receive analysis results and a small plotting sample rather than the whole file.

Nothing has been uploaded or deployed by these preparation steps. You supply your own Supabase project and Vercel account settings.

## 1. Upload the data to Supabase

1. Create or open your Supabase project.
2. Open **Storage** and create a bucket named **fieldnotes-data**. Leave **Public bucket** switched **off**.
3. Set its file-size limit to **50 MB**. Do not restrict the allowed MIME types unless you allow gzip (`application/gzip` and possibly `application/x-gzip`).
4. Read `release/UPLOAD-THIS-FILE.txt`. Upload the exact `.csv.gz` file it names into the **root of the bucket**. Keep the file compressed and keep its name unchanged. Upload this file directly in Supabase, rather than through the Vercel app.
5. Find the project URL and the legacy **service_role** JWT under your project's API settings / API Keys / Legacy API Keys. The backend uses this server-side key to read the private file. This is different from an anon/publishable key and from a database password.

The generated manifest records the filename, compressed byte count, and SHA-256 checksum. The backend rejects a different or incomplete file. No public bucket, SQL table, public read policy, or Supabase Edge Function is needed.

Supabase documents a 50 MB maximum individual file size on Free projects: https://supabase.com/docs/guides/storage/uploads/file-limits

## 2. Put the application source in a Git repository

The handoff is `release/fieldnotes-github-folder.zip`. Extract it first, then drag the entire extracted **fieldnotes-vercel** folder into GitHub's Upload Files area. This preserves subfolders. Set Vercel's **Root Directory** to **fieldnotes-vercel**. That folder should contain `package.json`, `vercel.json`, `api/`, `assets/`, and `src/`.

Alternatively, push this `playground` folder as part of your existing repository. In Vercel, set **Root Directory** to `playground` in that case.

Do not add the raw CSV, `supabase-upload`, `node_modules`, `.env` files containing real keys, or the ZIP itself to the repository. The supplied `.gitignore` and `.vercelignore` exclude those generated/private paths. The small `assets/codebook.json` and `assets/dataset-manifest.json` **must** be included.

## 3. Import into Vercel

1. Import your GitHub repository into Vercel.
2. Set the Root Directory as described above.
3. Use **Other** as the Framework Preset. `vercel.json` deliberately disables framework autodetection so the static frontend and file-based Python function deploy together.
   The frontend **Install Command must be `npm install --include=dev`**, explicitly set by `vercel.json`. If configuring it in the dashboard, enable the Install Command Override and enter that value. With automatic install detection, Vercel's static builder also sees root-level `requirements.txt` and attempts a Python install using its build-image interpreter before the function builder can apply the API's Python version pin.
4. The provided configuration sets the build command to `npm run build:vercel` and output directory to `dist`. Keep these settings. Node 22 and Python 3.12 are specified in the files. **Commit both `pyproject.toml` and `.python-version` at the Vercel project root**. The latter must contain `3.12`; the former uses Vercel's documented `requires-python = "~=3.12.0"` constraint and requests prebuilt scientific-library wheels. If a browser upload skips hidden files, create `.python-version` directly in GitHub or use `scripts/Push-Deployment-Fix.ps1` from the original workspace to commit both files.
5. Add these variables under **Project Settings → Environment Variables**, for the deployment environments you plan to use:

| Name | Value |
|---|---|
| `DATASET_MODE` | `supabase` |
| `SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your backend-only legacy service_role JWT |
| `SUPABASE_STORAGE_BUCKET` | `fieldnotes-data` |
| `VERCEL_SUPPORT_LARGE_FUNCTIONS` | `1` |

Never prefix the Supabase service-role key with `VITE_`, paste it into React source, or commit it. Vercel passes it to the Python runtime. The frontend build does not read it.

6. Deploy. If you change an environment variable later, redeploy so the function receives it.

The app uses one Python function (`api/index.py`) with a 300-second maximum duration. A rewrite keeps the existing `/api/meta`, `/api/profile/...`, and `/api/analyze` paths. No always-running `python server.py` process is required on Vercel.

Vercel's documented API-directory handler format: https://vercel.com/docs/functions/runtimes/python/api-directory

## 4. Check the hosted app

1. Open `https://YOUR_DEPLOYMENT.vercel.app/api/health`. Expect `{"status":"ready","dataset_mode":"supabase"}`. This checks configuration presence; it does not download the dataset.
2. Open `/api/meta`. Expect 356,158 raw rows, 320,546 base rows, and the variable list.
3. Open `/api/profile/_AGE80`. The first data request retrieves and verifies the compressed dataset. Expect 0 missing ages, minimum 18, and maximum 80. Later warm requests reuse its temporary-file and column caches.
4. Open the frontend. Keep the defaults (sleep, mental health, employment, age) and select employment codes 1 and 2 for D=1. Run the models. Expect N=320,546, Model 1 slope approximately -0.8352043, and Model 2 slope approximately -0.7355498.
5. Change a control or cleaning rule, run again, and check equations, plots, and exports.

Your teammates can use the final Vercel URL without installing anything. Saved experiments still live in each user's browser; this setup does not add shared experiment storage or application sign-in. Configure deployment access in Vercel if you want to restrict who can open the app.

## Performance and troubleshooting

- Supabase stores the file; Vercel performs the regressions. No browser download of the full dataset is necessary.
- Each new Vercel instance may download the file once. `/tmp` files and in-memory caches are opportunistic, not durable or shared across instances. Supabase download/egress and Vercel compute quotas still apply.
- `503 configuration_required`: add the required Supabase variables and redeploy.
- Supabase `401`/`403`: check the service_role JWT and project URL. Do not use the anon key.
- Supabase `400`/`404`: confirm bucket name, exact generated filename, root folder, and that the project is active.
- Integrity-check error: upload the generated gzip unchanged. Do not unzip and recompress it manually.
- Function bundle too large: confirm the large-function environment variable is set, Fluid Compute is enabled, and generated upload/test/dependency folders are excluded as configured.
- `Failed to build scipy`, missing `gfortran`, or `numpy has no usable wheels`: if this immediately follows `Installing dependencies...` before the React build, enable the frontend Install Command Override and set `npm install --include=dev` (also supplied in `vercel.json`). This bypasses the static builder's automatic root-requirements Python install. The Python API builder still installs its dependencies separately. These pins support Python 3.12 Linux wheels, not Python 3.14: retain both `.python-version` (`3.12`) and `pyproject.toml` (`requires-python = "~=3.12.0"`) in the Vercel Root Directory. If a later API installation still selects 3.14, inspect its version-detection logs, Root Directory, and interpreter overrides. Do not remove the wheel safeguard or install a compiler.
- Slow initial request: the compressed data must be fetched and parsed for a new instance. Check function logs and region proximity. Validate usage with your team before relying on a free plan for heavy use.
- The source archive is prepared and locally tested, not proof of a successful Vercel deployment. Linux dependency installation, live storage access, Vercel routing, and account quotas require a real preview deployment to verify.

## Local operation and data regeneration

The normal local launcher continues to read `../output_file.csv`. It needs no Supabase keys. To test the prepared data locally without any network access, run (PowerShell):

```powershell
$env:DATASET_MODE = 'prepared'
python server.py --port 8766
```

Open http://127.0.0.1:8766. To return to the original-CSV mode, close that server and remove `DATASET_MODE` from that terminal environment.

From the original workspace, regenerate with `python scripts/prepare_data.py`. It writes a new immutable gzip filename and updates the manifest. Upload that exact object and deploy the matching manifest together. The upload script never sends data to Supabase automatically.

Run backend checks with `python -m unittest test_service.py test_hosting.py`, and build the local frontend with `npm run build`. The Vercel-specific build uses the same source and bundler through its Node/Linux entrypoint.
