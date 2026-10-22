import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LoginRequestSchema, PASSWORD_RULE, RegisterRequestSchema, type AuthUser, type Role } from "@clearcart/shared";
import { ApiError } from "../lib/api";
import { afterLogin, useAuth } from "../lib/auth";

type Errors = Record<string, string>;

const issuesToErrors = (issues: { path: PropertyKey[] | string; message: string }[]): Errors =>
  Object.fromEntries(
    issues.map((i) => [Array.isArray(i.path) ? String(i.path[0]) : String(i.path).split(".")[0], i.message]),
  );

function Field({ label, name, error, type = "text", autoComplete }: { label: string; name: string; error?: string; type?: string; autoComplete: string }) {
  return (
    <label className="block text-sm">
      {label}
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        className={`mt-1 w-full rounded-lg border bg-surface px-3 py-2 ${error ? "border-bad" : "border-line-strong"}`}
      />
      {error && <span className="text-xs text-bad">{error}</span>}
    </label>
  );
}

function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm rounded-card border border-line bg-surface p-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-5">{children}</div>
      <p className="mt-5 text-center text-sm text-muted">{footer}</p>
    </div>
  );
}

/** Shared submit flow: validate locally, call the API, map server errors onto fields. */
function useAuthForm(onSuccess: (user: AuthUser) => void) {
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const run = async (validate: () => Errors | null, call: () => Promise<AuthUser>) => {
    const local = validate();
    if (local) return setErrors(local);
    setErrors({});
    setPending(true);
    try {
      onSuccess(await call());
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) setErrors(issuesToErrors(err.details));
      else setErrors({ form: (err as Error).message });
    } finally {
      setPending(false);
    }
  };
  return { errors, pending, run };
}

/** Where to go after logging in: `?next=` when the role may open it, else the role's home. */
function useAfterLogin() {
  const navigate = useNavigate();
  const next = useSearchParams()[0].get("next");
  return (user: AuthUser) => navigate(afterLogin(user, next), { replace: true });
}
const submitClass = "w-full rounded-xl bg-brand-600 py-3 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-60";

export function LoginPage() {
  const { login } = useAuth();
  const { errors, pending, run } = useAuthForm(useAfterLogin());

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const req = { email: data.email ?? "", password: data.password ?? "" };
    run(
      () => {
        const r = LoginRequestSchema.safeParse(req);
        return r.success ? null : issuesToErrors(r.error.issues);
      },
      () => login(req),
    );
  };

  return (
    <AuthCard title="Log in" footer={<>New here? <Link to="/register" className="text-brand-700 underline">Create an account</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" error={errors.password} />
        {errors.form && <p className="text-sm text-bad" role="alert">{errors.form}</p>}
        <button disabled={pending} className={submitClass}>{pending ? "Logging in…" : "Log in"}</button>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const [role, setRole] = useState<Role>("BUYER");
  const { errors, pending, run } = useAuthForm(useAfterLogin());

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const req = { name: data.name ?? "", email: data.email ?? "", password: data.password ?? "", role };
    run(
      () => {
        const r = RegisterRequestSchema.safeParse(req);
        return r.success ? null : issuesToErrors(r.error.issues);
      },
      () => register(req),
    );
  };

  return (
    <AuthCard title="Create an account" footer={<>Already have one? <Link to="/login" className="text-brand-700 underline">Log in</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
          {(["BUYER", "SELLER"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={`rounded-lg py-2 text-sm font-semibold ${role === r ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {r === "BUYER" ? "I'm buying" : "I'm selling"}
            </button>
          ))}
        </div>
        <Field label={role === "SELLER" ? "Store name" : "Name"} name="name" autoComplete={role === "SELLER" ? "organization" : "name"} error={errors.name} />
        <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" error={errors.password} />
        {!errors.password && <p className="-mt-2 text-xs text-muted">{PASSWORD_RULE}</p>}
        {errors.form && <p className="text-sm text-bad" role="alert">{errors.form}</p>}
        <button disabled={pending} className={submitClass}>{pending ? "Creating account…" : "Create account"}</button>
      </form>
    </AuthCard>
  );
}
