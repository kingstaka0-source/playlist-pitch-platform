import type { Request, Response } from "express";
import { Resend } from "resend";
import { prisma } from "../db";

const resend = new Resend(process.env.RESEND_API_KEY);

type ResendWebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    bounce?: {
      message?: string;
      type?: string;
      subType?: string;
    };
    suppressed?: {
      message?: string;
      type?: string;
    };
  };
};

function getDeliveryError(event: ResendWebhookEvent): string | null {
  if (event.type === "email.suppressed") {
    return event.data?.suppressed?.message || "Email suppressed by Resend";
  }

  if (event.type === "email.bounced") {
    return event.data?.bounce?.message || "Email bounced";
  }

  if (event.type === "email.complained") {
    return "Recipient marked the email as spam";
  }

  if (event.type === "email.failed") {
    return "Resend reported that the email failed";
  }

  return null;
}

export async function resendWebhookHandler(req: Request, res: Response) {
  const webhookSecret = String(
    process.env.RESEND_WEBHOOK_SECRET || ""
  ).trim();

  if (!webhookSecret) {
    console.error("RESEND_WEBHOOK_SECRET is missing");
    return res.status(500).json({
      error: "RESEND_WEBHOOK_NOT_CONFIGURED",
    });
  }

  const svixId = req.header("svix-id");
  const svixTimestamp = req.header("svix-timestamp");
  const svixSignature = req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).json({
      error: "MISSING_RESEND_WEBHOOK_HEADERS",
    });
  }

  if (!Buffer.isBuffer(req.body)) {
    console.error("RESEND_WEBHOOK_BODY_NOT_RAW");
    return res.status(400).json({
      error: "RESEND_WEBHOOK_BODY_NOT_RAW",
    });
  }

  let event: ResendWebhookEvent;

  try {
    event = resend.webhooks.verify({
      payload: req.body.toString("utf8"),
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret,
    }) as ResendWebhookEvent;
  } catch (error) {
    console.error("INVALID_RESEND_WEBHOOK_SIGNATURE", error);

    return res.status(400).json({
      error: "INVALID_RESEND_WEBHOOK_SIGNATURE",
    });
  }

  const emailId = event.data?.email_id;

  if (!emailId) {
    return res.status(200).json({
      ok: true,
      ignored: true,
      reason: "NO_EMAIL_ID",
    });
  }

  const pitch = await prisma.pitch.findUnique({
    where: {
      providerMessageId: emailId,
    },
    select: {
      id: true,
    },
  });

  if (!pitch) {
    return res.status(200).json({
      ok: true,
      ignored: true,
      reason: "PITCH_NOT_FOUND",
    });
  }

  const eventTime = event.created_at
    ? new Date(event.created_at)
    : new Date();

  switch (event.type) {
    case "email.delivered":
      await prisma.pitch.update({
        where: { id: pitch.id },
        data: {
          deliveryStatus: "DELIVERED",
          deliveredAt: eventTime,
          deliveryError: null,
        },
      });
      break;

    case "email.delivery_delayed":
      await prisma.pitch.update({
        where: { id: pitch.id },
        data: {
          deliveryStatus: "DELIVERY_DELAYED",
          deliveryError: null,
        },
      });
      break;

    case "email.bounced":
      await prisma.pitch.update({
        where: { id: pitch.id },
        data: {
          deliveryStatus: "BOUNCED",
          deliveredAt: null,
          deliveryError: getDeliveryError(event),
        },
      });
      break;

    case "email.complained":
      await prisma.pitch.update({
        where: { id: pitch.id },
        data: {
          deliveryStatus: "COMPLAINED",
          deliveryError: getDeliveryError(event),
        },
      });
      break;

    case "email.failed":
      await prisma.pitch.update({
        where: { id: pitch.id },
        data: {
          deliveryStatus: "FAILED",
          deliveredAt: null,
          deliveryError: getDeliveryError(event),
        },
      });
      break;

    case "email.suppressed":
      await prisma.pitch.update({
        where: { id: pitch.id },
        data: {
          deliveryStatus: "SUPPRESSED",
          deliveredAt: null,
          deliveryError: getDeliveryError(event),
        },
      });
      break;

    default:
      return res.status(200).json({
        ok: true,
        ignored: true,
        eventType: event.type,
      });
  }

  console.log("RESEND_DELIVERY_UPDATED", {
    pitchId: pitch.id,
    emailId,
    eventType: event.type,
  });

  return res.status(200).json({
    ok: true,
  });
}
