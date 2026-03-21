import type { Request, Response } from "express";
import { prisma } from "../db";
import { stripe, STRIPE_WEBHOOK_SECRET } from "../stripe";

function toDate(sec?: number | null) {
  if (!sec) return null;
  return new Date(sec * 1000);
}

type AppSubscriptionStatus =
  | "NONE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "INCOMPLETE";

type AppPlan = "FREE" | "TRIAL" | "PRO";

function mapStripeStatusToAppStatus(status?: string | null): AppSubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
      return "INCOMPLETE";
    default:
      return "NONE";
  }
}

function mapStripeStatusToPlan(status?: string | null): AppPlan {
  if (status === "trialing") return "TRIAL";
  if (status === "active" || status === "past_due") return "PRO";
  return "FREE";
}

async function findArtistForSubscription(sub: any) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

  const artistIdFromMeta =
    typeof sub.metadata?.artistId === "string" ? sub.metadata.artistId : "";

  const artist =
    (artistIdFromMeta
      ? await prisma.artist.findUnique({ where: { id: artistIdFromMeta } })
      : null) ??
    (customerId
      ? await prisma.artist.findFirst({
          where: { stripeCustomerId: customerId },
        })
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

  const subscriptionStatus = mapStripeStatusToAppStatus(sub.status);
  const currentPeriodEnd = toDate(sub.current_period_end);
  const plan = mapStripeStatusToPlan(sub.status);

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

    if (!STRIPE_WEBHOOK_SECRET) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
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
              subscriptionStatus: "ACTIVE",
              ...(customerId ? { stripeCustomerId: customerId } : {}),
              ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
            },
          });
        }

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub: any = event.data.object;
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