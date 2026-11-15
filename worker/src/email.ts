/* Outgoing e-mail through Resend's HTTP API (free plan: a verified domain, ~100 mails a day), used only for
 * password reset codes. Kept to one small function so another provider can replace it. */

import type { Env } from "./env";

export const DEFAULT_EMAIL_API_URL = "https://api.resend.com/emails";

export const isEmailConfigured = (env: Env) => Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());

export interface EmailMessage { to: string; subject: string; text: string }

export async function sendEmail(env: Env, message: EmailMessage): Promise<void> {
  const response = await fetch(env.EMAIL_API_URL || DEFAULT_EMAIL_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The e-mail service answered HTTP ${response.status}`);
}

/** English and Chinese in one message: the reset request does not say which language the user reads. */
export function resetCodeEmail(code: string, minutes: number): { subject: string; text: string } {
  return {
    subject: "Your PlanTriz verification code / PlanTriz 验证码",
    text: [
      `Your PlanTriz verification code is ${code}.`,
      `It is valid for ${minutes} minutes. If you did not ask to reset your password, you can ignore this e-mail.`,
      "",
      `你的 PlanTriz 验证码是 ${code}，${minutes} 分钟内有效。`,
      "如果不是你本人在重置密码，请忽略这封邮件。",
    ].join("\n"),
  };
}
