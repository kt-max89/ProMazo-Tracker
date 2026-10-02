import { createHash, timingSafeEqual } from "node:crypto";

export function validateRegistrationCode(
  submitted: string,
  expected = process.env.REGISTRATION_CODE,
): "valid" | "invalid" | "unconfigured" {
  if (!expected) return "unconfigured";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(submitted), hash(expected)) ? "valid" : "invalid";
}