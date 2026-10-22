import { z } from "zod";

export const ROLES = ["BUYER", "SELLER"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"));

export const PASSWORD_RULE = "At least 8 characters, with a letter and a number";
export const PasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  // bcrypt ignores bytes past 72.
  .max(72, "Use at most 72 characters")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

export const RegisterRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(60, "Use at most 60 characters"),
  email: EmailSchema,
  password: PasswordSchema,
  role: RoleSchema,
});
export type RegisterRequest = z.input<typeof RegisterRequestSchema>;

// Login doesn't enforce the password rule: accounts created before it must still be able to log in.
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, "Enter your password").max(200),
});
export type LoginRequest = z.input<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Tokens travel only in httpOnly cookies, never in the body. */
export interface AuthResponse {
  user: AuthUser;
}
