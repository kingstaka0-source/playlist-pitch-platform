import { Resend } from "resend";

console.log("RESEND CONFIGURED:", !!process.env.RESEND_API_KEY);

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM || "onboarding@resend.dev",
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return {
    messageId: result.data?.id,
  };
}