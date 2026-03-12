import type { Request, Response } from "express";
import { prisma } from "../db";
import { stripe, STRIPE_WEBHOOK_SECRET } from "../stripe";

function toDate(sec?: number | null) {
  if (!sec) return null;
  return new Date(sec * 1000);
}

async function findArtistForSubscription(sub: any) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

  const artistIdFromMeta = typeof sub.metadata?.artistId === "string"
    ? sub.metadata.artistId
    : undefined;

  const artist =
    (artistIdFromMeta
      ? await prisma.artist.findUnique({ where: { id: artistIdFromMeta } })
      : null) ??
    (customerId
      ? await prisma.artist.findFirst({ where: { stripeCustomerId: customerId } })
      : null);

  return {
    artist,
    customerId,
  };
}

async function upsertFromSubscription(sub: any) {
  const subId = String(sub.id);
  const { artist, customerId } = await findArtistForSubscription(sub);

  if (!artist) {
    console.warn("WEBHOOK: No artist found for subscription", {
      subId,
      customerId,
      artistIdFromMeta: sub.metadata?.artistId,
    });
    return;
  }

  let subscriptionStatus:
    | "NONE"
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "CANCELED"
    | "INCOMPLETE" = "NONE";

  if (sub.status === "trialing") subscriptionStatus = "TRIALING";
  else if (sub.status === "active") subscriptionStatus = "ACTIVE";
  else if (sub.status === "past_due") subscriptionStatus = "PAST_DUE";
  else if (sub.status === "canceled") subscriptionStatus = "CANCELED";
  else if (sub.status === "incomplete") subscriptionStatus = "INCOMPLETE";

  const currentPeriodEnd = toDate(sub.current_period_end);

  const plan: "FREE" | "TRIAL" | "PRO" =
    sub.status === "trialing"
      ? "TRIAL"
      : sub.status === "active" || sub.status === "past_due"
      ? "PRO"
      : "FREE";

  await prisma.artist.update({
    where: { id: artist.id },
    data: {
      plan,
      trialUntil: sub.status === "trialing" ? currentPeriodEnd : null,
      stripeCustomerId: customerId ?? artist.stripeCustomerId,
      stripeSubscriptionId: subId,
      subscriptionStatus,
      currentPeriodEnd,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    },
  });
}

export async function stripeWebhookHandler(req: Request, res: Response) {
  try {
    const sig = req.headers["stripe-signature"];

    if (!sig || typeof sig !== "string") {
      return res.status(400).send("Missing stripe-signature");
    }

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session: any = event.data.object;
        const artistId =
          typeof session.metadata?.artistId === "string"
            ? session.metadata.artistId
            : "";

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id || null;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id || null;

        if (artistId) {
          await prisma.artist.update({
            where: { id: artistId },
            data: {
              plan: "PRO",
              ...(customerId ? { stripeCustomerId: customerId } : {}),
              ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
            },
          });
        }

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await upsertFromSubscription(sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub: any = event.data.object;
        const subId = String(sub.id);

        const artist =
          (await prisma.artist.findFirst({
            where: { stripeSubscriptionId: subId },
          })) ??
          (typeof sub.customer === "string"
            ? await prisma.artist.findFirst({
                where: { stripeCustomerId: sub.customer },
              })
            : null);

        if (artist) {
          await prisma.artist.update({
            where: { id: artist.id },
            data: {
              plan: "FREE",
              trialUntil: null,
              subscriptionStatus: "CANCELED",
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              stripeSubscriptionId: null,
            },
          });
        }

        break;
      }

      case "invoice.payment_failed": {
        const inv: any = event.data.object;
        const subId =
          typeof inv.subscription === "string" ? inv.subscription : null;

        if (subId) {
          const artist = await prisma.artist.findFirst({
            where: { stripeSubscriptionId: subId },
          });

          if (artist) {
            await prisma.artist.update({
              where: { id: artist.id },
              data: {
                subscriptionStatus: "PAST_DUE",
                plan: "PRO",
              },
            });
          }
        }

        break;
      }

      case "invoice.payment_succeeded": {
        const inv: any = event.data.object;
        const subId =
          typeof inv.subscription === "string" ? inv.subscription : null;

        if (subId) {
          const artist = await prisma.artist.findFirst({
            where: { stripeSubscriptionId: subId },
          });

          if (artist) {
            await prisma.artist.update({
              where: { id: artist.id },
              data: {
                subscriptionStatus: "ACTIVE",
                plan: "PRO",
              },
            });
          }
        }

        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error("STRIPE WEBHOOK ERROR", err?.message ?? err);
    return res.status(400).send(`Webhook Error: ${err?.message ?? String(err)}`);
  }
}