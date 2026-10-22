# ClearCart

A marketplace that shows the **real price, real reviews and the right size**, so shoppers buy once, with confidence.

- **All-in price** on every card (item + shipping + tax), matching the checkout total exactly
- **Clarity Score** per product, plus **Seller Trust Score**, each with a visible breakdown
- **Fake-review filtering** with a "show filtered" toggle
- **Fit finder** ("usually size 8, this runs small, so get 9")
- **Smart search**: "running shoes under RM300 for wide feet" turns into filter chips
- Buyer and seller accounts, seller store management, per-account cart, order tracking, reviews

Stack: npm workspaces monorepo · `apps/web` (Vite) · `apps/api` (Node + Prisma + SQLite)

---

## 1. Requirements

- **Node.js 20 or newer** (check with `node -v`). Use the same major version on every device.
- **Git**
- Windows: PowerShell or Command Prompt

### Windows only: allow npm to run (once per device)

If `npm` fails with *"running scripts is disabled on this system"*:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

If you can't change this (e.g. a locked work laptop), use `npm.cmd` instead of `npm`, or use Command Prompt.

---

## 2. Get the code and install

```powershell
git clone <your-repo-url> clearcart
cd clearcart
npm install
```

npm may block setup scripts for Prisma and esbuild. Approve them, then rebuild
(skip this if npm says `install-scripts` is not a command):

```powershell
npm install-scripts approve prisma
npm install-scripts approve @prisma/client
npm install-scripts approve @prisma/engines
npm install-scripts approve esbuild
npm rebuild prisma @prisma/client @prisma/engines esbuild
```

---

## 3. Create the environment file

The API needs a secret for logins. It is **not** in git, so every device creates its own:

```powershell
$s = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
Set-Content apps\api\.env "JWT_SECRET=$s`nNODE_ENV=development"
```

> Keep `NODE_ENV=development` on your laptop. With `production`, login cookies are
> marked Secure and won't work on `http://localhost`.

---

## 4. Set up the database

Pick **one** option.

### Option A: Fresh database with sample data

```powershell
npx prisma generate --schema apps/api/prisma/schema.prisma
npx prisma db push --schema apps/api/prisma/schema.prisma
npm run seed -w @clearcart/api
npm run seller:seed -w @clearcart/api -- --name "Test Store" --email teststore@clearcart.test --password TestStore123 --count 20 --seed 3
```

### Option B: Bring your data from another device

On the **old** device, stop the app (Ctrl + C), then bundle the data:

```powershell
Compress-Archive -Path apps\api\prisma\dev.db*, apps\api\uploads, apps\api\.env -DestinationPath clearcart-data.zip -Force
```

Copy `clearcart-data.zip` to the new device (USB drive, cloud drive). Then on the **new** device:

```powershell
Expand-Archive clearcart-data.zip -DestinationPath temp-data -Force
Copy-Item temp-data\apps\api\* apps\api\ -Recurse -Force
Remove-Item temp-data -Recurse
npx prisma generate --schema apps/api/prisma/schema.prisma
```

If the folders land in the wrong place, put them by hand:
`dev.db` → `apps\api\prisma\`, `uploads\` → `apps\api\`, `.env` → `apps\api\`.

> The zip contains password hashes and your secret. Never commit it or share it publicly.
> Copying is a one-time snapshot: changes made afterwards on one device don't sync to the other.

---

## 5. Run

```powershell
npm run dev
```

| Part | URL |
|---|---|
| Website | http://localhost:5173 |
| API | http://localhost:4000/api (the website forwards to it automatically) |

### Test accounts (Option A)

| Role | Email | Password |
|---|---|---|
| Seller | teststore@clearcart.test | TestStore123 |
| Buyer | Register one at `/register` | |

Test card for checkout: `4242 4242 4242 4242`, any future expiry, any 3-digit CVV.
Only the brand and last 4 digits are stored, never the full number or CVV.

---

## Useful commands

```powershell
# View and edit the database in the browser (http://localhost:5555)
npx prisma studio --schema apps/api/prisma/schema.prisma

# Create another test seller with 20 products and pictures
npm run seller:seed -w @clearcart/api -- --name "Shoe Hub" --email shoehub@clearcart.test --password ShoeHub123 --seed 4

# Delete a test seller and everything linked to it
npm run seller:delete -w @clearcart/api -- --email shoehub@clearcart.test

# Back up the database
Copy-Item apps\api\prisma\dev.db dev-backup.db
```

Use a different `--seed` number for each test seller so their products differ.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `running scripts is disabled on this system` | See "Windows only" in section 1 |
| `JWT_SECRET is not set` | Check `apps\api\.env` exists and has `JWT_SECRET=...` (section 3), then restart |
| Website opens on **5174** instead of 5173 | An old copy is still running. Stop it: `Get-Process node \| Stop-Process -Force`, then `npm run dev` |
| `ERR_MODULE_NOT_FOUND` / "Cannot find module" | Run `npm install` again from the project root |
| Prisma "file is locked" / `EPERM` | Stop the app first, then re-run `npx prisma generate ...` |
| Website loads but shows **no products** | Database is empty. Run the seed commands in Option A |
| "Too many attempts" at login | The rate limit is in memory. Restart the app to clear it |
| Login succeeds but you're sent back to login | Make sure `.env` has `NODE_ENV=development` |
| Product pictures missing after a transfer | The `apps\api\uploads` folder wasn't copied (Option B) |
| Seed script name not found | List scripts: `Get-Content apps\api\package.json \| Select-String "seed"` |

---

## Not in git (by design)

- `apps/api/.env`: secrets, created per device
- `apps/api/prisma/dev.db`: the database
- `apps/api/uploads/`: uploaded and generated pictures
- `node_modules/`

Before committing, check with `git status` that none of these are listed.
